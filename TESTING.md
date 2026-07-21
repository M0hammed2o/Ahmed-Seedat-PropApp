# Testing

## Frameworks

- **Vitest** for all pure-logic unit tests in `packages/*` (fast, no RN/Next runtime needed) and for `apps/admin` component/unit tests (`@testing-library/react`).
- **Jest + jest-expo** for `apps/mobile` (the standard, Expo-supported RN test runner — chosen over Vitest for the mobile app specifically because RN's Metro/Hermes runtime and native module mocks are what jest-expo is built and maintained for).
- **SQL/RLS policy tests**: `.sql` test files under `supabase/tests/` written against `pgTAP`-style assertions, intended to run via `supabase test db` against a local `supabase start` instance. This sandbox does not have Docker/a live Supabase instance available, so these are written and documented but their execution is reported as Blocked in the final delivery report — see KNOWN_BUGS.md/Unresolved section for exactly what's outstanding and how Mohammed can run them locally.

## What Phase 1 actually has automated tests for

- `packages/utils`: month/date helpers, currency formatting, **payment-match confidence scoring** (multiple scenarios: strong match, ambiguous match, no match, duplicate-proof detection), file validation (MIME/extension/size).
- `packages/validation`: schema tests for property, registration, login, document-upload-metadata schemas (valid + invalid cases).
- `packages/config`: entitlement/feature-gating logic (`hasEntitlement` across subscription states).
- `apps/mobile`: unit tests for the biometric lock state machine and the mock subscription provider; a component smoke test for `PropertyCard`.
- `apps/admin`: unit test for `requireRole()`/admin gate logic; a component smoke test for `AdminMetricCard`.

## Critical test cases from the brief — Phase 1 status

| Case                                                                                | Status                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registration / email verification                                                   | Implemented (Supabase Auth flow); automated test covers form validation only — full email-delivery flow requires a live Supabase project (manual verification needed, see final report).                           |
| Login / logout                                                                      | Implemented; unit-tested at the validation-schema level. Full integration test against live Supabase deferred (needs project).                                                                                     |
| Biometric unlock success/failure                                                    | Lock state machine unit-tested (mocked `expo-local-authentication`).                                                                                                                                               |
| Add/edit property                                                                   | Implemented; form validation unit-tested.                                                                                                                                                                          |
| Upload valid PDF / reject invalid file                                              | `packages/utils/fileValidation` unit-tested for both paths.                                                                                                                                                        |
| Strong / ambiguous / no payment match, duplicate proof                              | `packages/utils/matching` unit-tested for all four.                                                                                                                                                                |
| Partial payment                                                                     | Covered by `payment_matches` schema design + matching scorer tests (multiple-bills-per-payment case); no live payment flow yet in Phase 1.                                                                         |
| Monthly checklist state                                                             | `calculate_monthly_checklist` SQL function written; policy/integration test written under `supabase/tests/`, execution Blocked (needs live instance).                                                              |
| Expired subscription / restore purchases                                            | `MockSubscriptionProvider` state transitions unit-tested.                                                                                                                                                          |
| User data isolation / admin authorisation / webhook idempotency / signed URL expiry | RLS and idempotency **implemented in migrations**; automated verification Blocked pending a live Supabase instance — manual `supabase start` + `supabase test db` run is the documented next step (DEPLOYMENT.md). |
| Recover interrupted upload / offline handling                                       | Interface designed (`DocumentRepository.resumeUpload`), not fully implemented in Phase 1 — tracked in TODO.md.                                                                                                     |

Per DEVELOPMENT RULES: nothing above is claimed "tested" without an actual automated test existing for it; where only manual/live-instance verification is possible in this environment, that is stated explicitly rather than implied.
