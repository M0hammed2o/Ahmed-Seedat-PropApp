# Tasks — Implementation Milestones

Breaks the implementation into milestones in the exact order confirmed by Mohammed (2026-07-30): multi-tenant schema → authentication → roles and permissions → organizations → properties → units → owners → tenants → applications → leases → documents → OCR → maintenance → accounting → notifications → email → WhatsApp → AI → Super Admin → responsive web → native iOS → native Android → automated testing → deployment → engineering requirements. (Supersedes this file's previous, more coarsely-grouped 16-milestone structure — reordered 2026-07-30 per restated instruction, not a re-derivation from scratch; see `DECISIONS.md`.)

Each milestone is scoped so the repository **compiles, passes its tests, has updated docs, and is deployable** at the end of it. Status legend: `[ ]` not started, `[~]` in progress, `[x]` done. Updated at the end of every milestone, not just at the end of a session.

---

## M0 — Safety checkpoint

- [x] `pre-propertyvault-pivot` backup branch created at the last committed PropVault-era commit (non-destructive branch pointer, no commit made).
- [~] Pre-existing uncommitted working-tree changes (`.github/`, error boundaries, `components/tables/`, `reference/`, noted at session start) remain uncommitted and untouched — not silently discarded, not committed without Mohammed's explicit ask.

## M1 — Multi-tenant schema

- [x] Migrations: `organizations`, `organization_members`, `organization_invites`, `plans`, `organization_subscriptions`, `subscription_payments`, `support_access_sessions` (`DATABASE.md` §1-2).
- [x] `units`, `owners`, `property_owners` (org-scoped from day one) + nullable `properties.org_id` "expand" step (`DATABASE.md` §3).
- [~] `properties.owner_user_id` → `org_id` "contract" step done for `properties` (M5, relaxed not dropped — see M5's own entry); `documents`/`bills`/`payments`/`payment_matches`/`extraction_jobs`/`subscriptions`/`audit_events` (`EXISTING_CODEBASE_AUDIT.md` §2) not yet cut over.
- [x] **All 24 migrations verified against a genuinely clean local Postgres database** (`supabase start`/`supabase db reset`, 2026-07-30) — not just reviewed statically. Found and fixed 4 real bugs execution surfaced that static review missed: a forward-reference (policy in migration 17 needing a table from migration 18), a DROP COLUMN blocked by cross-table RLS dependencies (migration 23), an infinite-recursion RLS policy on `organization_members` (self-referencing subquery in its own policy), and a project-wide missing-`GRANT`s gap present since this project's very first migration (new migration `20260101000024_grants.sql`). Full detail: `WORKLOG.md` 2026-07-30, `RISK_REGISTER.md` R-02.
- [x] RLS isolation tests **executed and passing**: 15/15 pgTAP assertions across `rls_isolation.test.sql` and `multi_tenant_isolation.test.sql` (`supabase test db`) — cross-org isolation, role-scoped write denial, platform-admin table isolation all confirmed for real, not just written. Two test-assertion bugs (`throws_ok` used where an RLS-filtered UPDATE correctly doesn't throw) fixed along the way — one in the new test file, one in the original PropVault-era file that had never actually run before.
- **Exit criteria**: met for everything in scope — net-new multi-tenancy tables exist, RLS'd, verified against a real database, `pnpm typecheck`/`lint` green. Cutover of the remaining seven pre-existing single-owner tables is tracked under M5/TD-02, not treated as part of "schema" in the abstract.

## M2 — Authentication

- [x] Supabase Auth retained unchanged as identity provider (`ARCHITECTURE.md` § Retained from PropVault) — no rebuild needed.
- [x] Session resolution for multi-portal identity — `resolvePortalSession()` (`apps/admin/lib/orgSession.ts`) resolves org memberships + owner identities for the authenticated caller. Tenant-identity resolution deferred to M8 (table doesn't exist yet).
- [x] Demo-mode bypass fix (`SECURITY.md`) — **implemented and build-verified 2026-07-30**: `packages/config/src/demoMode.ts` (`resolveDemoMode()`, dual-gated, both default false), `apps/admin/lib/demoMode.ts` (+ `server-only` import), `apps/mobile/src/lib/supabase.ts`, `apps/mobile/eas.json` (production profile omits the second gate), `.github/workflows/ci.yml`. Verified: `pnpm --filter admin build` with only `NEXT_PUBLIC_DEMO_MODE=true` set produces zero demo-mode activation; with both gates set, demo mode activates as intended. CI production-_deploy_ assertion (distinct from this build-time fix) remains M24 work, since no deploy pipeline exists yet to assert against.
- **Exit criteria**: met — demo-mode bypass closed, session resolution built and typechecked. Tenant-portal session resolution (needs the `tenants` table) is M8's concern, not a gap in this milestone's own scope.

## M3 — Roles and permissions

- [x] `has_org_role()` security-definer helper, org-role RLS pattern (`DATABASE.md` §12, `PERMISSIONS.md` §2).
- [x] `create_organization()`/`accept_organization_invite()` RPCs enforce role assignment atomically (principal on creation, invited role on acceptance).
- [ ] `is_admin()` → `is_platform_admin()` / `admin_users` → `platform_admin_users` rename — deferred to M19 (Super Admin), see `DECISIONS.md` 2026-07-30.
- [x] RLS isolation tests **written AND executed** (`supabase/tests/multi_tenant_isolation.test.sql` + `rls_isolation.test.sql`, `supabase test db`, 2026-07-30) — 15/15 pgTAP assertions pass: cross-org isolation, role-scoped write denial (viewer cannot write within their own org either), platform-admin table isolation. Docker was confirmed available in this environment; the "no Docker" assumption this milestone previously carried was stale and never re-checked. R-02 closed (`RISK_REGISTER.md`).
- **Exit criteria**: fully met. Helper functions, policies, and test coverage exist, typecheck, and are verified passing against a real database — nothing left open in this milestone.

## M4 — Organizations

- [x] `organizations`, `organization_subscriptions`, `organization_invites` schema.
- [x] Org signup flow — `POST /api/v1/organizations` (`apps/admin/app/api/v1/organizations/route.ts`) + `/onboarding/create-organization` UI, 2026-07-30. Invite-acceptance endpoint (`POST /api/v1/organizations/invites/accept`) also implemented, pairing with `accept_organization_invite()`.
- [ ] Organisation compliance-profile settings screen (CIPC/VAT/SARS/POPIA/FFC, Team Seats) — web UI not yet built; `PATCH /api/v1/organizations/:orgId` endpoint also not yet built.
- **Exit criteria**: partially met — signup/invite-accept flow is real and typecheck/lint/build-verified; the compliance-profile settings screen (secondary to signup) remains open.

## M5 — Properties

- [~] **The `owner_user_id` → `org_id` cutover for `properties`** — **corrected 2026-07-30**: originally reported as fully done including dropping `owner_user_id`; a real `supabase start` run against a clean database proved that claim wrong — the column cannot yet be dropped because `document_categories.sql`/`documents.sql`'s RLS policies (still owner_user_id-scoped, unmigrated) reference it via cross-table subqueries, which Postgres's dependency tracking blocks. Actually done: `org_id` is `not null` and RLS-enforced (`has_org_role()`-based, matching `units`'s pattern) — this is the real ownership boundary going forward. `owner_user_id` is relaxed to nullable and left in place, inert, until TD-02's broader cutover makes dropping it possible. See `supabase/migrations/20260101000023_properties_org_contract.sql`'s revision note and `TECHNICAL_DEBT_REGISTER.md` TD-01/TD-02.
- [x] `packages/types/src/property.ts`: `ownerUserId` → `orgId`.
- [x] `apps/mobile/src/features/properties/propertyRepository.ts`/`usePropertiesQuery.ts`, demo store/mock data, local dev seed script, `rls_isolation.test.sql` — all updated. New `useCurrentOrgId()` hook resolves org context for the two mobile screens that create properties.
- [ ] `apps/admin` customer-page framing (→ organization framing) — **not done**: `customers/page.tsx`/`processing/page.tsx`/`subscriptions/page.tsx`/`adminMockData.ts` all have substantial unrelated pre-existing uncommitted changes (present before this work began) and were deliberately left untouched rather than risk conflicting with them. This piece of M5 is blocked on those pre-existing changes being resolved (committed or clarified) first — flagged to Mohammed, not silently dropped.
- [x] API endpoints for `properties` (`API_SPEC.md` §3, 2026-07-30): `GET/POST /api/v1/properties` (cursor-paginated list, org-role-checked create via `requireOrgRole()`/`has_org_role()` RPC — see `apps/admin/lib/portfolio.ts`), `GET/PATCH/DELETE /api/v1/properties/:id` (`DELETE` archives, never hard-deletes; cross-org access 404s rather than 403ing per `API_SPEC.md` §0). Web UI: Properties list/detail/create — still not built.
- [ ] Mobile onboarding gap (`apps/mobile/app/(onboarding)/add-first-property.tsx`): this screen now requires an org to exist first, but mobile has no create-organization screen (only web does, `/onboarding/create-organization`) — flagged inline in the file and in `TECHNICAL_DEBT_REGISTER.md`, not solved here (real UX design work, not a mechanical follow-on to the schema cutover).
- **Exit criteria**: the schema/type/mobile-data-layer cutover (the item this milestone exists for) is done and verified (`pnpm typecheck`/`lint`/`format` green); API endpoints done and verified (`pnpm typecheck`/`lint`/`test` green, real `next build` run confirming route registration); web UI and the admin customer-page reframing remain open, the last of which is blocked on pre-existing uncommitted work rather than new engineering.

## M6 — Units

- [x] Schema, RLS (`DATABASE.md` §3).
- [x] API endpoints (`API_SPEC.md` §3, 2026-07-30): `GET/POST /api/v1/properties/:propId/units` (folder is physically named `[id]` — Next.js requires sibling dynamic segments to share one slug name with `properties/[id]/route.ts`), `GET/PATCH /api/v1/units/:id`. Same cursor-pagination/org-role/404-vs-403 patterns as the properties endpoints, sharing `apps/admin/lib/portfolio.ts` and `apps/admin/lib/cursorPagination.ts`.
- [ ] Web UI, AI-assisted bulk unit generation (evidenced `PROPVIEW_SCREENSHOT_AUDIT.md` IMG_7998 — flagged in `PRODUCT_SPEC.md` §5 as needing its own design pass, not yet architected) — not started.
- **Exit criteria**: schema and API endpoints done and verified (`pnpm typecheck`/`lint`/`test` green — new `apps/admin/lib/__tests__/cursorPagination.test.ts`, 7 tests; real `next build` run); Web UI/AI-assist not started.

## M7 — Owners

- [x] Schema, RLS, multi-owner `property_owners` (`DATABASE.md` §3).
- [ ] API endpoints, Web UI (Owners directory, mandate fields).
- **Exit criteria**: schema done; API/UI not started.

## M8 — Tenants

- [ ] Schema: `tenants` table (`DATABASE.md` §4) — not yet migrated.
- [ ] API + RLS, Web UI (Tenant directory).
- **Exit criteria**: not started.

## M9 — Applications

- [ ] Schema: `applications` (`DATABASE.md` §4).
- [ ] Application-approval transaction (atomic tenant+lease+rent_schedule creation, `ACCOUNTING.md`/`ARCHITECTURE.md` § Business logic placement) — depends on M10 (Leases) existing.
- **Exit criteria**: not started.

## M10 — Leases

- [ ] Schema: `leases`, `lease_tenants`, `rent_schedules` (`DATABASE.md` §4).
- [ ] Lease-PDF-parse-to-prefill flow (depends on M12, OCR).
- **Exit criteria**: not started.

## M11 — Documents

- [ ] Extend `documents`/`ocr_jobs` from owner-scoped to org-scoped, generalize `related_entity_type` beyond bills (`DATABASE.md` §6).
- **Exit criteria**: not started.

## M12 — OCR

- [ ] Extend `DocumentIntelligenceProvider` to parse leases/invoices in addition to bills (`DOCUMENT_INTELLIGENCE.md`, `PRODUCT_SPEC.md` §5).
- [ ] Real OCR vendor selection remains an open decision (deferred, `DOCUMENT_INTELLIGENCE.md` §1) — mock provider carries M11/M12 until then.
- **Exit criteria**: not started.

## M13 — Maintenance

- [ ] Schema: `maintenance_tickets`, `maintenance_photos`, `vendors`, `vendor_bills` (`DATABASE.md` §5).
- [ ] Status state machine (kanban stages) enforced server-side.
- [ ] Inspections: `inspections`, `inspection_items`, `inspection_photos` — both-signed-or-refusal-logged completion rule enforced server-side, since Trust & Deposits (M14) gates release on this.
- [ ] Web UI: Maintenance Board, Vendors, Inspections.
- **Exit criteria**: not started. Sequenced before Accounting per the restated milestone order — note this means the accounting engine's deposit-release gate (`ACCOUNTING.md` §4) has its dependency (a completed inspection) available before it's built, not stubbed-then-unstubbed as the previous milestone ordering required.

## M14 — Accounting

- [ ] Schema: `chart_of_accounts`, `journal_entries`, `journal_lines`, `trust_ledgers`, `trust_ledger_entries`, `bank_accounts`, `bank_transactions`, `invoices`, `expenses`, `owner_statements` (`DATABASE.md` §9).
- [ ] Posting service (Edge Function) — sole write path to journal tables, balanced-entry validation, reversing-entry operation (`ACCOUNTING.md` §1, §3).
- [ ] Rent Due → Invoice → bank-match → confirmed-payment pipeline; re-target `calculateMatchScore` at bank-line↔rent-payment matching.
- [ ] Trust & Deposits: interest accrual job, inspection-gated release (M13's inspections now exist, so this is a real check, not a stub).
- [ ] Owner Statements generation service; Trial Balance (live report); Tax Pack (SA tax-year, after Trial Balance is trustworthy).
- [ ] Accounting invariant tests (`TESTING.md` §3) — highest-risk milestone, dedicated review before merge, per every prior pass's flagging of this as the largest single build item.
- **Exit criteria**: not started. This remains the highest-effort, highest-risk milestone regardless of where it sits in the sequence.

## M15 — Notifications

- [ ] Schema: `notifications`, `notification_preferences` (extended category enum per architecture review, `DATABASE.md` §7), `device_push_tokens`.
- [ ] `announcements`/`announcement_reads` (read-receipt/acknowledgement tracking).
- **Exit criteria**: not started.

## M16 — Email

- [ ] Schema: `email_messages`, `email_suppressions` (`DATABASE.md` §7).
- [ ] `EmailProvider` interface + `MockEmailProvider` (`EMAIL.md` §2) — full send/track/audit UI built and tested against the mock before any real account exists.
- [ ] Real provider account — **external-service blocker**, not attempted by this session.
- **Exit criteria**: mock-provider path complete is the achievable exit criteria until a real account is provisioned.

## M17 — WhatsApp

- [ ] Schema: `whatsapp_messages`, `verified_phone_numbers`, `whatsapp_conversation_state` (`DATABASE.md` §7).
- [ ] Resolution algorithm (§1.2), fixed trigger-list dispatcher (§2), `WhatsAppProvider` interface + `MockWhatsAppProvider` (`WHATSAPP.md` §5).
- [ ] OTP verification flow populating `verified_phone_numbers` — flagged as not yet designed (`WHATSAPP.md` Unresolved).
- [ ] Real BSP account — **external-service blocker**, not attempted by this session.
- **Exit criteria**: mock-provider path + resolution algorithm complete is the achievable exit criteria until a real account is provisioned.

## M18 — AI

- [ ] Schema: `ai_conversations`, `ai_messages`, `portfolio_insights` (`DATABASE.md` §8), `audit_events.actor_type = 'ai_assisted'` extension.
- [ ] Conversational Assistant: context-assembly function, staged-changes confirm-before-apply flow, `LLMProvider` interface + `MockLLMProvider` (`AI_ARCHITECTURE.md` §1, §3).
- [ ] Portfolio Intelligence: rules engine (non-LLM), scheduled + triggered-on-write evaluation (`AI_ARCHITECTURE.md` §2).
- [ ] `usage_events`/`usage_snapshots` metering + per-org AI usage cap enforcement (`DATABASE.md` §7, `AI_ARCHITECTURE.md` §4).
- [ ] LLM vendor selection remains an open decision (`AI_ARCHITECTURE.md` §3) — mock provider carries this milestone until then.
- **Exit criteria**: not started.

## M19 — Super Admin

- [ ] Route group `apps/web/app/(super-admin)/**`, independent platform-admin auth check.
- [ ] `admin_users` → `platform_admin_users` rename executed here (deferred from M1/M3, `DECISIONS.md` 2026-07-30) — this milestone already opens `lib/auth.ts`/`middleware.ts`/`roleRank.ts`, so the rename is no longer a standalone-risk change.
- [ ] Dashboard metrics, client directory, billing/plan configuration, support-mode (`SUPER_ADMIN.md` §2-6) — reading from `usage_snapshots`/`organization_subscriptions` per the architecture review's closed gaps.
- **Exit criteria**: not started.

## M20 — Responsive Web

- [ ] Full web UI pass across every module above that doesn't already have one — this milestone is where `apps/admin` fully becomes `apps/web` (`ARCHITECTURE.md`), reusing retained `AdminDataTable`/`AdminMetricCard`/chart primitives throughout.
- [ ] Simplified Portfolio Map UI (property list on a map, no GIS/heatmap layers — confirmed V1 scope).
- **Exit criteria**: not started; depends on M4-M19's backend/API work existing to build screens against.

## M21 — Native iOS

- [ ] Xcode project scaffold, Swift/SwiftUI, Supabase Swift SDK, Keychain-backed auth (`MOBILE_ARCHITECTURE_DECISION.md`).
- [ ] Role-aware navigation shell (portal switcher), biometric re-auth gate for sensitive actions (`SECURITY.md` § Auth).
- [ ] Screens per `MOBILE_ARCHITECTURE_DECISION.md` §6, Maintenance flow first (explicit master-prompt priority).
- **Exit criteria**: not started; from-zero build, no existing native project.

## M22 — Native Android

- [ ] Mirror M21 in Kotlin/Jetpack Compose, Supabase Kotlin SDK, Keystore-backed auth.
- **Exit criteria**: not started; from-zero build, no existing native project.

## M23 — Automated testing

- [ ] Full `TESTING.md` suite: unit, RLS/policy (highest priority), accounting invariants, integration, API contract, native (iOS/Android), E2E against seeded multi-org staging.
- [ ] CI split (`TESTING.md` §8): per-PR vs. nightly, wired into `.github/workflows/ci.yml`.
- **Exit criteria**: not started as a dedicated pass — individual test categories are written alongside their owning milestone per `TESTING.md`'s own structure; this milestone is the full-suite integration and CI-wiring checkpoint, not the first time any test gets written.

## M24 — Deployment

- [ ] Web CI/CD pipeline (staging auto-deploy, gated production promotion), Supabase migration pipeline (`DEPLOYMENT.md` §2-3).
- [ ] iOS pipeline (Xcode Cloud, TestFlight, gated App Store submission), Android pipeline (GitHub Actions + Fastlane, staged Play rollout) (`DEPLOYMENT.md` §4-5).
- [ ] Secrets management, rollback strategy, monitoring/alerting wired end-to-end (`DEPLOYMENT.md` §6-8).
- **Exit criteria**: not started; requires Vercel/Apple/Google account provisioning (external-service blockers).

## M25 — Engineering requirements

- [ ] Full security review pass against `SECURITY.md` — demo-mode bypass fix verified in production config, not just documented; rate limiting backing store wired; dependency-vulnerability scanning confirmed in CI.
- [ ] `PRODUCT_SPEC.md` reconciled against actual shipped state (every module's V1/V2 marker and design-doc pointer still accurate).
- [ ] Reports module (rent roll, occupancy, income/expense trend — evidenced modules from `PROPVIEW_SCREENSHOT_AUDIT.md`) not otherwise covered by an earlier milestone.
- **Exit criteria**: not started; this is the launch-readiness checkpoint, not a discrete feature.

---

## Sequencing notes

This order is Mohammed's explicit, restated instruction (2026-07-30), followed as given rather than re-derived from dependency analysis alone. Where the literal order creates a dependency wrinkle, it's noted inline rather than silently resolved by reordering: M13 (Maintenance) now precedes M14 (Accounting), which actually _simplifies_ the deposit-release gate versus the previous ordering (inspections exist before the trust-accounting code that checks them, so no stub-then-unstub step is needed). M20-M22 (Responsive Web / Native iOS / Native Android) coming after all backend/API milestones means every screen built in those milestones has a real API to call against from day one — no UI is ever built ahead of the data model it depends on.

This file is the authoritative "what's next" reference — `WORKLOG.md` records what was actually done and when; `KNOWN_BUGS.md` records what's broken; `DECISIONS.md` records why the order changed from the previous 16-milestone structure; `PRODUCT_SPEC.md` §8 points here for the milestone-level detail behind its one-line roadmap summary.
