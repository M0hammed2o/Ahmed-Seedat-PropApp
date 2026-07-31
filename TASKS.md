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
- [x] **All 26 migrations verified against a genuinely clean local Postgres database** (`supabase start`/`supabase db reset`, 2026-07-30, re-verified 2026-07-31 after two more migrations). 2026-07-30 pass found/fixed 4 real bugs: a forward-reference (policy in migration 17 needing a table from migration 18), a DROP COLUMN blocked by cross-table RLS dependencies (migration 23), an infinite-recursion RLS policy on `organization_members`, and a project-wide missing-`GRANT`s gap (migration 24). 2026-07-31 pass found/fixed 2 more: `organizations.status`'s documented `archived` enum value had never actually been added (migration 25), and `organization_invites` had no INSERT policy at all — the invite-creation half of the invitations flow could never have worked end-to-end (migration 26). Full detail: `WORKLOG.md` 2026-07-30/31, `RISK_REGISTER.md` R-02.
- [x] RLS isolation tests **executed and passing**: 31/31 pgTAP assertions across `rls_isolation.test.sql` (4), `multi_tenant_isolation.test.sql` (13), and new `multi_tenant_foundation_integration.test.sql` (14, 2026-07-31 — walks the full create-org→invite→accept→role-gated-write→multi-org-switch journey in one file, per Mohammed's "treat M1-M5 as one integrated subsystem" instruction) — cross-org isolation, role-scoped write denial, platform-admin/support-session table isolation, and full invitation-flow correctness all confirmed for real. Also found real bugs in the *tests themselves* while first running them (invited user can't self-query their own pending invite before joining — correct RLS behavior, wrong test assumption; direct `organization_members` insert has no client policy — also correct, wrong test assumption) — both fixed to match how the real flow actually works.
- [x] **Known, deliberately unenforced gap found 2026-07-31**: `organizations.status` (suspended/archived/cancelled) is not checked by any RLS policy — proven via a real pgTAP assertion, not implemented speculatively pending a product decision on intended behavior. `TECHNICAL_DEBT_REGISTER.md` TD-17 / `RISK_REGISTER.md` R-22.
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
- [x] RLS isolation tests **written AND executed** (3 files, `supabase test db`, 2026-07-30/31) — 31/31 pgTAP assertions pass: cross-org isolation, role-scoped write denial (viewer cannot write within their own org either), platform-admin/support-session table isolation, and (2026-07-31) the full org-creation→invite→accept→role-gated-write→multi-org-switch flow end to end. Docker was confirmed available in this environment; the "no Docker" assumption this milestone previously carried was stale and never re-checked. R-02 closed (`RISK_REGISTER.md`).
- **Exit criteria**: fully met. Helper functions, policies, and test coverage exist, typecheck, and are verified passing against a real database — nothing left open in this milestone.

## M4 — Organizations

- [x] `organizations`, `organization_subscriptions`, `organization_invites` schema.
- [x] Org signup flow — `POST /api/v1/organizations` (`apps/admin/app/api/v1/organizations/route.ts`) + `/onboarding/create-organization` UI, 2026-07-30. Invite-acceptance endpoint (`POST /api/v1/organizations/invites/accept`) also implemented, pairing with `accept_organization_invite()`.
- [x] Invite-**creation** endpoint — `POST /api/v1/organizations/:orgId/invites` (2026-07-31). Found missing while verifying the invitations flow end-to-end: `organization_invites` had a SELECT policy but no INSERT policy and no route ever called it, so the whole invite-creation half of this feature had never actually been usable despite looking schema-complete. Fixed with migration `20260101000026` (manager+ RLS gate) + the new route (finer "manager can't invite a peer/superior manager or principal" rule enforced at the API layer per `PERMISSIONS.md`'s role table). End-to-end flow (create→invite→accept) now verified for real via `multi_tenant_foundation_integration.test.sql`.
- [ ] Organisation compliance-profile settings screen (CIPC/VAT/SARS/POPIA/FFC, Team Seats) — web UI not yet built; `PATCH /api/v1/organizations/:orgId` endpoint also not yet built.
- **Exit criteria**: partially met — signup/invite-create/invite-accept flow is real, execution-verified end-to-end, and typecheck/lint/build-verified; the compliance-profile settings screen (secondary to signup) remains open.

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
- [x] API endpoints (`API_SPEC.md` §3, 2026-07-30): `GET/POST /api/v1/owners`, `GET/PATCH /api/v1/owners/:id`, `GET/POST /api/v1/properties/:propId/owners` (attach owner + ownership_pct; upserts on `(property_id, owner_id)` so re-attaching adjusts the existing share rather than erroring; explicitly checks the owner's `org_id` matches the property's `org_id` before insert — `property_owners`'s own RLS policy only constrains via the owner side, not the property side, so this cross-org guard is API-layer-only and load-bearing, not redundant). `bankingRef`/mandate-date fields deliberately not exposed yet — real onboarding workflow fields, not mechanical CRUD (`TECHNICAL_DEBT_REGISTER.md`).
- [ ] Web UI (Owners directory, mandate fields) — not started.
- **Exit criteria**: schema and API endpoints done and verified (`pnpm typecheck`/`lint`/`test` green, real `next build` route-table check); Web UI not started.

## M8 — Tenants

- [x] Schema: `tenants` table (`DATABASE.md` §4, migration `20260101000028`, 2026-07-31), decoupled from `auth.users` like `owners`. Prerequisite `encrypted_secrets` pointer table (`DATABASE.md` §11) also built (migration `20260101000027`) — schema only, matching the documented shape for `tenants.id_number_ref`/`owners.banking_ref` (the latter's FK was retrofitted here, previously unconstrained); the application-layer encrypt-before-insert pipeline is deliberately not built yet, since nothing calls it (`TECHNICAL_DEBT_REGISTER.md` TD-18).
- [x] RLS: `tenants_select_org_or_self` (org staff viewer+, or the tenant's own portal identity if `user_id` is set — mirrors `owners`), `tenants_write_agent_plus` (no self-write policy — no tenant portal exists in V1). `encrypted_secrets`: zero client policies, service-role only.
- [x] API: `GET/POST /api/v1/tenants`, `GET/PATCH /api/v1/tenants/:id` (`API_SPEC.md` §4) — same cursor-pagination/`requireOrgRole`/404-vs-403 patterns as Properties/Units/Owners, sharing `apps/admin/lib/leasing.ts` (new) + the existing `portfolio.ts`/`cursorPagination.ts` helpers.
- [x] Tests: new `supabase/tests/tenants_isolation.test.sql` (10 assertions — cross-org isolation, role-scoped write denial, the self-access carve-out specifically, and `encrypted_secrets` deny-by-default) + full regression suite (41/41 pgTAP assertions across 4 files, real `supabase db reset` + `supabase test db`). Full monorepo `pnpm typecheck`/`lint` (7/7 packages) and a real `next build` (both new routes registered, no conflicts) also green.
- [ ] Web UI (Tenant directory) — not started, consistent with how Properties/Units/Owners were sequenced (API first).
- **Exit criteria**: schema, RLS, and API done and execution-verified; Web UI open.

## M9 — Applications

- [x] Schema: `applications` (`DATABASE.md` §4, migration `20260101000029`, 2026-07-31). RLS mirrors the `properties`/`units`/`tenants` viewer-select/agent-write pattern. Two DB-level invariants beyond the documented column list: a decision's bookkeeping columns (`decision`/`decided_at`) are set together or not at all (CHECK), and `screening_status` cannot leave `not_started` before `screening_consent_at` is captured (CHECK) — both enforced independently of the API layer.
- [x] Application-approval transaction (atomic tenant+lease+rent_schedule creation) — `approve_application()` (migration `20260101000031`). Not security definer (unlike `create_organization()`/`accept_organization_invite()`): the caller already holds agent+ membership in the application's org, so every insert runs under the caller's own RLS rather than needing a privilege bypass — atomicity is the only thing this function adds. Deliberately does **not** hard-require `screening_status = 'passed'` before allowing approval — `DATABASE.md` §4 never states that as a rule, and encoding an unstated business policy as a hard DB constraint would be guessing at a product decision, not an engineering one.
- [x] API: `GET/POST /api/v1/applications`, `GET /api/v1/applications/:id` (no general PATCH — only the three state-transition actions below can mutate an application, so a blanket PATCH can't be used to bypass their rules), `POST /api/v1/applications/:id/consent`, `POST /api/v1/applications/:id/screen` (via a new mock-first `TenantScreeningProvider`/`MockTenantScreeningProvider`, `apps/admin/lib/providers/tenantScreening.ts`, matching ADR-014's vendor-agnostic pattern — no real screening vendor selected yet), `POST /api/v1/applications/:id/decide` (approve → `approve_application()` RPC; decline → simple update).
- **Exit criteria**: schema, RLS, atomic approval transaction, and API done and execution-verified (see M10 for the shared test/verification summary). Web UI not started. Real screening-vendor integration not started (mock provider only).

## M10 — Leases

- [x] Schema: `leases`, `lease_tenants`, `rent_schedules` (`DATABASE.md` §4, migration `20260101000030`, 2026-07-31). `lease_tenants`/`rent_schedules` follow the same "denormalized `org_id`"/"scoped through parent" RLS patterns already established for `property_owners`/`units`.
- [x] API: `GET/POST /api/v1/leases` (manual creation, `source: 'manual'` — the application-approval path never goes through this route), `GET/PATCH /api/v1/leases/:id`, `GET /api/v1/leases/:id/rent-schedule`.
- [ ] Lease-PDF-parse-to-prefill flow (`POST /api/v1/leases/:id/upload-and-parse`) — genuinely blocked on M12 (OCR/Document Intelligence), not started; building a stub that fakes OCR output would be worse than leaving it undone.
- [ ] **Recurring `rent_schedules` generation is not built.** `approve_application()` creates only the lease's first due-date row (the period it starts in) — generating every subsequent period's row is a scheduling/cron concern (needs a "run monthly, for every active lease, generate next period's row" job) that doesn't exist anywhere in this codebase yet (no cron/scheduled-function infrastructure at all). Tracked as new `TECHNICAL_DEBT_REGISTER.md` TD-20, not silently assumed to be "done" by the one row the approval transaction creates.
- [x] Tests: new `supabase/tests/leasing_isolation.test.sql` (14 assertions) — cross-org isolation on `applications`/`leases`, role-scoped write denial, and specifically `approve_application()`'s correctness (tenant/lease/lease_tenants/rent_schedules all created with correct values, unit flips to occupied, application marked decided) **and** its safety (an outsider calling it gets "not found" via RLS, not a privilege bypass; calling it twice on the same application raises rather than double-creating). Full regression suite: 55/55 pgTAP assertions across 5 files on a genuinely fresh `db reset`. Full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages) and a real `next build` (all 8 new routes registered, no conflicts) also green.
- **Exit criteria**: schema, RLS, and manual/approval-sourced lease creation all done and execution-verified; PDF-parse flow correctly blocked on M12; recurring rent-schedule generation open (TD-20). Web UI not started.

## M11 — Documents

- [x] Extend `documents`, `document_categories`, `property_expected_categories`, `bills`, `payments`, `payment_matches`, `extraction_jobs`, `extraction_results`, `audit_events` from owner-scoped to org-scoped (migration `20260101000032`, 2026-07-31) — the largest single-migration blast radius so far (9 tables' RLS rewritten). `subscriptions`/`subscription_events` deliberately excluded (superseded by `organization_subscriptions`, a different question than an org_id add — correcting TD-02's original grouping).
- [x] **Corrected `DATABASE.md` §6** rather than implementing it literally: its documented `related_entity_type`/`related_entity_id` polymorphic redesign, checked against real application code before migrating (not after), would have regressed working, demoed features (`document_categories`' default+custom categories, `billing_year`/`billing_month` behind the Monthly Checklist, `checksum_sha256` dedup) that the redesign had no room for. Kept the proven shape, added only `org_id`. The polymorphic-relation generalization itself is deferred, not abandoned — no evidenced V1 need for it yet.
- [x] **This migration is the direct fix for what blocked M5's `DROP COLUMN properties.owner_user_id`** (`TECHNICAL_DEBT_REGISTER.md` TD-01): `property_expected_categories`' and `documents`' policies, previously keyed on `properties.owner_user_id`, now route through `properties.org_id`/`has_org_role()`. Re-verified live in a rolled-back transaction: `ALTER TABLE properties DROP COLUMN owner_user_id` now succeeds — TD-01's blocker is confirmed gone, though the actual drop is deliberately not executed in this migration (a separate, deliberate contract-step decision, not bundled into this one).
- [x] Two real bugs found by execution before this migration was committed, both fixed in place rather than shipped and patched after: (1) `owner_user_id NOT NULL` was never relaxed on 7 of these tables, which would have hard-blocked every new org-scoped insert (no meaningful owner to supply) — caught by writing the test suite, not by re-reading the migration; (2) `document_categories`' pre-existing CHECK constraint (`is_default or owner_user_id is not null`) was never updated when `org_id` was added, silently still blocking every org-scoped custom-category insert — caught the same way.
- [x] Tests: new `supabase/tests/documents_financials_isolation.test.sql` (14 assertions) — org-scoped inserts actually succeeding (not just old access being gone) across every cutover table, plus cross-org isolation on documents/categories/payment_matches. Full regression suite: 69/69 pgTAP assertions across 6 files. Full monorepo `pnpm typecheck`/`pnpm lint` unaffected (schema-only milestone, no app code changed — matches this milestone's own scope).
- [ ] API endpoints/Web UI for documents/bills/payments — not started (out of this milestone's scope, same as `TASKS.md`'s own line only ever asked for the schema cutover). Storage bucket path-based policies (still keyed on `auth.uid()`, not `org_id`) also not updated — tracked as new `TECHNICAL_DEBT_REGISTER.md` TD-21, alongside the finding that no real (non-demo) mobile document/bill/payment upload flow exists yet to migrate — only the demo-mode path was ever built, which simplifies that follow-up considerably.
- **Exit criteria**: schema/RLS cutover done and execution-verified for all 9 tables; TD-01's blocker confirmed resolved. API/UI and storage-policy cutover open (TD-21).

## M12 — OCR

- [x] Extended `DocumentIntelligenceProvider` to parse leases in addition to bills (2026-07-31): `'lease'` added to `DOCUMENT_TYPES`/`documents.document_type` (migration `20260101000033`), `FieldExtractionResult` gained lease-shaped optional fields (`tenantName`/`rentAmount`/`depositAmount`/`leaseStartDate`/`leaseEndDate`/`propertyAddress`) alongside the existing bill fields on the same type, and a new server-side `apps/admin/lib/providers/documentIntelligence.ts` (`MockDocumentIntelligenceProvider`) branches on `documentType` — the mobile app's existing mock (client-side, different runtime) is untouched.
- [x] Closed the `POST /api/v1/leases/:id/upload-and-parse` gap deferred from M10 — now built, using the extended provider. Returns extracted fields for client-side review only, never auto-applies them to the lease, per `DOCUMENT_INTELLIGENCE.md`'s "always confirm before treating as final" rule.
- [x] **Real bug found and fixed before shipping**: the route initially wrote to `extraction_jobs`/`extraction_results` using the caller's own session-bound client — but those tables have deliberately had no client INSERT/UPDATE policy since Phase 1 ("jobs are created and progressed only by the server-side processing pipeline"). Verified live that an agent's insert is rejected by RLS; fixed by using the service-role client for those two tables specifically (only after `requireOrgRole()` already authorized the caller), matching the established `getServiceRoleClient()` usage pattern. Re-verified the fix directly (service-role insert reaches the FK constraint, not an RLS rejection).
- [ ] Real OCR vendor selection remains an open decision (deferred, `DOCUMENT_INTELLIGENCE.md` §1) — mock provider carries M11/M12 until then; this is a cost/accuracy tradeoff for Mohammed, not an engineering call.
- **Exit criteria**: lease-extraction support and the upload-and-parse endpoint done and verified (full monorepo `pnpm typecheck`/`pnpm lint`, real `next build` with the new route registered, 33/33 migrations clean). Real vendor integration open pending Mohammed's decision.

## M13 — Maintenance

- [x] Schema: `maintenance_tickets`, `maintenance_photos`, `vendors`, `vendor_bills`, `inspections`, `inspection_items`, `inspection_photos` (migration `20260101000034`, 2026-07-31, `DATABASE.md` §5). `vendor_bills.paid_journal_entry_id` added without its FK constraint yet (matches the `owners.banking_ref`/M2 precedent) — `journal_entries` doesn't exist until M14; FK retrofit is M14's job.
- [x] Maintenance status state machine (To Do → In Progress → Pending Approval → Completed, with Pending Approval → In Progress as the rejection path) enforced server-side in `PATCH /api/v1/maintenance-tickets/:id` (`apps/admin/lib/operations.ts`'s `isValidMaintenanceTransition`) — RLS can only express "agent+ can write this row," not "is this a legal transition," matching `PERMISSIONS.md` layer 2.
- [x] Inspections: both-signed-or-refusal-logged completion rule enforced as a **hard DB CHECK constraint**, not just an API check — deliberately stronger than the maintenance state machine, since `TASKS.md` M14's deposit-release gate depends on this being genuinely true even against a direct/service-role write. Verified with 5 dedicated pgTAP assertions proving every edge case (neither signed, landlord-only, both-set-simultaneously rejected, both-signed accepted, refusal-logged accepted).
- [x] API: `GET/POST /api/v1/vendors`, `GET/PATCH /api/v1/vendors/:id`, `GET/POST /api/v1/maintenance-tickets`, `GET/PATCH /api/v1/maintenance-tickets/:id`, `GET/POST /api/v1/inspections`, `POST /api/v1/inspections/:id/items`, `POST /api/v1/inspections/:id/sign`, `POST /api/v1/inspections/:id/complete`. `vendor-bills`/`maintenance-tickets/:id/photos` API endpoints not built this pass — `vendor_bills`' approve flow is naturally paired with M14 (it writes to the same `paid_journal_entry_id` column M14 makes real), and photos need `documents` API endpoints (M11 TD-21) first.
- [x] Tests: new `supabase/tests/maintenance_inspections_isolation.test.sql` (13 assertions). Full regression suite: 82/82 pgTAP assertions across 7 files. Full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages — caught and fixed one real unused-import lint error before commit), real `next build` (8 new routes registered, no conflicts).
- [ ] Web UI: Maintenance Board, Vendors, Inspections — not started, consistent with every prior milestone's API-first sequencing.
- **Exit criteria**: schema, both state machines (one API-layer, one DB-layer, deliberately different strength matching what each depends on), and core API done and execution-verified. `vendor-bills`/photos API and Web UI open.

## M14 — Accounting (part 1 of 2: the core ledger — done; typed posting operations — not started)

Given this milestone's own repeated flagging as the highest-risk single workstream in the project, it is split deliberately rather than attempted in one pass: part 1 (below) is the foundation everything else posts through — done and heavily verified. Part 2 (typed operations wiring real product flows to that foundation — rent invoicing, expenses, payments, trust/deposits, owner statements, bank reconciliation, tax pack) is real, substantial, separate work, not started, not claimed as done.

- [x] Schema: `chart_of_accounts`, `journal_entries`, `journal_lines`, `accounting_periods` (migration `20260101000035`, 2026-07-31, `DATABASE.md` §9). Remaining §9 tables (`trust_ledgers`, `trust_ledger_entries`, `bank_accounts`, `bank_transactions`, `invoices`, `expenses`, `owner_statements`, `tax_pack_exports`) are part 2's schema work, not yet created.
- [x] **Real gap found and fixed before writing this migration**: `ACCOUNTING.md` §1 claimed immutability was enforced by "RLS has no update/delete policy... for any role, including elevated ones" — not actually true, since `service_role` has `BYPASSRLS = true` (verified this session), so RLS's presence or absence has zero effect on it. Fixed with `BEFORE UPDATE OR DELETE` triggers on `journal_entries`/`journal_lines` that unconditionally reject the operation (triggers fire regardless of RLS bypass, including for the table owner) — the real third enforcement layer. `ACCOUNTING.md` §1 corrected to describe this accurately. Applied the identical fix to `audit_events` (migration `20260101000036`) — same documented-but-insufficient pattern, same fix, found by re-examining the codebase for the same class of gap rather than only fixing the instance in front of me.
- [x] Posting primitives: `post_journal_entry()` (balance validation, period-lock check, atomic entry+lines insert — the sole write path, matching `ACCOUNTING.md` §3's "no generic post a journal entry API exists") and `reverse_journal_entry()` (exact negation, links via the one narrow mutation the trigger allows). Neither is exposed as a free-form client endpoint; `POST /api/v1/journal-entries/:id/reverse` wraps the latter, matching `API_SPEC.md` §6's explicit "never PATCH/DELETE on journal-entries directly."
- [x] Period locking (`ACCOUNTING.md` §9): `close_accounting_period()`/`reopen_accounting_period()`, both accountant+-gated. Reopening's stated "writes an audit_events row" requirement **not implemented** — `audit_events.actor_type` has no value correctly describing an org accountant (vs. platform admin or system); tracked against `TECHNICAL_DEBT_REGISTER.md` TD-14 rather than writing a semantically-wrong row.
- [x] Chart-of-accounts seeding (`ACCOUNTING.md` §2) wired atomically into `create_organization()` — 11 system accounts per new org, verified live.
- [x] API: `GET /api/v1/chart-of-accounts`, `GET /api/v1/journal-entries` (read-only, no POST — by design), `POST /api/v1/journal-entries/:id/reverse`, `GET /api/v1/trial-balance` (live computed report + the "Balanced" health check), `GET/POST /api/v1/accounting-periods`, `POST .../close`, `POST .../reopen`.
- [x] Accounting invariant tests: new `supabase/tests/accounting_core.test.sql` (21 assertions). **The single most important test in the project so far**: proves immutability holds even against the `postgres` superuser connection the test file itself runs as by default (which bypasses RLS entirely, same as `service_role`) — not just that `authenticated` clients are blocked, which would have proven nothing about the actual threat model. Also covers balance validation, period-lock rejection, reversal linkage, and double-reversal prevention. Full regression suite: 103/103 pgTAP assertions across 8 files. Full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages, one real unused-import lint error fixed), real `next build` (8 new routes registered, no conflicts).
- [ ] **Part 2, not started**: posting service typed operations (rent invoicing, expense recording, payment confirmation, owner payout), Rent Due → Invoice → bank-match → confirmed-payment pipeline, Trust & Deposits (interest accrual, inspection-gated release — M13's inspections now exist, so this will be a real check, not a stub), Owner Statements generation service, Tax Pack. Remaining `DATABASE.md` §9 tables. Web UI.
- **Exit criteria**: part 1 (the ledger foundation, immutability, period locking, chart of accounts) done and execution-verified to the same standard as every other milestone this session. Part 2 remains the largest single body of work left in the project — this split is itself a deliberate risk-management decision, not scope creep.

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
