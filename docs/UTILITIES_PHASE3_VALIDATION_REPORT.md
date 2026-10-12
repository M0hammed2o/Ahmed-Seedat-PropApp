# Utilities — Phase 3 Validation Report (staging validation & pilot preparation)

**Date:** 2026-10-12. **Environment:** local machine only.
- Disposable Supabase stack (`propvault_su`), freshly reset with migrations 001–183.
- A data-only representative copy of the main local database (2,725 organisations) for rehearsals.
- The main local stack was stopped with its data kept, never reset or seeded.
- Nothing was deployed, pushed, sent, invoiced, purchased, or changed in any hosted environment.

## 1. Repository and environment state (inspected, not assumed)

| Item | Finding |
| --- | --- |
| Migrations | Repository head is **183** (the brief referenced 172–180). Phase 3 added 181 (telemetry), 182 (off by default) and 183 (set-based RLS) |
| Previously reported fixes | All present in the code: pinned-address poll client (TD-66), constant-time cron secret, fail-closed switch, gated write routes, estimate/true-up, paging of telemetry loads |
| Historical results | pgTAP 1,625 / vitest 1,574 / Android 359 / Playwright 3 were superseded by this run's numbers (§7) |
| Main local DB | head 171, 2,725 organisations; **schema drift** — see below |
| Staging | **none exists or is accessible** from here. `DEPLOYMENT.md` designs a separate project. Prepared: the plan, exact commands with a re-link guard, smoke tests (`UTILITIES_STAGING_DEPLOYMENT_PLAN.md`) |
| Production | not contacted. Project memory says 172 and 174 are live and 175–183 are not applied. **Unknown** until the owner runs the read-only `supabase migration list --linked` |
| Linked project | this checkout's `supabase/.temp` is linked to "PropertyVault" (`Likely` production). The staging commands re-link and print the project name before any push |

**Schema drift in the main local DB:**
- It holds `notifications.dismissed_at` and `portfolio_insights.acknowledged_at` (from migration 173) while its history
  says 171, so 173 was partly applied outside the migration system.
- Every rehearsal restore shows 7 errors, all explained:
  - 5 are expected duplicates of rows the migrations create themselves (history, default categories, plans, storage
    bucket and storage migrations);
  - 2 are this drift.
- Handled properly, not bypassed: those two tables are restored only **after** 173 is applied (0 errors).
- Local-only: per project memory, production applied 173 normally.

## 2. Defects found and fixed in this phase

| # | Defect | Severity | Fix | Regression test |
| --- | --- | --- | --- | --- |
| D1 | **Per-row RLS:** every utilities policy ran the access helpers per row. A manager's meter list took **24.6 s**, and the portfolio page hit the statement timeout at 2,200 meters | P1 (scale) | Migration 183: the same helper runs once per candidate property (member orgs, property grants, support sessions) → **0.72 s** | pgTAP `utilities_rls_set_based` 7/7 (incl. support-session read, no write); full pgTAP |
| D2 | **Silent 1,000-row truncation:** the API caps responses at 1,000 rows, and unpaged queries ignored it. The daily job analysed **1,000 of 6,601** meters and monthly snapshots missed **5,611** meters; the portfolio and switch lookups were capped too | P1 (scale, silent) | `fetchAll` / `fetchAllIn` paging in jobs, alerts, portfolio and switch lookups | `paging.test.ts` 4/4; benchmark shows 6,601/6,601 |
| D3 | A busy level sensor hid other sources' latest reading (shared capped query) | P2 | Queried per source | integration test **fails on the old code**, passes on the fix |
| D4 | **Tenants could not dispute** utility charges (journey gap) | P1 (before billing) | `POST /tenant-portal/utility-statements/:id/dispute`: own approved statement only; blocks invoicing; amounts unchanged; staff notified; audited; rate-limited | integration test (incl. another tenant → 404) |
| D5 | Invoices list lost its "Sent" indicator; company and trust owners shown identically | P2 | Restored / labelled | browser tests |
| D6 | **Utilities on by default** for every organisation; read errors treated as enabled; 9 write routes ungated (incl. municipal approval, which sends e-mail) | P0 (pilot safety) | Migration 182 + fail-closed checks + gates | switch, evidence, pgTAP |

Phase 3 Brief 3 fixes (still in place): estimates and true-up, batch ingest, retention, mirrored monthly readings,
pinned poll client, TD-61 flag.

## 3. Billing accuracy

See `UTILITIES_BILLING_RECONCILIATION.md`. Every hand-calculated case matched exactly. The cases cover:
- VAT-inclusive and VAT-exclusive pricing with half-up rounding;
- block, flat, seasonal and TOU tariffs (TOU refusal), fixed charges and proration;
- tariff changes, move-in/out and meter replacement;
- shared water and electricity meters;
- estimates, true-up, credits and disputes;
- duplicate prevention, void and regenerate;
- hybrid, prepaid, rainwater and monitoring-only setups.

No hybrid register was ever billed. Invoices stayed drafts.

## 4. Smart-meter readiness

See `UTILITIES_HARDWARE_COMPATIBILITY.md`. All adapters are validated by simulation only, and every physical path still
needs a device test. New this phase: out-of-order backfill after a reconnection (valid, no false reset, last reading
monotonic, replay = duplicates). ThingsBoard SSRF/DNS rebinding is mitigated (pinned connection), and polling is off
by default.

## 5. Municipal submissions

Covered by existing integration tests, all re-run green this phase:
- recipient configuration and authorisation;
- schedules;
- idempotent draft packs (one per period);
- evidence photos frozen at approval;
- approval permissions (viewer/outsider refused);
- approval withdrawn on any content change (hash);
- no send without an authorised recipient;
- retries at 1 h / 6 h / 24 h, then stop and notify;
- audit;
- sending paused for switched-off organisations.

Automatic sending stays off (`SMART_UTILITY_AUTO_SUBMISSION_ENABLED` unset). Only the mock e-mail provider was used.

## 6. Scalability (disposable database; `scripts/utilities-scale/`)

**Dataset:** 3 orgs, 300 properties, 3,000 units, 6,600 connected meters, 1.25 M readings, plus 20 meters at
15-minute resolution. Seeded in 524 s.

| Operation | Before fixes | After |
| --- | --- | --- |
| Manager meter list (RLS) | 24.6 s (timeout) | **0.72 s** |
| Portfolio, 100 properties (manager session) | failed (statement timeout) | **2.5 s** |
| Property dashboard, 30 days | — | **2.0 s** |
| Draft charges, per property (10 units) | 0.36 s | **0.42 s** (≈ 2 min for 300 properties) |
| Daily Smart Utilities job | 0.3 s **but only 1 of 6,601 meters analysed (manual) / 1,000 (connected)** | **9.9 s, 6,601/6,601 meters** |
| Billing-day job (reconciliation + snapshots) | snapshots for 1,000 meters only | **32.9 s**: 602 reconciliation scopes, 6,601 snapshots |
| Ingest, 500-reading batch | — | **0.45 s** |

Indexes in use: the telemetry `(meter_id, read_at)` index is used by every range query (EXPLAIN checked for the
30-day read: ~1 s including the RLS set).

**Remaining, P2:**
- the per-property helper cost (~3 ms per property) grows with the number of properties a user can see;
- the non-utilities `portfolioIntelligence` uses `.limit(10_000)`, which is subject to the same 1,000-row cap.

## 7. Regression results (exact)

All on 2026-10-12, against a fresh disposable stack (001–183).

| Gate | Result |
| --- | --- |
| pgTAP | **104 files, 1,653 tests — all pass** (includes the new `utilities_rls_set_based` 7 tests) |
| Vitest, whole app | **217 of 219 files; 1,600 passed, 1 failed, 3 skipped (1,604).** The failure is `ownerSummary` idempotency (not utilities). The local API gateway returned "invalid response from upstream"; the test passes **4/4 twice** run alone |
| Utilities suites after 183 + paging | 32 files / 246 tests pass; plus reconciliation 3/3, backfill 1/1, paging 4/4, sources 1/1, tenant dispute 1/1 |
| Scale benchmark | passes (§6) |
| Pilot demo seeder | passes (earlier this phase) |
| TypeScript | pass |
| ESLint | application code clean; 5 pre-existing errors in 3 untouched demo scripts |
| `next build` (production) | pass |
| Android unit + lint + assemble | **359 tests, 0 failures**; lint and assemble pass |
| Migration rehearsal (representative copy, 2,725 orgs) | 175–183 at 0.5–1.8 s each; fingerprints identical; 120/120 readings mirrored; rollback guard refused; after rollback schema, data and extensions identical to 174; re-apply OK; **0 of 2,725 organisations enabled** after 182 |
| Playwright, whole app | **could not be run reliably on this machine.** Batched run (23 files, 87 tests, `CI=1`): **52 passed, 10 flaky, 26 failed** — see below |

**Why the browser suite is not evidence either way.**
- The host CPU ran at **68–78 % with no tests running**.
- The Docker VM (8 GB) is shared with other projects' long-running containers (`nextgen-rc0051-*`, `gb-*`,
  `bevline-*`).
- Under test load, Supabase's own auth service exceeded its 10 s deadline. Creating a test user returned **504**,
  while idle the same call took 0.6 s.
- The stack could only restart after stopping ClamAV, because storage came up unhealthy under memory pressure.
- Every failure examined was one of:
  - an auth 504 or other 504 / connection refusal / worker crash;
  - a timeout;
  - a check that never saw its result because an earlier request timed out. The municipal-settings "HTTP 404"
    happened in the browser only; the same route returns 200 in its integration test.
- None pointed at an application defect.
- The three utilities browser specs passed in the previous session after migration 182. **After 183 they are not
  re-verified in a browser**; the RLS change is covered by pgTAP (1,653) and the integration suites.
- **P1-W:** run `CI=1 npx playwright test` on CI or a dedicated machine before any production step.

## 8. User journeys

| Journey | Coverage | Result |
| --- | --- | --- |
| Landlord: property → sources → meters → tariff → readings → consumption → draft charges → statement | pilot, demo, reconciliation and hybrid integration (pass). Browser specs passed in the previous session (desktop, tablet, phone 390 px); after 183 not re-verified in a browser (§7) | pass (integration); browser re-run pending (P1-W) |
| Property manager: multiple properties → anomalies → verify readings → billing → approvals | portfolio (scale), anomaly jobs, evidence/verification tests, approval + dispute blocking | pass (integration) |
| Tenant: consumption → charges → statement download → dispute | tenant statements API (Android uses it), PDF, **new dispute endpoint** | pass (integration); Android dispute screen not built (P2) |
| Administrator: organisations → feature restrictions → audit → failed jobs | switch tests (off by default), audit events asserted, job step results returned by `/system/*-jobs` | partial: no Super Admin view of the switch or job history (P2) |
| Android | 359 unit tests; reading capture → mirrored telemetry (pgTAP); tenant statements API | pass (unit). No physical device or emulator against local/staging (the debug build targets production) |

## 9. Remaining items (classified)

See `UTILITIES_PRODUCTION_GO_NO_GO.md` for the P0–P3 list.
