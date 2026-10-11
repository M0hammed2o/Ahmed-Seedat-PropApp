# Utilities — Phase 3 Completion Report

**Phase:** Production hardening, staging readiness and pilot validation. **Date:** 2026-10-11.
**Environment:** local machine only.
- All database work ran on a disposable Supabase stack (`propvault_su`).
- The main local stack holding customer-like data was stopped, not reset, and restored at the end (§6).
- Nothing was pushed, deployed, applied to a hosted database, sent, purchased or activated.

## 1. Result

Every engineering task that can be done without hardware, a legal or accounting decision, or hosted-environment access
is done and verified locally. What remains is listed with an owner and next action in
`UTILITIES_REMAINING_BLOCKERS.md`: approvals, legal and VAT decisions, hardware, and the staging run.

## 2. What was completed and fixed

| Area | Work | Commit(s) |
| --- | --- | --- |
| Security | DNS-rebinding-safe ThingsBoard poll client (connects to the validated address; no redirects; 10 MB cap) — TD-66 | `4caea3a` |
| Security | Constant-time cron-secret check in all five system routes — TD-68 | `4caea3a` |
| Security | Playwright web server blanks every external provider key and utility flag — TD-59 | `4caea3a` |
| Security | Tenant write-denial on tariffs, arrangements, charges and credits; Phase 3 functions service-only (pgTAP) | `f8b5e5c` |
| Reports | Municipal preview PDF maps photos by document id — TD-60 | `4caea3a` |
| Performance | Batch telemetry insert (`ingest_telemetry_batch`, 500 rows per call) — TD-53 | `801a60d` |
| Performance | Opt-in telemetry retention (≥ 400 days, DB-enforced; keeps day boundaries and manual, evidenced and flagged readings) — TD-53 | `801a60d` |
| Consistency | Android and monthly readings mirrored into telemetry (dashboard, packs and billing see them; corrections replace the mirror; backfill) — TD-54 | `801a60d`, `863b4e5` |
| Accounting | Opt-in estimates for missing readings plus an automatic true-up (draft charge or capped credit, once, race-safe); UI option, labels on invoices and statements | `eb3ea95` |
| Accounting | TD-61 safe default: `vat_ledger_split_pending` flag for VAT-registered landlords | `0606325` |
| Pilot validation | Hybrid 7-flat property covering every arrangement; private-only (no tariffs) and municipal-only properties; hand-computed amounts on fictional tariffs | `574af8f` |
| Deployment | Rollback script for 175–181, rehearsed on representative data; staging plan updated | `f2423d5`, docs commit |
| Hardware | South African pilot bill of materials (R32,867.31 hardware, snapshot prices), running costs, accuracy, frequency, failure handling | `f6f4458` |
| Docs | Pilot scenarios, readiness checklist, remaining blockers, staging plan, TASKS, DECISIONS, TDR, WORKLOG, `.env.example` | docs commit |

Fixed during this phase:
- **Retention test intermittently failed.** Root cause: the job's cutoff of exactly 400 days raced the database's own
  clock. The job now keeps a 1-hour margin.
- **Concurrent first true-up could credit twice.** A partial unique index now allows one true-up credit per estimate,
  and the duplicate is handled.
- **Existing pgTAP expectation.** The portal-owner telemetry count now includes the mirrored monthly reading.

The daily-jobs timeout root cause (per-organisation round trips) was fixed in Brief 4 (migration 180). It was not
re-measured on the full copy in Phase 3.

## 3. Test results (exact)

All runs happened on 2026-10-11, locally, against a fresh disposable stack reset with migrations 001–181.

| Suite | Result | Notes |
| --- | --- | --- |
| pgTAP (`supabase test db`) | **103 files, 1,645 tests — PASS** | includes the new `utilities_phase3.test.sql` (20 tests) |
| Vitest (whole app: unit + integration) | **213 files passed, 1 skipped; 1,589 tests passed, 3 skipped — exit 0** | skipped: `malwareScan.integration` (needs a real scanner; skipped by design, pre-existing) |
| New utilities integration tests | `estimates` 5/5 (×4 runs), `pilot` 5/5, `telemetryRetention` 2/2 (×4 runs), ingestion 51/51 | |
| TypeScript (`tsc --noEmit`, apps/admin) | PASS | |
| ESLint (apps/admin) | application code clean. 5 errors in demo scripts **not touched in Phase 3** (`prepare-uat-demo-*.mjs`, the user's untracked `provision-production-demo-portfolio.mjs`) | pre-existing |
| `next build` | PASS | |
| Playwright, whole app (87 tests, ClamAV running) | first run **67 passed, 20 failed** (1.0 h; widespread timeouts and `ECONNRESET` from the dev server). Re-run of the 20 failed tests with a fresh server: **12 passed, 8 failed** | see below |
| Playwright utilities suites (`smart-utilities`, `hybrid-utilities`, `utilities-readiness`, including 390 px phone checks) | PASS in the full run | |
| Android `testDebugUnitTest` + `lintDebug` + `assembleDebug` | **359 tests, 0 failures**; lint and assemble PASS | |

**The 8 Playwright failures are pre-existing and not caused by Phase 3 (`Likely`).** Phase 3 changed no property,
expense or invoicing UI or API, and each spec predates the UI change it trips on:

| Spec | Failure | Cause |
| --- | --- | --- |
| `v1-closeout-ownership-accounting-referral` Flow D/E/F | `fill()` on "Category" | the expense category became a `<select>` in `957d54b` (3 Sep); spec last edited 29 Aug |
| `v1-closeout-browser-quality` (mobile width) | `fill()` on "Category" | same as above |
| `invoicing-workflow` K, L | "Send invoice" button not found | the invoices UI changed in `48f63bb` (1 Sep); spec last edited 30 Aug |
| `property-workflow-ui` (address fallback), `signup-and-onboarding` | wait for a URL; the app landed on `/properties/<id>?tab=Finances` | the post-create navigation target changed before Phase 3 |

These were not re-run at the pre-Phase-3 commit, so pre-existing is `Likely`, not `Verified`. Next action: update the
specs to the current UI (engineering, small).

**Not executed:**
- staging and production anything;
- Android on a device or emulator (the debug build points at production; G6);
- real hardware;
- retention at production volume (G7);
- e-mail or WhatsApp delivery to real recipients.

**Migration and rollback rehearsal** (representative copy of the main database at head 171): see
`UTILITIES_STAGING_DEPLOYMENT_PLAN.md` §1–2. In short:
- 175–181 took 0.9–2.7 s each;
- fingerprints were identical, and 120/120 legacy readings were mirrored;
- rollback was refused while data existed;
- after rollback, schema, data and extensions were identical to 174;
- re-apply succeeded.

## 4. Migration status

| Environment | Head | Evidence |
| --- | --- | --- |
| Repository | 181 (`20260101000181_utilities_phase3.sql`) | committed `801a60d` |
| Disposable stack `propvault_su` | 181 | fresh reset with all migrations; full pgTAP |
| Main local stack `propvault` | 171 (untouched; utilities 172–181 never applied there) | verified at the end (§6) |
| Staging | Unknown — no access | — |
| Production | Unknown — no access. Project memory says 172 and 174 are live; 175–181 are **not** applied | verify `select max(version) from supabase_migrations.schema_migrations` before deploying |

## 5. Readiness

- **Deployment:** ready for staging **on approval** (`UTILITIES_STAGING_DEPLOYMENT_PLAN.md` §9). Not ready for
  production until staging smoke tests pass and the pilot decisions are made.
- **Hardware:** a plan only. No device has reported through any adapter, and nothing was purchased. Every hardware
  path stays "implemented from documentation, untested".
- **Pilot modes available now:**
  - monitoring-only (no tariffs);
  - billing from manual readings with photo evidence (approved meters only).

## 6. Environment restored

- Disposable stack `propvault_su`: stopped (`--no-backup`).
- ClamAV container: stopped.
- Main local stack `propvault`: restarted from its own backup. **2,725 organisations, migration head 171** —
  unchanged and never reset.
- Uncommitted user files left untouched and unstaged: `marketing/`, `apps/admin/scripts/provision-production-demo-portfolio.mjs`.
