# Utilities — Staging Deployment Plan

**Status:** prepared and rehearsed locally, **not executed**. Nothing has been deployed, pushed or applied to any
hosted database. Every step below needs the owner's go-ahead (§9 lists the exact approvals).
**Updated:** 2026-10-12 (migration 182: utilities off by default and fail closed; exact commands in §10).

## 1. Migration order

Apply in order, each in its own transaction (the Supabase CLI does this):

| # | Migration | Purpose | Reversible? |
| --- | --- | --- | --- |
| 172–174 | (live in production per project memory, head 172 on 2026-09-14 and 174 later; **verify the head first**) | storage path ownership, CoA/insight ack, deleted-account PII | — |
| 175 | `smart_utility_metering` | meter hierarchy, telemetry, integrations, alerts, municipal packs; property-level utility RLS | rollback script (§2) |
| 176 | `smart_utilities_engine_billing_reporting` | poll engine, encrypted credentials, catalogue requests, tariffs/charges v1, templates | rollback script |
| 177 | `utility_meter_location` | meter location column | rollback script |
| 178 | `hybrid_utilities` | supply sources, measurement kinds, tariffs v2, arrangements, allocation, charges v2, statements | rollback script |
| 179 | `utilities_hardening` | org/property binding, evidence check, overlap exclusion (btree_gist), invoice-void release, reading counts, `organizations.utilities_enabled` | rollback script; **fails on purpose** if overlapping live utility charges exist (none in production) |
| 180 | `portfolio_intelligence_candidates` | candidate-org function for the daily job | rollback script |
| 181 | `utilities_phase3` | batch telemetry insert, opt-in retention, legacy monthly readings mirrored into telemetry (+ backfill), `true_up` charge type, one true-up credit per estimate | rollback script |
| 182 | `utilities_off_by_default` | `utilities_enabled` defaults to false; every existing organisation set to false (pilot org switched on explicitly, §5) | rollback script (drops the column) |
| 183 | `utilities_rls_set_based` | utilities RLS evaluated per property instead of per row (same visibility; portfolio query 24.6 s → 0.7 s at scale) | rollback script |

**Rehearsal evidence (local, disposable stack `propvault_su`, 2026-10-11).**
- **Data:** a data-only copy of the local database at head 171:
  - 2,725 organisations, 1,886 properties, 477 leases;
  - 1,766 invoices, 1,722 payments, 620 journal entries;
  - 1,117 users, 42 utility meters, 120 monthly readings.
- **Before 175:** the copy was upgraded through 172–174. Migration 172 needed 31 demo document paths quarantined;
  production already passed 172.
- **Timings:** 175–181 applied in **0.9–2.7 s each**, including Docker overhead.
- **Checks after applying:**
  - fingerprints (row count + MD5 of key columns) of the 11 tables above were **identical** before and after;
  - **120 of 120** legacy monthly readings were mirrored into telemetry by 181's backfill;
  - full pgTAP on a fresh stack: 103 files / 1,645 tests passed.

## 2. Backup, recovery and rollback

1. Before applying: take a Supabase point-in-time recovery marker (Pro plan) **and** a logical dump.
   - Dump with `pg_dump --format=custom --no-owner` to encrypted storage and record its checksum.
2. Verify that the dump restores into a scratch project (row counts of the §1 tables).
3. Apply to **staging** first. Run the smoke tests (§6) and the pgTAP suite there.
4. Production (separate approval): apply 175 → 183.
   - Verify with the rollback-only probe technique used for 171/172 (begin; exercise; rollback).
   - Run the fingerprint query.

**Rollback script:** `supabase/rollback/20260101000175_183_utilities_down.sql`. Run it by hand as one transaction:
`psql -1 -v ON_ERROR_STOP=1 -f supabase/rollback/20260101000175_183_utilities_down.sql`.

What it does:
- **Refuses** while real utility data exists: charges, statements, municipal packs, tariffs, supply sources, or
  telemetry other than mirrored monthly readings. Dropping those would destroy customer records; **restore from the
  dump/PITR instead**.
- Restores migration 174's `utility_meters` / `utility_readings` policies and `record_utility_reading()` verbatim.
- Drops only what 175–183 added. The original `utility_meters` and `units` columns and all their rows stay.
- Removes `btree_gist` and the 175–183 rows from `supabase_migrations.schema_migrations`.

**Rehearsed on the representative copy:** up → guard refusal (a tariff existed; nothing changed) → down in 1.8–1.9 s →
check against 174 → up again. All 7 migrations re-applied; 120/120 readings mirrored again.

The checks against 174 after the down step:
- `pg_dump --schema-only` of `public` is **identical** to 174 (only pg_dump's random `\restrict` token differs);
- data fingerprint **identical**;
- extension list **identical**;
- migration history back at 174.

After go-live, prefer **forward fixes**. Use PITR only for data loss.

## 3. Environment variables and secrets

| Variable | Staging | Production | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | staging project | production project | existing |
| `CRON_JOB_SECRET` | random 32+ chars | random 32+ chars | scheduler → `/api/v1/system/*` (constant-time compare, TD-68 fixed) |
| `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | **unset (mock)** or a sandbox domain | as today | staging must not e-mail real recipients |
| `SMART_UTILITY_AUTO_SUBMISSION_ENABLED` | **unset** | **unset** until the owner approves automatic municipal sending | |
| `SMART_UTILITY_TENANT_STATEMENTS_ENABLED` | **unset** | **unset** until approved | statements stay downloadable/visible after approval |
| `SMART_UTILITY_CREDENTIALS_KEY` | random 32 bytes base64 only if testing ThingsBoard | only if poll integrations are offered | secret store only; DNS-rebinding fix (TD-66) is in; still untested against a live server |
| `SMART_UTILITY_TELEMETRY_RETENTION_DAYS` | **unset** (retention off) | unset for the pilot | **new (181)**. When set: older telemetry is thinned to each day's first/last reading plus manual/evidenced/flagged ones. Clamped to ≥ 400; irreversible for deleted rows |
| `CLOUDMERSIVE_API_KEY` | as today | as today | photo evidence scanning |

Never copy `apps/admin/.env.local` (it holds live keys) into staging or CI. Playwright now blanks every external
provider key itself (TD-59).

## 4. Background jobs

- One Render Cron Job runs daily at about 02:00 SAST: `POST /api/v1/system/daily-jobs` with
  `Authorization: Bearer $CRON_JOB_SECRET`.
  - It runs subscriptions, checkouts, rent schedules, compliance, reminders, owner summaries, portfolio intelligence and
    the smart-utility job.
  - The smart-utility job covers: poll sync, health, anomalies, hybrid alerts, reconciliation, snapshots, reminders,
    municipal generation/sending/status sync, and **retention** (off unless the variable is set).
  - Each step is isolated: a failing step is reported, not fatal.
- Optional second schedule (hourly): `POST /api/v1/system/smart-utility-jobs`, once meters report every 15 minutes.
- Scheduler request timeout ≥ 120 s. Measured locally: the whole daily run took 7.7–20 s on a 2,740-org copy. The
  root cause of the earlier timeout was per-org round trips, fixed in 180 (TD-69 residual).

## 5. Restricting the pilot to one organisation

Since migration 182, Smart Utilities is **off for every organisation**, existing and newly created. That is the
column default, and the migration sets every existing row to false. The app **fails closed**: a missing value or a
lookup error counts as off.

The owner switches on the single pilot organisation with one statement:

```sql
update public.organizations set utilities_enabled = true where id = '<pilot org id>';  -- exactly 1 row
```

What a switched-off organisation gets:
- 403 `utilities_disabled` from every Smart Utilities write route and from device ingestion;
- no poll sync (its server is never contacted);
- no utility alerts, no approval reminders, and no municipal generation or sending.

Legacy monthly readings (Android capture, Finances) are not gated and keep working. From 181 they are also mirrored
into telemetry, which is harmless.

No path creates or sends anything automatically without authorisation:
- **Charges:** only created when a manager presses Calculate. They are always drafts, and invoices are always drafts.
- **Tenant statements:** need approval, plus `SMART_UTILITY_TENANT_STATEMENTS_ENABLED`, plus a person pressing Send.
- **Municipal packs:** need an approved template hash, an authorised recipient, an enabled schedule and
  `SMART_UTILITY_AUTO_SUBMISSION_ENABLED`.

Keep both `SMART_UTILITY_*` sending flags unset for the whole pilot.

## 6. Smoke tests (staging, in order)

1. Sign in as a staff user of the pilot org → property → **Utilities** tab loads; `/utilities` lists the property.
2. Add a manual meter (catalogue → "Traditional water meter"), record two readings, verify one as a second user.
3. Android: record a monthly reading on the phone → it appears in Utilities as an unverified manual reading (181).
4. Add a supply source; add a **fictional** flat tariff; Preview shows the expected amount.
5. Set one unit's arrangement and Calculate charges for last month.
   - A draft appears with review flags. Approve it.
   - "Add to draft invoices" creates a **draft** (Accounting → Invoices shows Draft).
   - Void the invoice → the charge returns to Approved.
6. For a unit with an earlier billed month but no closing reading this month: Calculate with "Estimate where readings
   are missing".
   - The estimate is flagged.
   - Add the reading and recalculate → a draft true-up or a credit appears, once.
7. Prepare a tenant statement and approve it. The PDF downloads, and the tenant (Android or web) sees it. Send is not
   offered.
8. Municipal: settings plus an authorised **test** recipient you own.
   - Preview, then Approve.
   - Change the custom message → the approval is withdrawn.
   - Test send to yourself only.
9. Device ingestion: create a simulator/JSON integration and run `scripts/simulate-meter-feed.mjs`. Health shows
   Online.
10. A second (non-pilot) org, untouched → its Utilities tab shows the not-enabled message; ingest returns 403. Create a brand-new org → also off.
11. Run `POST /api/v1/system/daily-jobs` with the cron secret → every job reports `success: true`; retention reports
    `enabled: false`.

## 7. Monitoring and alerting (minimum)

- Scheduler: alert if daily-jobs returns non-2xx or any job reports `success: false` (the response body lists them).
- Log alerts on `[smart-utility-job] step failed`, `[portfolioIntelligence] reconcile failed`, ingestion 5xx.
- Weekly checks:
  - deliveries in `failed` with `next_attempt_at is null` (exhausted);
  - integrations that are `stale/offline`;
  - utility charges in draft for more than 7 days;
  - charges flagged `estimated_consumption_true_up_pending` older than 60 days.
- Database size growth: telemetry is about 15.8 MB per meter per year at 15-minute readings, until retention is enabled.

## 8. Release-blocking issues and pilot readiness

See `UTILITIES_REMAINING_BLOCKERS.md` (current) and `UTILITIES_PRODUCTION_READINESS_CHECKLIST.md`.

## 9. Approvals needed before anything leaves this machine

| # | Action | Who approves | Prerequisite |
| --- | --- | --- | --- |
| 1 | Push the local commits to the remote | owner | review the commit list |
| 2 | Apply 175–183 to **staging** | owner | a separate staging Supabase project exists (DEPLOYMENT.md; Unknown whether it does yet); dump of staging taken |
| 3 | Set staging env vars (§3) — sending flags unset, Resend mock/sandbox | owner | secret store access |
| 4 | Choose the pilot organisation; run §5 statements on staging | owner | org id |
| 5 | Production: apply 175–183 | owner, separately | staging smoke tests pass; PITR + dump verified |
| 6 | Any real tariff, any real tenant charge, any municipal send | owner + legal check per site | `UTILITIES_REMAINING_BLOCKERS.md` |

## 10. Exact staging commands (run only after approvals 1–4)

**Warning:** this repository's `supabase/.temp` is currently linked to the hosted project named **"PropertyVault"**
(`Likely` production). Never run a bare `supabase db push` from this checkout. Every step below names the staging
project explicitly and checks the link first.

```bash
# 0. Preconditions (owner): a SEPARATE staging Supabase project exists; you hold its project ref and DB password.
export STAGING_REF=<staging project ref>          # never the production ref
cd "<repo root>"
git log --oneline -1                              # the reviewed commit

# 1. Link to STAGING and prove it.
npx supabase link --project-ref "$STAGING_REF"
python -c "import json;print(json.load(open('supabase/.temp/linked-project.json'))['name'])"   # must print the STAGING name
npx supabase migration list --linked              # read-only: note the remote head (expect <= 174)

# 2. Backup (staging): logical dump + checksum, then a restore test into a scratch project.
npx supabase db dump --linked -f staging-pre-175.sql && sha256sum staging-pre-175.sql

# 3. Dry run, then apply 175–183 (each migration runs in its own transaction).
npx supabase db push --linked --dry-run           # must list exactly 175…183, nothing else
npx supabase db push --linked

# 4. Verify (read-only SQL in the staging SQL editor).
#    select max(version) from supabase_migrations.schema_migrations;                       -- 20260101000183
#    select count(*) filter (where utilities_enabled) from public.organizations;            -- 0
#    select column_default from information_schema.columns
#      where table_name='organizations' and column_name='utilities_enabled';                -- false
#    select count(*) from public.meter_telemetry_readings where external_event_id like 'utility_reading:%';
#      -- equals the number of utility_readings with reading_value >= the meter offset

# 5. Switch on the pilot org (owner decision, §5), then the 11 smoke tests (§6).

# 6. Re-link back to whatever this checkout was linked to before (or unlink) so nothing targets staging by accident.
```

**Rollback on staging:** `psql "$STAGING_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/rollback/20260101000175_183_utilities_down.sql`.
- It refuses once real utility data exists; restore the step-2 dump instead.
- The app commit must be rolled back together with the schema.

