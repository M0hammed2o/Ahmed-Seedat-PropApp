# Utilities — Staging Deployment Plan

**Status:** prepared, **not executed**. Nothing was deployed, pushed or applied to any hosted database during this audit.
Every step below needs the owner's go-ahead.

## 1. Migration order

Apply in order, each in its own transaction (the Supabase CLI does this):

| # | Migration | Purpose | Reversible? |
| --- | --- | --- | --- |
| 172–174 | (already live in production per project memory; verify head first) | storage path ownership, CoA/insight ack, deleted-account PII | — |
| 175 | `smart_utility_metering` | meter hierarchy, telemetry, integrations, alerts, municipal packs; replaces utility RLS helpers | additive; rollback = drop new objects (no customer data yet) |
| 176 | `smart_utilities_engine_billing_reporting` | poll engine, encrypted credentials, catalogue requests, tariffs/charges v1, templates | additive |
| 177 | `utility_meter_location` | meter location column | additive |
| 178 | `hybrid_utilities` | supply sources, measurement kinds, tariffs v2, arrangements, allocation, charges v2, statements | additive; **relaxes** `utility_tariffs.blocks` check (kind-aware check restores it) |
| 179 | `utilities_hardening` | org/property binding, evidence check, overlap exclusion (btree_gist), invoice-void release, reading counts, `organizations.utilities_enabled` | additive; **fails on purpose** if overlapping live utility charges already exist (none in production) |
| 180 | `portfolio_intelligence_candidates` | candidate-org function for the daily job | additive (function only) |

**Rehearsal evidence (local, 2026-10-10/11):** a data-only copy of the local database (2 725 organisations, 1 886
properties, 477 leases, 1 766 invoices, 1 722 payments, 1 117 users, 42 utility meters, 120 readings) at head 171 was
upgraded through 172–180. Per-migration time 0.9–3.5 s (including Docker overhead). Fingerprints (row count + MD5 of
key columns) of properties, units, tenants, leases, invoices, invoice lines, payments, journal entries, utility meters,
utility readings and auth users were **identical** before and after. Existing meters defaulted to
`measurement_kind = 'consumption'`. See `UTILITIES_FINAL_TEST_RESULTS.md` §Migration rehearsal for the final run.
Note: migration 172 refused the local copy because 31 demo documents had paths outside their org folder (by design);
production already passed 172.

## 2. Backup and recovery

1. Before applying: take a Supabase point-in-time recovery marker (Pro plan) **and** a logical dump:
   `pg_dump --format=custom --no-owner` of the production database to encrypted storage; record its checksum.
2. Verify the dump restores into a scratch project (row counts of the tables in §1 rehearsal).
3. Apply to **staging** first; run the smoke tests (§6) and the pgTAP suite there.
4. Production: apply 175 → 180; verify with the rollback-only probe technique used for 171/172 (begin; exercise;
   rollback) and the fingerprint query (`scratchpad/rehearsal/fingerprint.sql` equivalent).

**Rollback limitations.** All six migrations are additive, but:
- Once any utility charge, statement or municipal pack exists, dropping the new tables loses that data — restore from
  the dump/PITR instead of hand-written down-migrations.
- 175 replaces the utility RLS helper functions and policies of migration 163; a rollback must restore those definitions
  (they are in 163) or restore the database.
- 178 relaxed then re-tightened the tariff blocks check; legacy rows are unaffected.
- `btree_gist` (179) is an extension; leaving it installed is harmless.
Prefer **forward fixes** after go-live; use PITR only for data loss.

## 3. Environment variables and secrets

| Variable | Staging | Production | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | staging project | production project | existing |
| `CRON_JOB_SECRET` | random 32+ chars | random 32+ chars | scheduler → `/api/v1/system/*` |
| `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | **unset (mock)** or a sandbox domain | as today | staging must not e-mail real recipients |
| `SMART_UTILITY_AUTO_SUBMISSION_ENABLED` | unset | **unset** until the owner approves automatic municipal sending | |
| `SMART_UTILITY_TENANT_STATEMENTS_ENABLED` | unset | unset until approved | statements remain downloadable |
| `SMART_UTILITY_CREDENTIALS_KEY` | random 32 bytes base64 if testing ThingsBoard | only if poll integrations are offered (fix TD-58 rebinding first) | secret store only; rotation = re-enter credentials |
| `CLOUDMERSIVE_API_KEY` | as today | as today | photo evidence scanning |

Never copy `apps/admin/.env.local` (it holds live keys — TD-59) into staging or CI.

## 4. Background jobs

- One Render Cron Job → `POST /api/v1/system/daily-jobs` (`Authorization: Bearer $CRON_JOB_SECRET`), daily ~02:00 SAST.
  It runs subscriptions, checkouts, rent schedules, compliance, reminders, owner summaries, portfolio intelligence and
  the smart-utility job (poll sync, health, anomalies, hybrid alerts, reconciliation, snapshots, reminders, municipal
  generation/sending/status sync). Each step is isolated; a failing step is reported, not fatal.
- Optional second schedule (hourly) → `POST /api/v1/system/smart-utility-jobs` once meters report every 15 minutes
  (health and delivery retries are then timelier).
- Request timeout on the scheduler ≥ 120 s. Measured locally: whole daily run 7.7–20 s on a 2 740-org copy.

## 5. Feature flags and the per-organisation switch

- `organizations.utilities_enabled` (migration 179, default **true** so existing organisations keep their current
  behaviour). For a controlled pilot, after deploying run (owner decision):
  `update public.organizations set utilities_enabled = false where id <> '<pilot org id>';`
  Disabled organisations get 403 `utilities_disabled` from Smart Utilities routes and device ingestion, no utility
  alerts, no municipal generation/sending. Legacy monthly readings (Android capture, Finances) keep working.
- Keep both `SMART_UTILITY_*` sending flags unset for the whole pilot.

## 6. Smoke tests (staging, in order)

1. Sign in as a staff user of the pilot org → property → **Utilities** tab loads; `/utilities` lists the property.
2. Add a manual meter (catalogue → "Traditional water meter"), record two readings, verify one as a second user.
3. Add a supply source; add a fictional flat tariff; Preview shows the expected amount.
4. Set one unit's arrangement; Calculate charges for last month; draft appears with review flags; Approve; "Add to draft
   invoices" creates a **draft** (Accounting → Invoices shows Draft); void it → the charge returns to Approved.
5. Prepare a tenant statement; approve; PDF downloads; the tenant (Android or web) sees it; Send is not offered.
6. Municipal: settings + an authorised **test** recipient you own; Preview; Approve; change the custom message → approval
   withdrawn; Test send to yourself only.
7. Device ingestion: create a simulator/JSON integration; `scripts/simulate-meter-feed.mjs` posts readings; health
   shows Online.
8. Switch `utilities_enabled` off for a second org → its Utilities tab shows the not-enabled message; ingest returns 403.
9. Run `POST /api/v1/system/daily-jobs` with the cron secret; every job reports `success: true`.

## 7. Monitoring and alerting (minimum)

- Scheduler: alert if daily-jobs returns non-2xx or any job `success: false` (response body lists them).
- Log alerts on `[smart-utility-job] step failed`, `[portfolioIntelligence] reconcile failed`, ingestion 5xx.
- Weekly: count of deliveries in `failed` with `next_attempt_at is null` (exhausted), integrations `stale/offline`,
  utility charges in draft > 7 days.
- Database size growth (telemetry ≈ 15.8 MB per meter per year at 15-minute readings).

## 8. Release-blocking issues and pilot readiness

See `UTILITIES_RELEASE_BLOCKERS.md` (blockers) and `UTILITIES_PRODUCTION_READINESS_AUDIT.md` (readiness levels).
