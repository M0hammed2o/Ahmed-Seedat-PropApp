# Utilities — Staging Readiness & Pilot Preparation Report

**Date:** 2026-10-12. **Environment:** local machine only.
- All tests ran against a disposable Supabase stack (`propvault_su`), freshly reset with migrations 001–182.
- The main local stack holding customer-like data (2,725 organisations, head 171) was stopped with its data kept;
  it was never reset or seeded.
- Nothing was pushed, deployed, sent, invoiced, purchased or changed in any hosted environment.

## 1. Recommendation

**GO for a staging deployment** (pending your approvals in §7), then a **monitoring-only pilot** for one
organisation once the staging smoke tests pass. **NO-GO for production** and for billing tenants until the legal and
VAT decisions are made. Details in §9.

## 2. Completed work

| # | Area | What | Commit |
| --- | --- | --- | --- |
| 1 | Browser tests | Investigated all 8 Playwright failures. **2 real application defects fixed**: the invoices list had lost its "Sent" indicator; the owner-type dropdown showed company and trust as two identical "Entity / Company" options. **6 tests were outdated** after deliberate product changes (expense category list, invoice Actions menu, a new property opening on Finances, the property name added to the header). They were updated without weakening any assertion | `7cda7cc` |
| 2 | Browser tests | A first-time route compile on `next dev` exceeded 15–30 s on this machine. `COLD_ROUTE_MS` (60 s) is used **only** at first-hit steps, and the full run uses the project's CI retry policy (1 retry). A global warm-up was tried and **rejected**: it corrupted the dev server's compile state | `7cda7cc` |
| 3 | Pilot restriction | **Migration 182:** Smart Utilities is OFF for every organisation, existing and new. The app **fails closed** everywhere (missing value or lookup error = off) | `a11c2f8`, `d1eed26` |
| 4 | Authorisation | Closed gaps where a switched-off organisation could still act. The 9 routes now gated are listed below this table | `a11c2f8` |
| 5 | Rollback | Rollback script extended to 182 and checked inside a rolled-back transaction (column dropped, history back to 174, tables gone; database unchanged afterwards) | `a11c2f8` |
| 6 | Pilot demonstration | Reusable, fictional seven-flat demo (`docs/UTILITIES_PILOT_DEMO.md`), built through the real billing and statement code. It checks every amount (R3,940.00 month, R60.00 true-up) and every access restriction as each person, and refuses to run anywhere but a confirmed disposable local stack | `4ad4340` |
| 7 | Staging instructions | Exact command sequence with a re-link guard (`UTILITIES_STAGING_DEPLOYMENT_PLAN.md` §10) | docs commit |

Routes gated in row 4:
- **municipal submission actions (approval sends e-mail to the municipality);**
- recipient authorisation;
- meter-integration actions (including sync of the customer's server);
- manual readings;
- meter edit and replace;
- reading review;
- alert status;
- poll sync and approval reminders in the daily jobs.

## 3. Exact test results

Every run was on 2026-10-12, against a fresh disposable stack reset with migrations 001–182.

| Gate | Result |
| --- | --- |
| pgTAP (`supabase test db`) | **103 files, 1,646 tests — all pass** (includes the new check that a new organisation starts off) |
| Vitest, whole app (unit + integration) | **213 of 214 files; 1,593 of 1,594 tests pass.** 1 failure: `malwareScan.integration`, "reports a clean file as clean", timed out at 5 s on its first ClamAV scan under full-suite load. It passes **3 of 3** run alone. Pre-existing test, not changed |
| Utilities tests after the switch change | 27 files / 225 tests pass; switch test 3/3; evidence route 8/8 (incl. 403 `utilities_disabled`) |
| Pilot demo seeder | 2/2 (every amount and access check); refuses without confirmation (verified) |
| TypeScript (`tsc --noEmit`) | pass |
| ESLint | application code clean; 5 errors in 3 demo scripts not touched by this work (one is the user's untracked `provision-production-demo-portfolio.mjs`) |
| `next build` (production) | pass |
| Android `testDebugUnitTest` + `lintDebug` + `assembleDebug` | **359 tests, 0 failures**; lint and assemble pass |
| Playwright, the 8 previously failing tests | all fixed. Shown passing in targeted runs: Flow D and F, invoice K and L, signup and address fallback. Flow E and the mobile-width expense failed only on cold-compile timing; `COLD_ROUTE_MS` was then applied (§4) |
| Playwright, utilities specs (after migration 182) | `hybrid-utilities` pass; `utilities-readiness` pass; `smart-utilities` **flaky** (passed on retry) |
| Playwright, whole app (87 tests, `CI=1`, 1 retry) | **53 passed, 4 flaky, 29 failed, 1 did not run.** **None of the 29 is an assertion failure.** 19 are `ECONNREFUSED` after the `next dev` server died; 2 are Playwright worker crashes (Windows `0xC0000409`); 8 are navigation or test timeouts. See §4 |

## 4. Outstanding failures

**Whole-app browser suite: not completed reliably on this machine (environment, not code).**
- The `next dev` server and Playwright workers crashed under memory pressure. Free RAM was about 0.45–1.4 GB of
  16 GB, and VS Code, Docker, Chrome and the Supabase stack were all running.
- A **separate Playwright run from another project** (`Downloads/v9/e2e-tests`, another session of yours) ran
  concurrently from about 02:17. During the batched re-run, even Supabase's own auth admin API returned 504 timeouts.
- **Evidence it is environmental:**
  - every failure is a connection refusal, a crash or a timeout; none is a failed `expect` about behaviour;
  - the same tests passed in earlier targeted runs this session and in Phase 3.
- **Classification:** `Likely` environmental; `Unknown` until run on a quieter machine or CI.
- **Next action (engineering):** run `CI=1 npx playwright test` on a machine with more free memory, or in CI, as part
  of the staging gate. Do not merge-gate on this laptop's results.

**Pre-existing, unrelated:**
- `malwareScan.integration` times out at the 5 s default on a cold ClamAV under load; it passes alone.
- 5 lint errors in demo scripts this work never touched.

**Not executed:**
- staging or production anything (no access, no approval);
- Android on a device or emulator (the debug build points at production);
- real hardware;
- e-mail or WhatsApp delivery.

## 5. Migration readiness

| Environment | Head | How verified |
| --- | --- | --- |
| Repository | **182** (`20260101000182_utilities_off_by_default.sql`) | committed |
| Disposable stack | 182 | fresh reset from 001; pgTAP 1,646/1,646 |
| Main local stack (customer-like copy) | **171** | `select max(version)` before stopping it this session; 2,725 organisations |
| Staging | **Unknown.** `DEPLOYMENT.md` designs a separate staging project, but no evidence that one exists | owner |
| Production | **Unknown** — not contacted. Project memory: 172 and 174 live; 175–182 **not** applied | owner runs the read-only `supabase migration list --linked` |

- Dependencies: 175 → 182 apply in order on top of 174 (rehearsed on representative data in Phase 3; 182 checked on
  a fresh reset).
- 182 has no data dependency: it only sets the column default and switches every organisation off.
- **Warning:** this checkout's `supabase/.temp` is linked to the hosted project named "PropertyVault" (`Likely`
  production). The staging commands re-link first and print the project name before anything is pushed.

## 6. Security and financial risks (residual)

| Risk | Status |
| --- | --- |
| A switched-off organisation acting through utilities | closed: write routes, jobs and ingestion are gated and fail closed; tests prove 403 / no reminders / no polling / no sends |
| Automatic billing, municipal submission or tenant e-mail without authorisation | none possible. Charges are created only on request and are drafts; invoices are drafts; statements need approval, a flag and a person; municipal sending needs an approved template, an authorised recipient, a schedule and a flag |
| Tenants changing prices or bills | denied by RLS (pgTAP); demo seeder confirms as a signed-in tenant and a signed-in owner |
| VAT for VAT-registered landlords (TD-61) | **open (decision):** flagged on each charge; ledger split is manual |
| Recharge legality per site (NERSA, municipal by-laws) | **open (legal):** Proplyst makes no legal claim; review flags only |
| Hardware data accuracy | **open:** no device tested; manual readings with photos are the fallback |
| Linked hosted project in this checkout | **operational risk:** mitigated by the re-link guard in §10 of the staging plan |

## 7. Remaining external decisions (owner)

1. Approve pushing the commits.
2. Create or confirm a **separate staging Supabase project**, and approve applying 175–182 there.
3. Choose the pilot organisation and run the one `update … set utilities_enabled = true` statement.
4. Recharge legality at the pilot site, or run the pilot **monitoring-only**.
5. VAT treatment (accountant).
6. Hardware budget and quotes (only for a device pilot).
7. Production deployment, separately and later.

## 8. Pilot acceptance criteria (monitoring-only pilot, one organisation)

1. All 11 staging smoke tests pass (plan §6).
2. Only the pilot organisation has Smart Utilities on, and a newly created organisation is off.
3. Manual readings with photo evidence are recorded for every pilot meter for 2 consecutive months.
4. Each monthly figure matches the meter photo within one register unit.
5. Supply balance (dashboard) explains at least 90 % of measured main-meter use, or the gap is investigated.
6. No e-mail is sent to tenants or municipalities during the pilot (logs and `municipal_submission_deliveries` empty).
7. If billing is in scope: two cycles of draft charges are checked by hand against photos before any approval, and no
   charge cites a non-consumption meter.
8. Tenant users see only their own approved statements; the owner sees the dashboard and cannot change tariffs
   (repeated on staging with real accounts).

## 9. GO / NO-GO

| Release step | Verdict | Why |
| --- | --- | --- |
| Push the commits | **GO** on your approval | code, migrations, tests and docs are complete locally |
| Staging deployment (175–182) | **GO** on your approval, with the §10 re-link guard | pgTAP, vitest, build, Android and utilities e2e pass; rollback script checked; nothing turns on by itself (everything is off by default) |
| Whole-app browser regression | **Run on staging/CI first** | could not be completed on this machine (environment) |
| Monitoring-only pilot, one organisation | **GO after** the staging smoke tests and acceptance criteria 1–6 | no tariffs, no billing, no sending needed |
| Tenant billing in the pilot | **NO-GO** until recharge legality is confirmed and the VAT treatment is decided | external decisions |
| Hardware pilot | **NO-GO** until the budget is approved and devices are commissioned | nothing purchased or tested |
| Production | **NO-GO** for now | needs a successful staging run and pilot, PITR and a dump, and separate approval |
