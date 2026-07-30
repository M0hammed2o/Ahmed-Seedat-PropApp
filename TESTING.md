# Testing

This document supersedes the PropVault-era `TESTING.md` entirely: the ownership model, accounting subsystem, permission model, and mobile platform have all changed (`DATABASE.md`, `ACCOUNTING.md`, `PERMISSIONS.md`, `MOBILE_ARCHITECTURE_DECISION.md`), so the test surface is rebuilt around org/tenant isolation and the double-entry ledger — the two highest-risk areas of the rebuild — rather than the single-owner CRUD surface PropVault tested.

## 0. Frameworks

| Layer                                  | Tool                                                                                                 | Where                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (pure logic)                      | Vitest                                                                                               | `packages/*` (validation, utils, config), plus posting-service logic wherever it lives (`supabase/functions/*` or an app-layer service package) |
| Unit/component (web)                   | Vitest + `@testing-library/react`                                                                    | `apps/web`                                                                                                                                      |
| RLS / policy                           | pgTAP-style `.sql` assertions via `supabase test db`                                                 | `supabase/tests/*` — retained pattern, extended from the existing `rls_isolation.test.sql` model                                                |
| Accounting invariants                  | Vitest (posting-service unit tests) + pgTAP (DB-level: no update/delete possible)                    | `packages/accounting` or equivalent + `supabase/tests/*`                                                                                        |
| Integration (multi-table transactions) | Vitest/Jest against a local `supabase start` instance, or pgTAP for DB-function-level transactions   | `supabase/tests/*` or `apps/web`'s integration suite                                                                                            |
| API contract                           | Vitest/Jest + `supertest`-equivalent against Next.js Route Handlers, or Playwright `request` fixture | `apps/web/app/api/**/*.contract.test.ts`                                                                                                        |
| iOS                                    | XCTest / Swift Testing, XCUITest                                                                     | `apps/ios`                                                                                                                                      |
| Android                                | JUnit/Kotlin Test, Compose `ComposeTestRule`                                                         | `apps/android`                                                                                                                                  |
| E2E (web)                              | Playwright                                                                                           | `e2e/` against a seeded multi-org staging environment                                                                                           |

`apps/mobile` (Expo) is not part of this strategy going forward — see §9.

## 1. Unit tests

Pure logic, no database, no network — the fast, always-green layer.

- **`packages/utils`**: date/currency helpers; `calculateMatchScore` (strong match, ambiguous match, no match, duplicate-proof detection — retained from PropVault, re-targeted at bank-line↔rent-payment matching per `ACCOUNTING.md` §8); file validation.
- **`packages/validation`**: every Zod schema (property, org, lease, tenant, application, journal-entry-adjacent input shapes) — valid and invalid cases, including the schemas that feed API-contract validation-failure tests (§5).
- **`packages/config`**: entitlement/feature-gating (`hasEntitlement`), plan/feature-limit logic per `DATABASE.md`'s `plans.feature_limits`.
- **Accounting posting-service functions** (highest-priority unit-test target, mirroring `ACCOUNTING.md` §1's three enforcement layers — this is layer 3, the app-level validation):
  - Balanced-entry acceptance: a `journal_lines` set where `SUM(debit) = SUM(credit)` posts successfully.
  - Balanced-entry rejection: an unbalanced set is rejected _before_ any insert — assert zero rows written, not a partial post (`ACCOUNTING.md` §1, §3).
  - Reversing-entry correctness: given an original entry, the generated reversal has exactly negated debit/credit values on every line, references the original via `reversed_by_entry_id`, and `is_reversal = true`.
  - Deposit-release gate: `POST /trust-ledgers/:id/release` (posting-service logic) is rejected when the linked lease's move-out `inspection.status != 'completed'`, accepted when it is (`ACCOUNTING.md` §4) — unit-tested at the service level in addition to the integration-level check in §3.
  - Each `source_type` (§`ACCOUNTING.md` §3 table) posts exactly the documented Dr/Cr lines for its trigger — one test per source type.
  - Ledger-class enforcement: a trust-class posting call from a non-trust workflow is rejected (§2's "never from general expense/rent posting" rule).

## 2. RLS / policy tests — highest priority for this rebuild

`supabase/tests/*.sql`, pgTAP-style, run via `supabase test db` against a local Postgres instance (`supabase start`, Docker). The existing `supabase/tests/rls_isolation.test.sql` is the model — same `set local role authenticated; set local "request.jwt.claim.sub" = ...` fixture pattern, extended from single-owner to org/role/tenant/owner scoping (`DATABASE.md` §12).

This is the single highest-priority test category in the rebuild: a multi-tenant SaaS's core promise is that Org A can never see Org B's data, and RLS is the layer of last resort even if the API layer has a bug (`ARCHITECTURE.md` — "two independent enforcement layers"). The following are non-negotiable test cases — no release ships without automated coverage of all of them:

1. **Cross-org isolation.** A member of Org A cannot `SELECT`/`INSERT`/`UPDATE`/`DELETE` Org B's `properties`, `units`, `leases`, `tenants`, `owners`, `applications`, `maintenance_tickets`, `journal_entries`, `journal_lines`, `documents`, `invoices`, `expenses`, `owner_statements` — one assertion pair (read-blocked, write-blocked) per table at minimum, run for at least two representative tables per module plus every accounting table (accounting gets full coverage, not sampling, given `ACCOUNTING.md`'s risk framing).
2. **Role-scoped write denial.** A `viewer`-role org member cannot write to _any_ table — `INSERT`/`UPDATE`/`DELETE` all rejected across at least one table per module (`PERMISSIONS.md` §2 table: viewer is view-only everywhere).
3. **Wrong-role-for-module denial.** An `accountant` cannot approve/mutate `maintenance_tickets` (accounting-only role touching an operations-only action) and, conversely, an `agent` cannot post to `journal_entries` (operations-only role touching an accounting-only write) — the role matrix in `PERMISSIONS.md` §2 is a grid, and both axes get tested, not just "can this role write at all."
4. **Tenant isolation.** A tenant can `SELECT` only their own `leases` (via `lease_tenants`), `rent_schedules`, `invoices`, `payment`-related `journal_lines`, `documents`, `maintenance_tickets`, `announcement_reads` — never another tenant's, even within the same org and even within the same property (`PERMISSIONS.md` §4, master prompt §10.2 — tenant-isolation protections are a hard rule, never waived).
5. **Owner isolation.** An owner can `SELECT` only their own `owner_statements` and only property/unit/lease summaries for properties they're linked to via `property_owners` — never another owner's statements, even a co-owner sharing the same property sees only their own row (`PERMISSIONS.md` §3).
6. **Journal/audit immutability — the sharpest test in the suite.** `journal_entries`, `journal_lines`, and `audit_events` reject `UPDATE` and `DELETE` from every role tested, including `principal` and any service-role-adjacent context available to the test harness — because `DATABASE.md` §12 and `ACCOUNTING.md` §1 both state there is **no** update/delete policy at all, for any role, on these three tables. Only the posting service's own elevated path may `INSERT` into `journal_entries`/`journal_lines`; `audit_events` is insert-only from the API layer, never from a direct client role. Test both directions: the documented insert path succeeds, and every other role/verb combination fails — not just a sample.
7. **Support-mode session scoping.** While a `support_access_sessions` row is active, the platform admin's effective access to the target org is read-only by default; any write requires the session's own escalation log — assert a platform admin without an active session cannot read/write an org's data at all (`PERMISSIONS.md` §6).
8. **Platform-admin table isolation.** An ordinary authenticated (non-platform-admin) user reads zero rows from `platform_admin_users` — retained directly from the existing test's `admin_users` case, renamed.

## 3. Accounting invariant tests

Distinct from §1's per-function unit tests: these assert properties of the _ledger as a whole_, closer to integration tests, and should run against a seeded multi-entry ledger, not single isolated postings.

- **Balanced-entry invariant**: for every posted `journal_entries` row in a seeded org, `SUM(journal_lines.debit) = SUM(journal_lines.credit)` grouped by `journal_entry_id` — no exceptions, across every `source_type`.
- **Reversal correctness**: for every `is_reversal = true` entry, its lines are the exact negation of the entry it references via `reversed_by_entry_id` (same accounts, same `property_id`/`owner_id`/`tenant_id` tags, negated debit/credit values) — and the original entry is provably unchanged (no `updated_at` column exists to check, so this is verified by re-reading the original row's lines and diffing against a snapshot taken before the reversal).
- **Trial balance always balances**: `SUM(all debits) - SUM(all credits) = 0` across an org's _entire_ ledger, not just per-entry — this is the DB-level truth behind `ACCOUNTING.md` §6's "Balanced" health check; run this as a standing assertion after every seeded-ledger integration test, since a false result here means the balanced-entry invariant was violated somewhere upstream and should fail CI loudly, not just display a UI warning.
- **Deposit release gate (integration level)**: attempt a `deduction`/`refund` posting against a trust ledger whose lease's move-out inspection is `scheduled`/`in_progress`/`awaiting_signature` → rejected; set the inspection to `completed` → the same posting succeeds. Cover this at both the service-unit level (§1) and here end-to-end through the actual API route, since `ACCOUNTING.md` §4 requires the check live in the service, not just the UI.
- **Ledger-class separation**: a seeded org's business-class and trust-class account balances never cross-contaminate — a trust deposit posting never appears in a business-class trial balance query and vice versa (`ACCOUNTING.md` §2).

## 4. Integration tests (multi-table transactions)

Target the transactions `ARCHITECTURE.md` calls out as "implemented as Postgres functions or Edge Functions wrapping an explicit transaction, never as client-side sequential API calls":

- **Application approval → tenant + lease + rent_schedule, atomically.** `POST /applications/:id/decide` with `decision=approved` creates all three rows in one transaction. Required negative case: force a failure partway through (e.g. a constraint violation on the `rent_schedules` insert via a malformed fixture) and assert the transaction fully rolls back — no orphaned `tenants` row with no `lease`, no `lease` with no `rent_schedules`. This is the single most important integration test in the leasing module because a partial failure here silently corrupts the tenant/lease relationship the rest of the system assumes is always complete.
- **Inspection completion → deposit release eligibility.** Signing both parties (or logging a tenant refusal) transitions `inspections.status` to `completed` only when the documented precondition is met (`DATABASE.md` §5 — "completion requires both signatures OR a logged refusal reason"); assert the status transition is rejected otherwise, at the transaction level, not just the UI.
- **Rent posting → journal entries.** A `rent_schedules` row reaching its due date (or manual invoice) produces exactly the documented `journal_entries`/`journal_lines` rows (`ACCOUNTING.md` §3) in the same transaction as the `rent_schedules.status` transition to `invoiced` — assert no partial state (schedule marked invoiced with no journal entry, or vice versa).
- **Owner-statement draft batching.** `POST /owner-statements/draft` skips owners who already have a draft for the period (evidenced idempotency behavior, `API_SPEC.md` §6) — assert a second call doesn't create duplicates.

## 5. API contract tests

Every endpoint enumerated in `API_SPEC.md` gets three tests at minimum, per its §10 enforcement rules:

1. **Documented success case** — valid auth, valid role, valid body → the documented response shape and status code.
2. **Documented permission-denial case** — cross-referenced against `PERMISSIONS.md`'s role matrix: a role below the endpoint's minimum (e.g. `viewer` calling any accounting-post endpoint, `agent` calling `POST /journal-entries/:id/reverse` which requires `accountant`+) → `403`. Where the resource belongs to another org, expect `404`, never `403` (`API_SPEC.md` §0 — org existence must not leak via status code); test this distinction explicitly since it's easy to implement backwards.
3. **Documented validation-failure case** — malformed/missing required fields against the endpoint's Zod schema → `400` with `field_errors`, never a generic `500` (`API_SPEC.md` §10).

Additional cross-cutting contract assertions, tested once generically rather than per-endpoint where possible:

- No endpoint accepts a client-supplied `org_id` as authoritative — a request with a spoofed `org_id` in the body for an org the caller doesn't belong to still resolves against the caller's real memberships (or 403s), never the spoofed value.
- Idempotency: a mutating endpoint accepting `Idempotency-Key` returns the original result on a repeated key + body, not a duplicate side effect (`API_SPEC.md` §0) — test at minimum on `POST /bank-transactions/:id/confirm-match` and the WhatsApp/email send paths.
- Every mutating endpoint's success case is paired with an assertion that an `audit_events` row was written in the same transaction (`API_SPEC.md` §0).
- Cursor pagination: `next_cursor` correctly `null`s at the end of a result set; offset-style query params are rejected/ignored, not silently supported.

## 6. Native mobile testing (iOS / Android)

Per `MOBILE_ARCHITECTURE_DECISION.md`, both platforms are full native rebuilds — no shared JS test suite carries over from `apps/mobile`.

**iOS (`apps/ios`)**

- XCTest / Swift Testing for view models and any business-logic-adjacent code (state machines, request-building, local validation) — never testing SwiftUI view bodies directly, matching the pattern of testing behavior, not rendering.
- XCUITest for critical flows end-to-end on-device/simulator.

**Android (`apps/android`)**

- JUnit/Kotlin Test for view models and equivalent logic.
- Compose UI testing (`ComposeTestRule`) for critical flows.

**Non-negotiable on both platforms**: no native test suite ships without covering these two flows specifically, since they're the master prompt's explicit native-app priorities (`MOBILE_ARCHITECTURE_DECISION.md` §6-7):

1. **Biometric-gated auth flow** — Face ID/Touch ID (iOS) / `BiometricPrompt` (Android) success, failure/fallback-to-passcode, and lockout state transitions; session-lock state machine (the portable _spec_ from `apps/mobile`'s `lockStateMachine`, re-implemented natively per `MOBILE_ARCHITECTURE_DECISION.md` §8).
2. **Maintenance-submission flow** — ticket creation with photo attachment, both directions (tenant submits, landlord/owner views and approves), since this is called out as the one full-flow module native apps carry (`MOBILE_ARCHITECTURE_DECISION.md` §6: "full flow both directions — this is the master prompt's explicit native-app priority").

Native-side validation (Zod-schema-equivalent rules re-expressed in Swift/Kotlin) is tested as UX-only — every native test in this category is paired with confirmation that the server remains the enforcement authority (`API_SPEC.md` §10, `MOBILE_ARCHITECTURE_DECISION.md` §8), i.e. a native test suite passing is never treated as a substitute for the corresponding API contract test in §5.

## 7. E2E tests (web)

Playwright (or equivalent), run against a **seeded multi-org staging environment** — deliberately not a single-org seed, because a single-org environment cannot surface cross-tenant leakage even if it exists (`ARCHITECTURE.md` — "verifying org A can never read org B's data is a standing staging-environment test, not a one-time check").

Critical path: org signup → property creation → lease creation (via application approval, exercising §4's atomic transaction) → rent invoice generation → bank-transaction payment match + confirm → owner statement draft + issue.

Cross-tenant leakage checks woven into the same suite, not a separate afterthought: while acting as Org A's `principal` throughout the happy path, assert at each step that Org B's seeded data (also present in the same staging environment) never appears in any list/search/dashboard response — this is what a multi-org seed buys over a single-org one, and mirrors the RLS tests in §2 but exercised through the full stack (API + UI), not just the database layer.

## 8. What CI runs on every PR vs. on-demand/nightly

Full E2E against staging is too slow (and too dependent on a persistent seeded environment) to gate every PR. Proposed split, extending the existing `.github/workflows/ci.yml` shape (`DEPLOYMENT.md` §CI: install → format → lint → typecheck → test → build → secret scan):

**Every PR:**

- Format, lint, typecheck (all packages/apps, native toolchains included where they exist).
- Unit tests (§1) — `packages/*`, posting-service logic, `apps/web`.
- RLS/policy tests (§2) — requires a local `supabase start` instance in CI (Docker-in-CI runner); this is the category most likely to catch a regression that actually matters, so it runs on every PR despite being the slowest of the per-PR categories, not deferred to nightly.
- Accounting invariant tests (§3).
- API contract tests (§5).
- Native unit/view-model tests (§6, unit portion only — XCTest/JUnit, not the UI-test portion) where `apps/ios`/`apps/android` exist and have changed files in the PR.
- `apps/web` build.

**Nightly / on-demand only:**

- Full E2E suite (§7) against seeded multi-org staging — slow, and staging-environment-dependent in a way that shouldn't block a PR merge on flakiness unrelated to the change.
- Native UI tests (XCUITest / Compose `ComposeTestRule`) — require simulator/emulator provisioning, run nightly plus on-demand for PRs touching `apps/ios`/`apps/android` UI code specifically.
- Integration tests (§4) that require a fully seeded multi-table fixture set are candidates for nightly if they prove too slow for per-PR budget once written; default assumption is per-PR unless measured otherwise, since the application-approval atomicity test in particular is high-value enough to want on every PR if it's fast.

## 9. Historical gaps — both closed 2026-07-30, kept here for the record rather than deleted

Both items previously listed here as open are now fixed and verified. Removing them silently would make it look like they were never real — they were, and here's the evidence:

- **~~`jest-expo`/Windows test-runner bug~~ — fixed.** Root cause was not Windows/Node-version-specific as originally guessed — it was a genuine upstream bug in `error-stack-parser@2.1.4` (confirmed still present in the latest published `3.0.0` too) that corrupts any file path containing literal parentheses, which this repository's own working directory (`PropValt (Property App)`) does. Fixed via a committed `pnpm patch` (`patches/error-stack-parser.patch`). Full trace and fix: `KNOWN_BUGS.md`. Verified: `pnpm --filter mobile test` → 3/3 suites, 12/12 tests pass; `pnpm test` (repo root) → 5/5 workspaces pass, the first fully-green run this project has had.
- **~~Expo Router typed-route typecheck failure~~ — fixed** (same session, earlier pass): 4 `TS2322` errors in `properties/[id]/processing.tsx`/`review.tsx`/`upload.tsx` corrected to Expo Router's typed `[id]`-segment + `params` form. Verified via `pnpm typecheck`.
- `apps/mobile` remains reference-only and not deployed to app stores (`MOBILE_ARCHITECTURE_DECISION.md`) — that architectural decision is unchanged by these fixes; fixing real, reproducible bugs in code that's still actively read/run during the native migration was worth doing regardless of the app's eventual retirement.
- **RLS test execution environment**: no longer assumed blocked without re-checking — Docker was found to actually be available in this environment (`docker ps` succeeds). Execution status against `supabase/tests/*.sql` is tracked live in `RISK_REGISTER.md` R-02 rather than duplicated here, since it was actively being re-verified as this document was last updated.
