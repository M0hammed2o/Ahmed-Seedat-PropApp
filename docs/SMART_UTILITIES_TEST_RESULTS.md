# Smart Utilities — Test Results

**Environment:** Windows 10 dev machine, local Supabase throwaway stack (`project_id = propvault_su`, migrations applied
from zero through 177), mock email provider (no `RESEND_*`), Node 24, vitest 2.1.9, Playwright 1.62 (Chromium).
Machine had 0.5–1.7 GB free RAM throughout. **Nothing ran against production or real hardware.**

## Latest results (2026-10-10, end of session)

| Suite | Result |
| --- | --- |
| pgTAP full suite (`supabase test db`) | **100 files / 1,580 tests — PASS** |
| pgTAP utility files: `smart_utility_metering` (34), `smart_utilities_engine_billing` (20), `recurring_property_costs_and_utilities` (23) | 77/77 |
| Vitest unit — `lib/smartUtility/__tests__` (engines 34, municipalReport 12, engine.v2 23, catalogue 5, evidence 2) | 76/76 |
| Vitest real-DB integration — Phase 1 ingestion/submissions (20), engine (7), reporting (9), evidence (4), billing (6), jobs (3) | 49/49 |
| Playwright — `e2e/smart-utilities.spec.ts` (catalogue → add meter → review reading → preview/approve email → 390 px no overflow) | 1/1 (screenshots in `docs/qa/smart-utilities-2026-10-10/`) |
| Regression batches: components | 45 files / 178 passed |
| Regression batches: `lib` | 88 files / 936 passed, 3 skipped |
| Regression batches: `app/api` | 41 files / 249 passed |
| Regression batch: everything else (filter matched 197 files) | 1,486 passed, 3 failed, 3 skipped — see below |
| `tsc --noEmit`, eslint on all changed code, `next build` | clean |

### The 3 failures in the last regression batch

| Test | Cause | Status |
| --- | --- | --- |
| `crossOrgStorageAccess.integration` "THE EXPLOIT…" (5 s timeout) | Ran while other vitest files hit the same database (contention, per project memory) | **Passes in isolation** |
| `expenses/:id/record` evidence gate (12 s) | Same contention | **Passes in isolation** |
| `daily-jobs` real-DB idempotency (2 full runs, 20 s budget) | Measured: the existing `portfolioIntelligence` job takes 23–27 s per run on this DB (≈618 accumulated test orgs, hitting its own 500-org cap); the smart-utility step takes 0.23–0.56 s | **Still fails in isolation — pre-existing job cost on a bloated test DB, not this work**; budget deliberately not raised |

A real regression from this work **was** found and fixed in the same batch: the daily-jobs *orchestration* test ran the
smart-utility step unmocked; it now mocks it like every other job and asserts it runs last (passes).

## Bugs found by tests and reviews this session (all fixed)

1. Catalogue honesty test: two pulse-counter entries lacked their accuracy caveat.
2. Locale: en-ZA formats numbers as `1 035,5` — test expectations corrected (behaviour kept).
3. PDF layout: wrapped evidence values overlapped the next row; photo caption overlapped the image (found by visual review).
4. **Browser walk-through:** the municipal preview showed the last complete period while its scheduled send covers the
   current one — owners would have approved a different period than the one sent.
5. Reference-doc review: scheduled packs could not be cancelled/resent; SSRF guard missed CGNAT/benchmark ranges and
   followed redirects; toggling photos didn't withdraw approval; status sync was N+1.
6. Approve endpoint returned `approved` while storing `scheduled`.

## Not tested

Physical meters, gateways or live ChirpStack/TTS/ThingsBoard servers; real email delivery (mock provider only);
photo upload through the browser (the e2e avoids uploads so Cloudmersive is never called); Android/iOS.
