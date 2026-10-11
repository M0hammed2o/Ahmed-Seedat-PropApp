# Utilities — Final Test Results

**Date:** 2026-10-11. **Environment:** Windows 10 dev machine; disposable local Supabase stack (`project_id =
propvault_su`, rebuilt from migration zero through 180 for the test runs); Node 24, vitest 2.1.9, Playwright 1.62
(Chromium); Gradle 8.7; mock e-mail provider; local ClamAV container for the browser photo upload. **Nothing ran
against production, real hardware or real recipients.** Self-verified by the implementing agent, with an independent
read-only audit (three separate reviewers) used to find defects; no independent verifier re-ran these results.

## Results (final, clean runs after the last code change, commit `eb28de8`)

| Suite | Result |
| --- | --- |
| pgTAP, full (`supabase test db`) on a fresh stack | **102 files / 1 625 tests — PASS** (new: `utilities_hardening` 17) |
| Web vitest, full (`apps/admin`, all unit + real-DB integration) | **209 files / 1 574 tests — PASS, 0 failed, 0 skipped** (19.6 min) |
| — of which the previously failing `daily-jobs` real-DB idempotency test | **PASS** (was a 20 s timeout; not raised — root cause fixed) |
| Playwright `smart-utilities`, `hybrid-utilities`, `utilities-readiness` | **3 / 3 PASS** (7.4 min); screenshots `docs/qa/*-2026-10-1x/` |
| `next build` (3 GB heap) | **compiled; 89/89 pages** |
| `tsc --noEmit`, ESLint on changed paths | clean |
| Android `testDebugUnitTest` + `lintDebug` + `assembleDebug` | **62 suites / 359 tests, 0 failures; lint passed; debug APK built (24.7 MB)**, Gradle exit 0 |

New tests added in this audit: `auditFixes.test.ts` (15), `financialAudit.integration.test.ts` (14),
`municipalSafety.integration.test.ts` (5), `municipalPdfDeterminism.test.ts` (1), `utilitiesSwitch.integration.test.ts`
(2), `utilities_hardening.test.sql` (17), `e2e/utilities-readiness.spec.ts` (1); existing tests updated only where a
deliberate rule change required it (fixtures given billing arrangements, an authorised recipient, a leased unit; one
pgTAP message reworded to the stricter rule) — no assertion was weakened.

## Intermediate failures and what they were

| Run | Failure | Cause | Resolution |
| --- | --- | --- | --- |
| pgTAP after 179 v1 | `meter_integration_requests` org-level request refused | **Regression in 179**: property-in-org trigger rejected rows with no property | trigger skips `property_id is null`; re-run PASS |
| financial test | second tariff piece not created | 178's live-charge key lacked `segment_start` | key includes `segment_start` (179) |
| municipal test | retry content differed | **Real defect**: PDF bytes contained the render time | deterministic PDF |
| full vitest run #1 | 13 failures in 2 route files | I edited the routes and DB mid-run (artefact) | same files 15/15 in isolation; clean full re-run 1 574/1 574 |
| e2e readiness | photo upload refused | sensitive uploads require a real scanner (by design); then storage→DB timeout under memory pressure | local ClamAV; storage container restarted; PASS |

## Migration rehearsal (representative data)

Data-only copy of the local main database at head 171: 2 725 organisations, 1 886 properties, 737 units, 442 tenants,
477 leases, 1 766 invoices, 240 invoice lines, 1 722 payments, 620 journal entries, 303 documents, 42 utility meters,
120 readings, 1 117 users. Applied in order:

| Migration | Time |
| --- | --- |
| 172 storage_path_org_ownership | 0.92 s (after quarantining 31 local demo document paths — the migration's own guard refused them, by design; production already passed 172) |
| 173 coa_backfill_insight_ack_and_activity_dismiss | 1.19 s |
| 174 purge_deleted_account_auth_pii | 0.95 s |
| 175 smart_utility_metering | 1.84 s |
| 176 smart_utilities_engine_billing_reporting | 1.32 s |
| 177 utility_meter_location | 1.07 s |
| 178 hybrid_utilities | 1.20 s |
| 179 utilities_hardening | 1.75 s |
| 180 portfolio_intelligence_candidates | 1.01 s |

(times include Docker exec overhead.) Fingerprints (row count + MD5 of key columns) identical before/after for auth
users, invoice lines, payments, invoices, journals, leases, properties, tenants, units, utility meters and readings;
`documents` differs only by the deliberate quarantine. Post-checks: 0 utility tables without RLS, 0 invalid
constraints, 0 meters whose org differs from their property's, all 42 existing meters `consumption`, all organisations
`utilities_enabled`, exclusion constraint present, head 180. Partially configured properties (10 with legacy meters, no
tariffs/arrangements): overview, dashboard, charge generation and portfolio all succeed; 0 charges, 32 explained skips;
adding a fictional tariff + arrangement then generated exactly 1 draft charge.

**Finding during rehearsal:** the local main database has migration-173 columns (`notifications.dismissed_at`,
`portfolio_insights.acknowledged_at`) while recording head 171 — schema drift in the local environment, consistent with
the known "local main DB can't take 172". Not a production issue; recorded for whoever next upgrades the local DB.

## Performance (daily jobs)

| Measure | Before | After |
| --- | --- | --- |
| Orgs processed by Portfolio Intelligence (2 740-org copy) | first 500 by id, every day (rest never) | 317–385 candidates (only orgs with inputs), rotated if > 500 |
| Demo org with 1 028 rent schedules / 856 insights | failed every run ("URI too long"), insights never resolved | 117 ms; 847 stale insights resolved on first run |
| Whole daily-jobs run, same copy | 17–23 s | 7.7–20 s (large machine variance; first run per process slowest) |
| `daily-jobs` idempotency test (two runs, 20 s budget) | timed out | passes |

## Not run / not possible here
- Physical meters, gateways, inverters (none purchased) — see `UTILITIES_HARDWARE_PILOT_CHECKLIST.md`.
- Android emulator navigation: the debug build's `local.properties` targets the production backend, and the machine
  cannot run the emulator, Next dev server, Docker stack and ClamAV together. Covered instead by ViewModel tests, the
  tenant RLS tests (pgTAP + `hybrid.integration`), and the API route. Unblock: build with `API_BASE_URL` /
  `SUPABASE_URL` pointed at staging and walk Profile → Utility statements on a device.
- iOS (no iOS app in the repository).
- Production / staging databases (not touched).
