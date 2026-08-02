# Decisions

Chronological log of non-obvious choices made to keep Phase 0/1 moving without blocking on Mohammed for things that don't materially change the architecture.

## 2026-07-29 — PropVault → PropertyVault: product pivot and V1 scope, confirmed with Mohammed

**Product direction**: PropertyVault (full multi-tenant landlord/tenant property-management SaaS, modeled on the "PropView" reference product in `reference/propview-screenshots/`) supersedes PropVault (personal document-vault app for individual owners) as the product this codebase builds toward. Decided module-by-module on evidence, not a wholesale restart — see `RETAIN_REFACTOR_REBUILD_MATRIX.md` for what's retained/refactored/rebuilt. Reason this is logged as a decision rather than an assumption: the two products have materially different data models (single-owner vs. org/landlord/tenant/lease) and the existing PropVault `PROJECT.md` explicitly declared itself "not a rental-management platform" — this reverses that explicit prior scoping, so it's recorded here rather than silently overwritten.

**Target jurisdiction**: South Africa, specifically — not a generic/configurable jurisdiction model. Compliance modules (Trust & Deposits under RHA-equivalent rules, Tax Pack under SARS tax-year conventions, Organisation profile fields for CIPC/VAT/POPIA/FFC) are built as real regulatory features from the start, matching the reference product exactly, not as placeholders behind a jurisdiction abstraction.

**Accounting engine**: built in-house (real double-entry ledger, Business/Trust/Deposits separation) rather than integrated with a third-party accounting API. Matches the reference product's own bespoke-ledger pattern; flagged as the highest-effort, highest-risk single workstream in the whole plan (`RETAIN_REFACTOR_REBUILD_MATRIX.md`) and warrants its own design review before implementation starts, not incidental design-as-you-go.

**Vendor portal**: none in V1. Vendor bills are captured by staff/landlord on the vendor's behalf (upload + AI-assisted extraction) rather than giving vendors their own login — no vendor-facing authentication surface to build or secure in V1.

**V1 scope** (full priority order in `ROADMAP.md`): Tax Pack and a simplified Portfolio Map (property list on a map, no GIS/heat-map/analytics layers) are in V1, reversing this audit's initial proposal to exclude them, because Mohammed judged them core to a production-ready V1 for the SA market. Tasks & Reminders gets no standalone module — task workflows are implemented inline within Maintenance, Inspections, Lease renewals, Documents, and Payments instead, deferred as a possible standalone module only if that proves insufficient later. Listings Studio, Enquiries/Leads, Articles, Sales & Auctions, Virtual Tours, Neighbourhood Insights, and Valuations history are deferred to V2 — Articles and Sales & Auctions explicitly stay on the roadmap rather than being ruled out of the product entirely.

## 2026-07-30 — Production Readiness Review (Principal-Architect-level design gate)

Per Mohammed's instruction, performed a full production-readiness review of the entire architecture read together (not document-by-document) across 22 dimensions: scalability to tens of thousands of orgs, normalization, indexing, query performance, caching, API consistency, naming consistency, security, auditability, accounting correctness, mobile offline support, synchronization, backup/DR, multi-region readiness, observability, logging, monitoring, feature flags, future integrations, AI extensibility, testing strategy, CI/CD, and cost optimization.

Found and fixed 12 previously-unaddressed gaps at the design level (full detail: `PRODUCTION_READINESS_REPORT.md`) — most significantly, three areas that had **no design at all** before this pass: caching strategy, mobile offline/sync support, and backup/disaster recovery/observability. Also fixed: a real security information-disclosure bug in WhatsApp's identity-disambiguation flow, an accounting period-locking gap (nothing previously stopped a backdated post into a reconciled month), and denormalization-consistency gaps (`organizations.status` had no defined single writer; `trust_ledgers.current_balance` had no defined update-timing rule).

Produced the four requested governance documents: `PRODUCTION_READINESS_REPORT.md` (the full review, scored 72/100 with category breakdown and justification), `ARCHITECTURE_DECISION_RECORDS.md` (20 ADRs — 14 compiled from decisions already made in this file, 6 new from this review), `RISK_REGISTER.md` (20 scored risks), `TECHNICAL_DEBT_REGISTER.md` (13 scoped debt items, each assigned a paydown milestone).

**Score rationale, stated plainly since a number alone invites either dismissal or false confidence**: 72/100 reflects a genuinely thorough, well-cross-referenced architecture undercut by zero execution evidence — no code has been run against most of it (only the M1/M2 schema exists), two Critical risk items (the demo-mode auth bypass fix, and RLS isolation tests) are specified but not yet built/run, and nothing has been load-tested, backup-drilled, or penetration-tested because the infrastructure to do any of that doesn't exist yet. This is treated as the expected, honest state for a pre-implementation architecture review, not a failing grade — the path to 90+ is implementation and test execution against milestones already scoped in `TASKS.md`, not more documentation.

**Gate decision**: both Critical risks (R-01, R-02) are explicitly accepted as open rather than blocking all further work — each is scoped to a specific milestone (M2, M3/M23) and must close before that milestone's exit criteria are met; R-01 specifically is release-blocking (no real deployment) regardless of milestone sequencing, per `SECURITY.md`'s existing framing. Implementation may continue on work that doesn't depend on either (e.g. the M1 properties ownership cutover), but is not fully unblocked across the board — this is a partial, scoped go-ahead, not a clean pass.

No database migrations were touched in this pass — all changes are `.md` document edits, consistent with the standing instruction not to write migrations until architecture review is complete.

## 2026-07-30 — Architecture review pass + PRODUCT_SPEC.md + restated milestone order

Per Mohammed's instruction to complete every remaining architecture document, then perform a full consistency review before any further implementation: read all 12 architecture documents in full (the 5 written directly plus the 7 delegated to background agents last session) and found real cross-document gaps, not just style issues. Fixed rather than merely logged, since these were concrete, correctable inconsistencies:

- **Missing tables**: `verified_phone_numbers`, `whatsapp_conversation_state` (WhatsApp identity resolution), `usage_events`/`usage_snapshots` (closes a metering gap `SUPER_ADMIN.md` and `AI_ARCHITECTURE.md` had each independently flagged and left open), `email_suppressions` — all were referenced/assumed by their owning document but never actually added to `DATABASE.md`. Added, with RLS treatment, and updated every referencing document's "open items" section to point at the closed gap instead of restating it as open.
- **Enum gaps**: `organizations.status` gained `archived` (Super Admin's archive action had no state to set); `audit_events.actor_type` gained `ai_assisted` plus nullable `ai_conversation_id`/`ai_message_id` (AI-confirmed writes need to be distinguishable from direct-UI writes in the audit trail without a parallel audit mechanism); `notification_preferences.category` gained `inspections`/`security` (WhatsApp's fixed trigger list included events with no matching category in the original 5).
- **Privacy fix**: WhatsApp's ambiguous-match disambiguation prompt originally named the specific property/org a candidate match belonged to before the sender had proven anything beyond current possession of a phone number — a real disclosure risk given phone numbers get reassigned/recycled and `verified_phone_numbers`' verification is a point-in-time proof, not a permanent one. Fixed to disclose only generic role labels ("a Tenant account," "an Owner account") until resolved to exactly one context.
- **Naming consistency**: `is_platform_admin()`/`platform_admin_users` are used as live-sounding names across `PERMISSIONS.md`/`SECURITY.md`/`SUPER_ADMIN.md`, but the actual current function/table is still `is_admin()`/`admin_users` (the rename is deferred to Milestone 13/M19 — see the entry below). Added explicit naming notes at each reference so a reader implementing against these docs today doesn't go looking for a function that doesn't exist yet.
- **Permission ambiguity**: `PERMISSIONS.md`'s role matrix implied a "hard delete" existed that some role could or couldn't do; clarified against `API_SPEC.md` §3's actual rule (DELETE always archives, no role has true hard-delete on business records).
- **Accounting edge cases documented** (not previously addressed anywhere): partial rent payments, multi-owner statement rounding (decided: round each owner independently, post the remainder to a stable-sorted last owner, never dropped), mid-lease rent amendments (decided: amendments apply forward only, never rewrite historical `rent_schedules`/posted entries), and multi-property shared expenses (decided: manual per-property apportionment in V1, no automatic split — flagged as a V2 candidate).

Created `PRODUCT_SPEC.md` (Mohammed's explicit request) — a single-source-of-truth index of every module/role/screen/notification/AI-capability/integration, deliberately built as cross-references into the detailed docs rather than a duplicate of their content, so it doesn't drift the way a second copy of the same information would.

**Restated implementation order** (supersedes the 2026-07-29 `ROADMAP.md` ordering, not a contradiction — Mohammed refined the sequencing on review): Multi-tenant schema → Authentication → Roles and permissions → Organizations → Properties → Units → Owners → Tenants → Applications → Leases → Documents → OCR → Maintenance → Accounting → Notifications → Email → WhatsApp → AI → Super Admin → Responsive Web → Native iOS → Native Android → Automated testing → Deployment → Engineering requirements. `TASKS.md` rewritten from 16 coarser milestones to 25 (M0-M25) matching this literal order; `ROADMAP.md` updated with the old ordering kept in a collapsed section for history rather than deleted. Substantive effect of the reorder: Maintenance now precedes Accounting, which actually simplifies the trust-deposit release gate (the inspection it depends on now exists before the accounting code that checks it, removing a stub-then-unstub step the previous ordering required).

**No database migrations were added or modified this session** — all of the above are `.md` document changes only, per Mohammed's explicit instruction not to touch migrations until the architecture documentation and review pass are complete. The migrations from the previous session (multi-tenancy foundation + portfolio expand step) are unchanged.

## 2026-07-30 — Defer the `admin_users` → `platform_admin_users` rename to Milestone 13

`DATABASE.md` documents the target name as `platform_admin_users`, and it was originally scheduled in Milestone 1 (`TASKS.md`) alongside the new organizations/membership tables. Deferred instead: the existing `admin_users` table, `admin_role` enum, and `is_admin()` function are live and currently working (referenced by `apps/admin/lib/auth.ts`, `middleware.ts`, `roleRank.ts`, and tests) and functionally correct as a platform-staff table already — renaming them now is a pure-cosmetic change that would require editing those call sites for no behavioral benefit ahead of Milestone 13, where the Super Admin portal rebuild opens those exact files anyway. Reason this is a decision worth logging rather than silent scope creep: it means `DATABASE.md`'s documented final-state name and the actual schema will disagree (`admin_users`, not `platform_admin_users`) until Milestone 13 lands — anyone reading the schema directly between now and then should trust the live migrations, not the doc's target-state name, for this one table specifically.

**Mobile architecture**: one native app per platform (iOS: Swift/SwiftUI/Xcode; Android: Kotlin/Jetpack Compose/Android Studio), not separate Owner and Tenant apps, with role-aware navigation switching portals within a single login — mirrors the reference product's own single-account dual-portal model. Full reasoning in `MOBILE_ARCHITECTURE_DECISION.md`. No native iOS/Android project exists yet anywhere in the repo (confirmed by repo-wide search); this is a from-zero build, not a migration of the existing Expo app.

## 2026-07-21 — Git repository scoping (found during discovery, not a design choice)

Discovery: the Git repository previously reachable from this machine's default working context was rooted at `C:\Users\junsm` (the entire Windows user profile) — an unrelated, accidental `git init` that would have tracked personal files (`NTUSER.DAT`, `AppData`, `OneDrive`, credential stores, unrelated other projects) had any `git add`/commit been run there. **Action taken:** left that repository completely untouched; initialised a fresh, correctly-scoped Git repository inside `PropValt (Property App)/` and pointed `origin` at the specified GitHub repo (confirmed empty via `gh repo view`). All work in this project happens in that new, correctly-scoped repository.

## 2026-07-21 — Package manager & task runner: pnpm + Turborepo

Reason: pnpm's strict node_modules linking prevents an RN app and a Next.js app from silently sharing an incompatible transitive dependency (a real risk given how different their dependency trees are); Turborepo gives cached/parallel `lint`/`typecheck`/`test`/`build` with minimal config and no vendor lock-in cost.

## 2026-07-21 — Package versions

Verified current-stable via live search on 2026-07-21 (not assumed from training knowledge, since the assistant's knowledge cutoff predates this date by several months): Expo SDK 56 (React Native 0.85, React 19.2), Next.js 16.2.7, `@supabase/supabase-js` 2.110.7, Zod 4.4.3, `react-native-purchases` 10.4.0. Root/tooling packages (`typescript`, `eslint`, `turbo`, `prettier`) are pinned with caret ranges to recent-known-good majors and will resolve to their latest compatible patch in the committed lockfile at install time — the lockfile, not `package.json`, is the source of exact-version truth per the brief's "use exact package versions in the lockfile" rule.

## 2026-07-21 — Zod v4 over v3

Zod 4 is now the current stable major. Risk noted: some `@hookform/resolvers` versions historically lagged Zod major bumps — pinned `@hookform/resolvers` to a version documented (in its own changelog) as Zod-v4-compatible; if `pnpm install` surfaces a peer-dependency conflict, the fallback is Zod `^3.24.1`, which is fully compatible everywhere. This is called out explicitly so it isn't silently wrong if the ecosystem hasn't fully caught up by the time this is installed.

## 2026-07-21 — No shared visual component library across RN and Next.js

`packages/ui` holds design **tokens** (colour/type/spacing/radii/motion) and shared non-visual logic (variant maps, status→icon mapping), not actual components — RN and DOM rendering are different enough (View/Text vs div/shadcn primitives) that a shared component layer would mean either a heavy cross-platform abstraction (React Native Web) the brief never asked for, or a thin thing that saves little. Each app implements its own components against the same tokens, which keeps both apps idiomatic to their platform while staying visually consistent.

## 2026-07-21 — `admin_roles` table deferred; role is an enum column on `admin_users`

The brief lists both `admin_users` and `admin_roles` as entities. Phase 1 uses a single `admin_role` Postgres enum (`super_admin | support_admin | operations_admin | read_only_admin`) directly on `admin_users` rather than a separate join table, since V1 has no requirement for a user to hold multiple roles simultaneously or for roles to be dynamically defined. If multi-role-per-admin or custom roles become a real requirement, `admin_roles` becomes a proper join table in a later migration — documented here so it isn't forgotten.

## 2026-07-21 — Expired/billing-issue subscribers get read-only access, not full lockout

See SUBSCRIPTIONS.md. Chosen because the product's core promise is "your documents are safe here" — losing read access to your own uploaded bills the moment a card fails would contradict that promise and is also explicitly discouraged by the brief ("existing documents must not be deleted merely because a subscription expires"). Implemented as a config flag, not a hardcoded branch, so it's a one-line change if Mohammed wants stricter enforcement later.

## 2026-07-21 — OCR/document-intelligence vendor not selected yet

The brief explicitly says not to implement the full OCR provider in Phase 1 and to keep the abstraction vendor-agnostic. Rather than guessing a vendor (which would bias cost/architecture decisions Mohammed hasn't weighed in on), the interface is built and a mock provider ships; vendor selection is logged as an open question in TODO.md for Phase 2.

## 2026-07-22 — Phase 2: demo mode, default ON, for a same-week client meeting

Scope changed mid-project: the immediate priority became a polished, believable end-to-end demo for a client meeting, explicitly not backend completeness (see WORKLOG.md). Rather than fork a separate "demo build," every screen was built to read through the same repository/provider interface boundary already established in Phase 1 (`SubscriptionProvider`, `DocumentIntelligenceProvider` pattern) — a new `EXPO_PUBLIC_DEMO_MODE`/`NEXT_PUBLIC_DEMO_MODE` flag swaps in an in-memory mock data layer (`apps/mobile/src/demo/`, `apps/admin/lib/demo/`) instead of Supabase, everywhere a screen would otherwise need a live project. Production code paths are untouched, not deleted or bypassed permanently — flipping the flag to `false` restores the exact Phase 1 behavior.

**The flag defaults to ON when unset.** This was a deliberate tradeoff, not an oversight: the whole point of Phase 2 is that the app must work with zero backend setup for tomorrow's meeting, and an opt-in flag that has to be manually set would fail that goal the moment anyone forgets to set it. The cost is real and is treated as release-blocking — see the new section at the top of SECURITY.md — a deployment that leaves this unset ships with a full authentication bypass on the admin app. A boot-time console warning was added specifically because this tradeoff is dangerous enough that it must never be silent.

## 2026-07-22 — Payment-match extraction templates align to real outstanding bills, not hardcoded scores

Rather than faking a "Strong Match Found" result for the demo's AI-matching step, the demo upload flow (`apps/mobile/src/demo/extractionTemplates.ts`) generates a proof-of-payment's amount/reference from whatever the property's actual largest outstanding bill in the store currently is, then runs the real `calculateMatchScore()` from `packages/utils` (the same function unit-tested in Phase 1 and destined for production) against it. The demo is compelling because the real algorithm genuinely scores it high, not because the UI lies about a canned number — this also means the demo doubles as an informal live test of the actual matching logic.

## 2026-07-22 — No charting library added for the admin dashboard

`MiniLineChart`/`MiniBarChart` (`apps/admin/components/ui/`) are hand-rolled inline SVG/div components rather than a pulled-in library (e.g. Recharts). For the handful of simple trend visualisations the brief asked for, a full charting dependency would add bundle weight and a new version-compatibility surface to the "test everything" pass for marginal benefit — revisit if the admin dashboard's charting needs grow materially in a later phase.

## 2026-07-21 — RLS/policy tests written but not executed in this environment

This development sandbox has no Docker/local Supabase instance available to run `supabase start` + `supabase test db` against. Tests are written per TESTING.md and will run once Mohammed (or a CI runner with Docker) executes them locally — reported as Blocked, not claimed as passing, per the project's evidence rule.

(Superseded 2026-07-30/31 — Docker turned out to be available in this environment after all; see the 2026-07-31 entry below for what running these tests for real actually found.)

## 2026-07-31 — organizations.status enforcement: explicitly not implemented without a product decision

While verifying the M1-M5 multi-tenant foundation end-to-end (per Mohammed's instruction to treat it as one integrated subsystem and execute real security tests, not just review the design), found that `organizations.status` (`suspended`/`archived`/`cancelled`/etc.) is not checked by any RLS policy — an archived or suspended org's own members retain full data access, proven with a real pgTAP assertion, not inferred.

**Decision: do not implement enforcement speculatively.** `SUPER_ADMIN.md` documents what these statuses mean for billing/dashboard visibility but never states what they should mean for the org's own member access — full lockout, read-only, or unaffected (billing-only) are all defensible product choices with materially different UX and support implications, and picking one silently would be inventing a business rule that hasn't been decided. Logged as `TECHNICAL_DEBT_REGISTER.md` TD-17 / `RISK_REGISTER.md` R-22 instead, to be resolved once Mohammed decides the intended behavior — most naturally paired with `TASKS.md` M9/M19 when billing enforcement is actually built, since that's the first point an org would ever really become suspended.

Also fixed two smaller, real gaps found in the same verification pass (both are mechanical corrections, not decisions, but noted here for the same session's record): `[db.seed]` was never configured in `supabase/config.toml`, so `supabase db reset`'s seed step had silently no-opped every single time since the seed file was moved to `supabase/seed/seed.sql` weeks ago (fixed: added `sql_paths = ["./seed/seed.sql"]`); and `organizations.status`'s `archived` enum value was documented in `DATABASE.md`/`SUPER_ADMIN.md` but never actually added to the Postgres enum (fixed: migration `20260101000025`). Full narrative, including the `LegacyHealthCheckTimeoutError` root-cause investigation (Docker-socket-unreachable `vector` sidecar container, infrastructure-only, not our code), is in `WORKLOG.md` 2026-07-31.

## 2026-07-31 — "RLS has no policy" is not an immutability control; hard triggers are

While building `TASKS.md` M14 (Accounting core ledger), re-examined `ACCOUNTING.md` §1's stated enforcement mechanism before implementing it rather than after: "no financial record is ever edited after posting... enforced at three layers... RLS has no update/delete policy on those tables for any role, including elevated ones." Checked whether that's actually true in this Supabase project — it isn't. `service_role` has `BYPASSRLS = true` (confirmed via `select rolbypassrls from pg_roles` earlier this session, 2026-07-31 continued). RLS policies, present or absent, have zero effect on a role that bypasses RLS. "No update/delete policy" was never a control against the one credential most likely to be used for a bulk/backend write path — it only ever restricted `anon`/`authenticated`.

**Decision: implement the real mechanism (hard `BEFORE UPDATE OR DELETE` triggers that unconditionally reject the operation) rather than the documented-but-insufficient one**, and correct `ACCOUNTING.md` §1 to describe it accurately rather than silently leaving the stronger implementation undocumented or the weaker claim standing. A trigger fires regardless of RLS bypass or which role is writing — including the table owner — which is what "even elevated roles" actually requires. Applied to `journal_entries`/`journal_lines` (migration `20260101000035`) and, on re-examining the codebase for the same documented-but-insufficient pattern rather than stopping at the one instance in front of me, `audit_events` too (migration `20260101000036`, identically worded "no update/delete policy... trustworthy audit trail" claim, same fix). Proved both with pgTAP assertions that specifically run in the `postgres` superuser connection context (which also bypasses RLS) rather than only testing against `authenticated` — testing only the weaker role would have proven nothing about the actual threat the requirement cares about.

One narrow, deliberate exception: `journal_entries.reversed_by_entry_id` may be set exactly once, `null`→value, when a reversal posts against an entry — the trigger allows only this single field-and-direction change, discovered as a real necessity while wiring `reverse_journal_entry()` (a first version was `security invoker` and its linkage update silently matched zero rows under RLS rather than erroring, since no UPDATE policy exists at all on `journal_entries` by design — fixed by making that one function `security definer`, which bypasses RLS but not the trigger, so the hard immutability guarantee is unaffected).

## 2026-07-31 — M14 (Accounting) split into two parts rather than attempted whole

`TASKS.md` M14 has been flagged as the project's highest-risk single workstream since the original retain/rebuild audit. Rather than attempt the full scope (core ledger, trust/deposit accounting, bank reconciliation, owner statements, tax pack) in one pass, split it: part 1 is the ledger foundation everything else must post through (chart of accounts, journal entries/lines, period locking, the posting primitives, immutability) — built and verified to the same standard as every other milestone this session, including the trigger-based immutability fix above. Part 2 (typed posting operations wiring real product flows to that foundation, and the remaining `DATABASE.md` §9 tables) is real, separate, substantial work, explicitly not started and not claimed as done in `TASKS.md`. This mirrors the same discipline applied to M11 (documents/financials org-scoping done; storage-policy cutover and mobile upload flow explicitly deferred as TD-21) rather than a new pattern — large modules get an honest, visible seam between "verified done" and "not yet built," not a milestone marked complete because most of it is.

## 2026-07-31 — `resolve_whatsapp_sender()`: cross-tenant EXECUTE-grant vulnerability found and fixed before shipping

While building M17 (WhatsApp)'s resolution algorithm (`WHATSAPP.md` §1.2), checked the new `security definer` function's actual grants live (`select grantee, privilege_type from information_schema.role_routine_grants where routine_name = 'resolve_whatsapp_sender'`) rather than assuming migration 024's project-wide default-privilege grant was safe for this specific function — it wasn't. `resolve_whatsapp_sender(text)` takes an unscoped phone number and returns which org/entity/tenant/owner it belongs to; unlike `has_org_role()`-style functions (which only confirm the *caller's own* membership), this function's output is not naturally bounded by the caller's identity. Migration 024 grants `EXECUTE` on all functions, including future ones, to `anon`/`authenticated`/`service_role` by default — so both `anon` and `authenticated` had `EXECUTE` on it, meaning any client, even an unauthenticated one, could enumerate which org/tenant/owner record owns any phone number.

**Fixed before the migration was ever committed**: added `revoke execute on function public.resolve_whatsapp_sender(text) from public, anon, authenticated;` to migration `20260101000040` itself, plus a dedicated regression test (`supabase/tests/email_whatsapp_isolation.test.sql`) proving an ordinary `authenticated` caller now gets `42501 permission denied`. Only `service_role` (the WhatsApp webhook handler's own execution context) can call it. Logged here because this is a real vulnerability class worth naming for future security-definer functions taking unscoped inputs, not just a one-off fix: **any `security definer` function whose input isn't already scoped to the caller's own org/identity needs its `EXECUTE` grant checked explicitly, never assumed safe from the project's default grants.**

While reviewing this fix, applied the same check to the rest of the session's `security definer` functions and found one related, lower-severity gap in already-shipped code: `reverse_journal_entry()` (migration `20260101000035`) ran its authorization check (`has_org_role(v_original.org_id, 'accountant')`) *after* branching on the entry's `reversed_by_entry_id`/`is_reversal` state, so a caller with accountant rights in *any* org (not the entry's own org) could distinguish "not found" from "found but already reversed" from "found but is itself a reversal" for a foreign org's entry by its exception message — a low-severity information leak (requires guessing a valid UUID; no actual entry data is disclosed) but a real one. Fixed via a new migration (`20260101000041`, `CREATE OR REPLACE FUNCTION`, since 035 is already committed) that moves the authorization check immediately after the "not found" check, before any state-dependent branch — a caller without rights to the entry's org now gets the identical generic "not found" message regardless of the entry's real state.

## 2026-08-01 — M18 (AI): audit_events cutover done now, not deferred further; staged-endpoint SSRF guard added proactively

Building the Conversational Assistant's confirm-path (`AI_ARCHITECTURE.md` §1.6) required `audit_events.actor_type = 'ai_assisted'` plus `ai_conversation_id`/`ai_message_id` pointers — none of which the live schema (`customer|admin|system`, `target_type`/`target_id`, `owner_user_id`) could represent (`TECHNICAL_DEBT_REGISTER.md` TD-14, open since 2026-07-30). Rather than invent a workaround (e.g. overloading `action` text to smuggle in AI context, or skipping AI audit logging as a stopgap), did the real TD-14 schema paydown now (migration `20260101000043`) — confirmed first that zero real writers existed anywhere in TS (grepped `apps/admin`, `apps/mobile`, `packages/*`), so this was a pure schema change with no data-migration risk, unlike TD-01/TD-02's expand/contract dance. `supabase/tests/accounting_core.test.sql`'s own audit_events fixture needed a matching update (old columns/enum value) — expected blast radius, not a regression, fixed in the same pass. Deliberately did **not** also wire the two now-unblocked call sites (`reopen_accounting_period()`, `POST /api/v1/organizations`) in this same change, to keep the migration a schema change only rather than also becoming a re-open-and-re-verify pass over M5/M14's already-shipped route code — left open in TD-14, narrowed rather than closed outright.

**Confirm-path re-entry, and a proactive security addition**: `AI_ARCHITECTURE.md` §1.7's sequence diagram describes the confirm step as calling the staged endpoint "in-process, as the acting user." Next.js route handlers have no clean in-process invocation path across route-file boundaries, so this is realized as a same-origin `fetch()` forwarding the caller's own session cookie — the target route's own `getServerSupabaseClient()` then resolves the identical `auth.uid()`/role, so the enforcement is byte-for-byte identical to a human hitting that endpoint directly, even though the mechanism isn't literally an in-process function call. Because `staged_changes.endpoint` is LLM-produced output (mock today, a real vendor's output once one is selected), added `isValidStagedEndpoint()` (`apps/admin/lib/ai.ts`) requiring it to match a strict `^/api/v1/[a-zA-Z0-9\-/]+$` pattern before the confirm route is allowed to `fetch()` it — closing an SSRF/open-redirect vector a future prompt-injected model response could otherwise exploit (e.g. staging `endpoint: "https://attacker.example/collect"`). Nothing in `AI_ARCHITECTURE.md` asked for this explicitly; added proactively because trusting model-shaped output as safe-by-construction is exactly the kind of gap this session's `resolve_whatsapp_sender()`/`reverse_journal_entry()` findings above were about — the general lesson applies here too, before a real vendor is even chosen, not after.

## 2026-08-01 — M19 (Super Admin): rebuilding customers/subscriptions was authorized by the milestone's own scope, not a new go-ahead sought separately

`TECHNICAL_DEBT_REGISTER.md` TD-16 / `RISK_REGISTER.md` R-21 had left `customers/page.tsx`'s broken `owner_user_id` query unfixed specifically because it was pre-existing uncommitted work, and the session's standing git-safety instruction is not to edit unrelated in-progress work without explicit authorization. `SUPER_ADMIN.md` §0 (written well before this session started building M19) already explicitly scopes `customers/page.tsx` and `subscriptions/page.tsx` as "not reused — needs rebuilding" as part of Super Admin's own deliverables, and Mohammed's instruction for this pass was to complete M19 per the existing architecture docs. Read together, that constitutes the authorization TD-16 was waiting on for these two specific files — not a separate go-ahead, but the milestone's own pre-written scope combined with the explicit instruction to complete it. Rebuilt both (`apps/admin/lib/superAdmin.ts`'s `listPlatformOrganizations()`/`getPlatformOrganizationDetail()`), which incidentally resolves the underlying bug (the new queries never reference `owner_user_id` at all) — but the fix is a side effect of doing the mandated rebuild correctly, not a target chosen independently. `processing/page.tsx` and `adminMockData.ts` (the same file family, TD-16's own note that they weren't individually re-checked) were **not** touched — they were never in M19's scope, so the original caution still applies to them and TD-16 was narrowed, not closed outright.

## 2026-08-01 — Two real, pre-existing schema bugs found while building M19's read/write paths, both fixed via new migrations

While wiring the Super Admin plan-management endpoint (`POST /api/v1/admin/plans`), found that `plans` (migration `20260101000019`, M9-era, already shipped) declares both a column-level `unique` on `code` and a table-level `unique (code, version)`. The column-level constraint makes it impossible to ever insert a second row sharing a `code`, regardless of `version` — silently breaking the documented plan-versioning design (`SUPER_ADMIN.md` §5 / `DATABASE.md` §1: "a price change creates a new version; existing subscriptions keep the version they signed up under"). Never caught before because nothing had ever tried to insert a second version of an existing plan's code until this milestone's own endpoint attempted it. Confirmed the auto-generated constraint name live (`select conname from pg_constraint where conrelid = 'public.plans'::regclass`) both before writing the fix (to find the exact name, `plans_code_key`) and after applying it (to confirm only the intended composite constraint remains) — fixed via migration `20260101000046`, since `20260101000019` is already committed.

Separately, while wiring the archive action (`POST /api/v1/admin/organizations/:orgId/archive`), found `packages/types/src/enums.ts`'s `ORGANIZATION_STATUSES` was missing `'archived'`, even though the Postgres enum gained that value in migration `20260101000025` (2026-07-31's session). This is the exact same class of drift migration `20260101000025`'s own header comment warned about for the enum itself ("This was never caught before because nothing has ever tried to write 'archived' to this column") — except this time the gap was one level up, in the TypeScript mirror of the enum, not the enum itself. Fixed directly in `enums.ts`, confirmed live post-fix (`select enumlabel from pg_enum where enumtypid = 'public.organization_status'::regtype` returns all 6 values, matching the corrected TS array). General lesson, worth naming for future work: an `ALTER TYPE ... ADD VALUE` migration is not complete until its TypeScript mirror is checked too — the two can drift independently, and neither this session nor the original 2026-07-31 fix caught it until a real write path exercised the missing value.

**Usage-cap enforcement is real but currently a no-op**: `checkAiUsageCap()` sums the org's current-calendar-month `usage_events` (`usage_type = 'ai_token'`) against `plans.feature_limits.aiMonthlyTokenCap` and blocks with `429 ai_usage_cap_exceeded` before calling the LLM provider, per `AI_ARCHITECTURE.md` §4's exact enforcement point. No plan has this key configured yet — real cap numbers are a pricing decision (`SUBSCRIPTIONS.md`), not something to invent here — so an absent/non-numeric cap is treated as unlimited. This means the enforcement code path is real and tested, but will not actually block anyone until Mohammed sets a real number on a real plan.

## 2026-08-01 — Design phase: native platforms specified, not coded; a real display bug found extending the design system

Per Mohammed's explicit instruction after M19: paused new UI implementation for a design review
(`DESIGN_REVIEW.md`) and design-system rewrite (`DESIGN_SYSTEM.md`) before continuing, comparing
`reference/propview-screenshots/` against two Envato "Property Mobile App UI Kit" listings
provided as visual inspiration. Both kits are consumer real-estate marketplace apps — confirmed
their information architecture and user journeys are out of scope (`PRODUCT_SPEC.md` already
establishes PropertyVault as portfolio management, not a marketplace); their component-level craft
(shadow/radius execution, dark-theme contrast handling, filter-panel layout) was extracted as
inspiration, their actual colours/copy were not copied, matching `PROPVIEW_SCREENSHOT_AUDIT.md`
§5's existing "do not copy exact hex values" rule extended to the new references.

**Native iOS/Android: specification only, a scope question asked and answered explicitly rather
than assumed.** `MOBILE_ARCHITECTURE_DECISION.md` confirms zero native code exists in this repo
and this session's environment has no Xcode (requires macOS — an OS constraint, not a missing
package) and no confirmed Android toolchain. Rather than silently skip native platforms or
silently write unverifiable `.swift`/`.kt` source and present it as done, asked Mohammed directly:
spec-only, best-effort unverified source, or skip entirely. Answer: spec-only, explicitly *not* as
a way of skipping native platforms — `NATIVE_IOS_SPEC.md`/`NATIVE_ANDROID_SPEC.md` were written to
the full depth Mohammed specified (navigation, screens, component mapping, HIG/M3 compliance,
state management, offline, accessibility, animations, notifications, deep links, biometric auth,
tablet behaviour) precisely so a future session with real Xcode/Android Studio tooling can
implement against them with minimal redesign, not as a lesser substitute for building the apps.

**A real, live display bug found while extending `statusPresentation.ts`** (not while chasing a
bug report — found by the design-system work itself, matching this session's pattern of
verification surfacing real gaps): `CustomersTable.tsx`'s inline `STATUS_TONE` map was still keyed
on the old PropVault-era per-user subscription vocabulary
(`active/trialing/grace_period/billing_issue/expired/cancelled`). M19's rebuild (this same day,
earlier) changed `customers/page.tsx` to pass real `OrganizationStatus` values
(`trial/active/overdue/suspended/cancelled/archived`) into that same table without updating the
table's own colour map — every status except the two that happen to share a name
(`active`/`cancelled`) would have rendered as unstyled plain text. Fixed by adding
`ORGANIZATION_STATUS_PRESENTATION` (`packages/ui`) and a shared `StatusBadge` component, used by
`CustomersTable`/`SubscriptionsTable`/the organization detail page, with a defensive fallback for
demo mode's still-different legacy vocabulary (left as-is — cosmetic-only, not this pass's target).

## 2026-08-01 — M20: `(portal)` route group used instead of the ARCHITECTURE.md-correct `(dashboard)` name, because of a live process this session must not touch

`ARCHITECTURE.md`'s "Why one web app, not two" section names the client-org route group
`app/(dashboard)/**` and the Super Admin route group `app/(super-admin)/**`. What's actually on
disk is the reverse: M19's Super Admin work was built at `(dashboard)` (per `SUPER_ADMIN.md` §0's
"reused from apps/admin as-is," which didn't flag the naming mismatch against `ARCHITECTURE.md` at
the time it was written). Starting M20's first client-org page, attempted the correct fix — `git
mv "apps/admin/app/(dashboard)" "apps/admin/app/(super-admin)"` — and got `Permission denied`.

**Investigated rather than forcing it** (`Get-CimInstance Win32_Process -Filter "Name =
'node.exe'"`, checking each process's command line): found a `next dev -p 3005` process with a
working directory inside `apps/admin`, launched independently of anything this session started —
its file watcher holds a lock on the `(dashboard)` directory, which is what blocked the rename.
This is very likely Mohammed's own live preview session. **Decision: do not kill it, do not force
the rename.** An unfamiliar running process is exactly the "unfamiliar existing state — investigate
before deleting or overwriting" case the session's standing safety rules describe, and killing
someone else's live dev server to force a directory rename is a disproportionate, unilateral
action for what has zero user-facing consequence either way (Next.js route group names in
parentheses never appear in the resulting URL — `(dashboard)/overview` and
`(super-admin)/overview` both resolve to `/overview` identically).

**Resolution**: built the new client-org pages under `(portal)` instead — a real name, distinct
from both `(dashboard)` (still Super Admin, unchanged) and the `ARCHITECTURE.md`-correct
`(super-admin)` (not yet used). This is purely an internal source-tree organization choice with no
URL or user-facing impact. The proper `(dashboard)`→`(super-admin)` rename (and, at the same time,
`(portal)`→`(dashboard)`, to land exactly where `ARCHITECTURE.md` says) is left as an explicit,
tracked follow-up (`TASKS.md` M20) for whenever that lock is confirmed clear — most likely by
asking Mohammed directly whether it's safe to restart that dev server, rather than guessing.

**Secondary consequence, disclosed rather than absorbed silently**: the same `next dev` process
has almost certainly been running for this entire session (well before this was discovered), which
means every earlier `pnpm --filter admin build`/`next start` verification call this session (M16
through the design phase) may have raced against it on the shared `.next` build-output directory.
No corruption or failure was actually observed in any of those runs — every one of them completed
and reported success — but "no failure observed" is not the same as "confirmed safe," so this is
flagged as a real gap in this session's own verification confidence for that historical work, not
retroactively claimed as fine. Going forward, `next build`/`next start` are paused for `apps/admin`
until confirmed safe; `pnpm typecheck`/`pnpm lint`/`pnpm --filter admin test` (none of which touch
`.next`) remain the verification path in the meantime.

**Resolved, same day**: Mohammed confirmed and explicitly instructed stopping the process. Re-queried `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"` to get current PIDs (they'd changed since first discovered), confirmed the exact four-process tree belonging to this `next dev -p 3005` instance by command line (`npx-cli.js next dev -p 3005`, `next/dist/bin/next dev -p 3005`, `start-server.js`, and its `.next/dev/build/*.js` worker) — explicitly filtered OUT the six other unrelated Node processes on the machine (several `vite`/`npm run dev` processes under unrelated `nextgen-*` projects) rather than broadly killing every Node process, since only the exact tree matching this repo's path was in scope. Stopped all four, confirmed port 3005 no longer listening. Completed both renames immediately after (`git mv (dashboard) (super-admin)`, `git mv (portal) (dashboard)`) — both succeeded on the first attempt with the lock cleared. Full build/runtime verification resumed in the same batch (see `WORKLOG.md`).

## 2026-08-01 — M22: Android toolchain gaps found and fixed; JDK 25 incompatibility; two real build bugs

Mohammed confirmed Android Studio had been installed and instructed a full toolchain
verification, explicitly warning not to assume every component was configured. Investigated
rather than assumed, per that instruction: Android Studio itself and an SDK directory existed, but
`cmdline-tools` (needed for `sdkmanager`/`avdmanager`) was entirely missing, and no AVD existed.
Downloaded and installed `cmdline-tools` (Google's official `commandlinetools-win` zip), used
`avdmanager` to create `PropertyVault_Pixel7_API35` (no Pixel 8 device profile exists in this
cmdline-tools version's bundled device list; Pixel 7 is the newest available, a reasonable "recent
Pixel profile" substitute).

**Real, reproduced JDK incompatibility, not assumed**: Android Studio's bundled JBR is OpenJDK
25.0.2. Per Mohammed's instruction to prefer the bundled JDK, attempted to use it for
`gradle wrapper`/all subsequent builds — it failed with `java.lang.IllegalArgumentException:
25.0.2` inside Gradle 8.7's own bundled Kotlin DSL compiler's `JavaVersion.parse()`, confirmed via
`--stacktrace`, not guessed. This isn't a project misconfiguration; it's a real version mismatch
between a very recent JBR and Gradle 8.7's Kotlin-DSL-script-evaluation tooling, which needs to
parse the running JDK's version and doesn't yet recognize "25.0.2"'s format. Downloaded Eclipse
Temurin 21 LTS (a widely-supported, known-compatible version for current AGP/Kotlin/Gradle) and
wired it via `org.gradle.java.home` in `~/.gradle/gradle.properties` — Gradle's own user-level
config file, not a system-wide `JAVA_HOME`, per the explicit "do not modify system-wide
environment variables unnecessarily; prefer project-local configuration" instruction. This is
machine-local by nature (a JDK install path is never portable across machines), so it was
deliberately kept out of the committed `apps/android/gradle.properties` (which stays project-local
and portable) and documented instead in `apps/android/README.md`.

**Two real build bugs found and fixed** while getting the first `gradlew assembleDebug` green:

1. Android XML comments reject `--` inside the comment body (`themes.xml`, both launcher-icon
   vector drawables used the "--" aside style this session has used in every other language
   throughout the whole project) — a real `mergeDebugResources` failure pointed at the exact file
   and line; fixed by rewording every affected comment to avoid the sequence.

2. `com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0` — confirmed present
   on both the `debugCompileClasspath` and `debugRuntimeClasspath` via `gradlew app:dependencies`,
   and confirmed via `javap` that the exact class (`KotlinSerializationConverterFactory`) exists in
   the resolved jar at the expected path — yet the Kotlin compiler reported a persistent
   "Unresolved reference" that survived a full `--stop`/clean/`--rerun-tasks` cycle. Rather than
   keep sinking time into an unexplained toolchain issue on a first-time environment, replaced the
   external dependency with a ~30-line hand-rolled `Converter.Factory`
   (`SerializationConverterFactory.kt`) built directly on `kotlinx.serialization`'s own public
   `serializer(java.lang.reflect.Type)` JVM-reflection bridge (`@ExperimentalSerializationApi`,
   correctly handles generic types like `List<PropertyDto>`) — removing the dependency and the
   mystery together. Logged as a real, disclosed engineering substitution, not silently done: if a
   future session with more toolchain-debugging headroom isolates the actual cause, reintroducing
   the library is a one-file revert (`NetworkModule.kt`'s two call sites plus the removed
   dependency lines).

Full command-by-command verification record (build, unit tests, lint, real emulator install/
launch, screenshots in light and dark mode) is in `TASKS.md` M22 and `apps/android/README.md`'s
"Toolchain status" table, not repeated here.

## 2026-08-01 — M20: Units/Tenants/Leases/Maintenance vertical slices — parent-context creation, and two deliberate scope reductions

Continued M20 per Mohammed's instruction to build Units/Tenants/Leases/Maintenance one module at a
time, same vertical-slice pattern Properties proved. All four reused their existing M6/M8/M10/M13
APIs and `apps/admin/lib/{portfolio,leasing,operations}.ts` mapping/role-check helpers completely
unchanged — this pass is UI-layer work only, no backend logic was added or modified.

**Decided: every "create" flow is reached from its parent's own page, never a standalone form with
a picker.** Units are created from a property's page (`/properties/:id/units/new`), Leases from a
unit's page (`/properties/:id/units/:unitId/leases/new`), Maintenance tickets from a property's
page (`/properties/:id/maintenance/new`). This wasn't a UI-taste choice — none of `unitSchema`/
`leaseCreateSchema`/`maintenanceTicketCreateSchema` expose a way to look up or search for a parent
record from a bare form; the parent id has to come from somewhere, and the URL route the user
already navigated through is the only correct source that doesn't require inventing a new
search/autocomplete component this pass didn't otherwise need. Each parent's detail page now
embeds a table of its children (property → units, property → maintenance tickets, unit → leases)
so the "list" requirement is satisfied in the natural context as well as at the org-wide list page.

**Decided: Tenants and Leases forms omit fields the validation schema deliberately doesn't expose
to clients, rather than showing them disabled.** `tenantSchema` excludes `status` (server-set,
defaults `pending`); `leaseCreateSchema` excludes `status` (always starts `draft`) and — like every
other form this pass — excludes any field backed by a single-value enum with no real second option
yet (`rentFrequency`, currently only `'monthly'`). A disabled/greyed-out field would imply "not
editable right now" when the true state is "there is nothing here to legitimately submit yet" — a
different, more honest signal, matching the same judgment already applied to `packages/validation`
itself when those schemas were first written.

**Decided: Maintenance's board is grouped-by-status, not drag-and-drop.** The reference product's
evidenced Maintenance Board (`PROPVIEW_SCREENSHOT_AUDIT.md` IMG_7967-7968) is a real kanban with
drag gestures between columns. Building actual drag-and-drop (a new interaction pattern, its own
optimistic-update/rollback logic, its own test surface) was weighed against just linking each
ticket card to its edit page, where the existing server-side `isValidMaintenanceTransition` state
machine already enforces the same legal-transition rule a kanban drag would need to respect anyway.
Chose the link — a confirmed, disclosed V1 scope reduction (flagged in `TASKS.md`/`WORKLOG.md`, not
silently simplified), not a shortcut around the underlying business rule, which is enforced exactly
the same either way.

**Decided: the maintenance status `<select>` is not pre-filtered to legal next-states.**
`MAINTENANCE_TRANSITIONS` (the `to_do → in_progress → pending_approval → completed` graph, plus one
intentional backward step per stage) lives in `apps/admin/lib/operations.ts`, which starts with
`import 'server-only'` and therefore cannot be imported into the `'use client'` `MaintenanceForm`.
Rather than hand-copy the transition graph into a second, client-side version — exactly the kind of
duplicated-source-of-truth `requireOrgRole()`'s own code comment already warns against for role
hierarchies, guaranteed to drift the next time the graph changes — the form offers all 4 statuses
and lets the server's existing 409 `invalid_transition` response surface through the generic error
banner every form this pass already has. A wrong selection produces a clear rejected-with-reason
message, not a silent no-op or a client/server mismatch bug.

Full verification record (typecheck/lint/test/build/runtime-smoke-test command output for each of
the four modules) is in `WORKLOG.md`'s four corresponding 2026-08-01 entries and each slice's own
commit message, not repeated here.

## 2026-08-01 — M20 Accounting: the agent+ UI role-gate used by every prior module is wrong for Accounting; added a dedicated accountant+ check instead of reusing it

Every M20 module built before Accounting (Units, Tenants, Leases, Maintenance, Owners,
Applications, Inspections) gated its write actions with the same inline check:
`role !== 'viewer' && role !== 'accountant'` — i.e. "agent or above." That's correct for those
modules specifically because `PERMISSIONS.md`'s "Properties/Units/Leases/Tenants"/"Applications"/
"Maintenance" columns all list `agent` as Full. It does not generalize: the same table's
"Accounting (post)" column grants Full to `accountant`/`manager`/`principal` and explicitly
nothing to `agent`.

Confirmed this is real enforcement, not just a documentation intent, before writing any UI: read
`invoice_rent_schedule()` and `record_expense()`
(`supabase/migrations/20260101000038_accounting_posting_operations.sql`) directly. Both open with
`if not public.has_org_role(v_schedule.org_id, 'accountant') then raise exception ...` — a hard
database-level rejection, independent of anything the API route or UI does. `has_org_role()`'s own
code comment (`supabase/migrations/20260101000021_org_role_helpers.sql`) is explicit that `agent`
and `accountant` are siblings, not points on one linear scale — `min_role: 'accountant'` resolves
to exactly `{accountant, manager, principal}`, and `min_role: 'agent'` resolves to exactly
`{agent, manager, principal}`. Reusing the agent+ inline check for Accounting would have shown an
`agent`-role user an "Issue invoice"/"Record expense" button that the database would then reject —
still safe (the real enforcement holds), but a real trust/UX bug: a button that lies about what it
can do.

**Decided**: added two small, explicitly named, non-overlapping checks to
`apps/admin/lib/orgSession.ts` — `canWriteOrgRecords()` (the existing agent+ semantics, now named
and centralized rather than re-typed as a literal inline expression in every new file) and
`canPostAccountingRecords()` (the new accountant+ semantics). Did not attempt to unify these into
one ranked permission system — that would misrepresent the real, sibling-role structure
`has_org_role()` itself deliberately preserves. Unit tested both, including an explicit assertion
that they're non-overlapping on exactly `agent`/`accountant` (`orgSession.test.ts`), since a wrong
role list here is a silent security-relevant UI bug, not a cosmetic one, and the kind of mistake
that's easy to introduce by copy-pasting a working pattern into a context where it doesn't apply.

Did not retroactively refactor the 8 already-shipped modules' inline agent+ checks to call the new
`canWriteOrgRecords()` — those checks are correct as written, and touching 8 already-verified files
for a pure DRY improvement with zero functional change is exactly the "refactor only when it
improves maintainability without introducing risk" judgment call, not a safe zero-risk mechanical
change given each file would need re-verification. Flagged as a candidate for a dedicated
small cleanup pass later, not done opportunistically here.

## 2026-08-01 — Applications simplified to V1 scope: manual review only, screening deferred not deleted

Mohammed: PropertyVault V1 is not a tenant-screening/applicant-management platform. Landlords/staff
review applicants and documents directly and decide manually — automated screening scores,
applicant ranking, AI recommendations, and bureau integrations (TPN/Experian/TransUnion) are out of
scope for V1.

**Decided**: expand-only migration (`20260101000047`) adding `reviewing`/`withdrawn` to
`application_status` and a `notes` column, rather than touching the existing `screening`
status/columns or `TenantScreeningProvider`. The already-built screening apparatus (schema,
provider abstraction, `POST /:id/screen`) is sound work built to spec last session — not deleted,
just left dormant and un-surfaced in the UI, per Mohammed's explicit "do not delete sound backend
work merely because it already exists" instruction. Moved to `ROADMAP.md` V2 so a future screening
build resumes from this foundation instead of starting over.

**Decided**: `notes` save silently transitions `submitted`→`reviewing` on first save, rather than a
separate "start review" button. The described V1 workflow ("landlord reviews applicant and
documents, records notes") treats opening-and-annotating as what "under review" means — a second
button for the same moment would be friction without adding information.

**Decided**: kept `approve_application()` and the approve/decline decision panel entirely
unchanged. It already does exactly what was asked ("on approval, proceed to tenant and lease
creation") — the correction was about what happens *before* a decision, not the decision/lease-
creation step itself.

Verified with real execution, not just code review, since this touches a live migration: local
Supabase reset (`supabase db reset`, Docker started for this) replayed all 47 migrations clean; the
full pgTAP suite (176 assertions, 13 files) passed with no isolation/RLS regressions. Full
verification detail in `WORKLOG.md` 2026-08-01.

## 2026-08-01 — Real bug found while building the Owner Dashboard: no client-org user could ever reach their portal via login

Building `/dashboard` (the client-org landing page) surfaced a real, pre-existing routing bug, not
something introduced by this change: `apps/admin/app/page.tsx` (the root `/` route) only ever
checked `getAdminSession()` (platform-admin auth) and redirected to `/overview` on any signed-in
session, or `/login` otherwise. `/login`'s own form always did `router.replace('/overview')`
regardless of which kind of account had just signed in. A client-org member (an
`organization_members` row, no `platform_admin_users` row) would sign in successfully, get sent to
`/overview`, and immediately bounce back to `/login` from that route group's own
`getAdminSession()`-only layout check — an infinite redirect loop with no way to ever reach the
portal this session spent all day building pages for.

**Root cause**: `PERMISSIONS.md`'s "never merge role systems" principle was followed correctly at
the page/layout level (every `(dashboard)` page checks `resolvePortalSession()`, every
`(super-admin)` page checks `getAdminSession()`, independently) but never applied at the single
shared entry point (`/` and `/login`) that has to decide *which* portal a given signed-in user
should land in. Not caught earlier because every module built this session was reached directly by
URL during its own smoke test (`/units`, `/tenants`, etc.), never through the actual login → root
redirect chain — the first time that exact path was exercised end-to-end was building the
Dashboard's own "where does a user land" question.

**Fixed**: `/` now checks `getAdminSession()` first (unchanged priority), then — only outside demo
mode — `resolvePortalSession()`, redirecting to `/dashboard` if the caller has an active org
membership, else `/login`. `/login` now redirects to `/` and lets that logic decide, instead of
hardcoding `/overview` itself. Demo mode's behavior is unchanged on purpose: `getAdminSession()`
always returns a fixed session in demo mode, so `/` always resolves to `/overview` there, exactly
as before — demo mode has one deliberate entry point, not two, and this fix doesn't touch that.

**Also fixed in the same pass**: `middleware.ts`'s `PROTECTED_ROUTE_PREFIXES`/`config.matcher`
(the coarse pre-render auth gate) hadn't been updated since the M20 vertical-slice pass added 12
new `(dashboard)` route segments across 7+ commits — each of those pages independently enforces
its own session/role check (the real enforcement, per this file's own header comment, exactly as
designed), so this was never a data-exposure gap, but it was a real, live UX gap: an unauthenticated
request could reach the page shell before an API call 401s, for every route added since the last
time this list was touched. Added all 12 missing prefixes (`/units`, `/owners`, `/tenants`,
`/leases`, `/applications`, `/maintenance`, `/inspections`, `/accounting`, `/documents`,
`/notifications`, `/announcements`, `/reports`) plus `/dashboard`.

Verified: admin typecheck/lint/test (103/103) and real `next build` clean (middleware's `matcher`
stayed a static literal array, the exact class of failure that broke this file once before this
session), demo-mode smoke test confirming `/` still resolves to `/overview` unchanged and
`/dashboard` renders correctly.

## 2026-08-01 — V1 scope corrected: a basic web tenant portal is now in scope, not deferred

Every module built earlier this session (Applications, Maintenance ticket submission, Announcement
acknowledgement, `TASKS.md`/`WORKLOG.md`'s own M8 tenant-table entry) deliberately excluded any
tenant-facing UI on the standing basis "no tenant portal in V1." Reaching priority 9 of the
remaining-work list ("Tenant-facing experience") surfaced a direct conflict with that standing
decision. Asked the user how to proceed; answer was to treat this the same way the Applications
module's scope was corrected mid-session: build a basic tenant portal now, updating
`PERMISSIONS.md`/`MOBILE_ARCHITECTURE_DECISION.md` to reflect the change rather than leaving them
describing a decision no longer in effect.

**Scope built**: own lease, payment balance/history, maintenance (view + submit own), notices
(view + acknowledge). Deliberately not built (same "basic, not a platform" instruction the
Applications correction used): no tenant messaging, no document upload by tenants, no profile/
settings editing, no native tenant app. Documents are tenant-visible only when a staff member
explicitly tags one with `documents.lease_id` — a narrower grant than "all of a property's
documents," since owner-only paperwork (municipal bills, insurance, compliance docs) lives in the
same table and must stay invisible to tenants (`PERMISSIONS.md` §4's "never: owner financials").

**Real bug found and fixed while building this**: the first draft of
`supabase/migrations/20260101000049_tenant_portal_rls.sql` wrote the new `leases`/`documents`/
`rent_schedules` tenant-self policies as raw `exists (select ... from lease_tenants ...)`
subqueries. `lease_tenants` already has its own policy (`lease_tenants_select_org_member`,
migration `20260101000030`) that queries back into `leases` to resolve `org_id` (the join is
required — `lease_tenants` has no `org_id` column of its own). Querying `leases` therefore
triggered `lease_tenants`'s RLS, which queried `leases` again — `42P17: infinite recursion detected
in policy for relation "leases"`, caught by `npx supabase test db` failing 3 of 13 suites before
any commit. Fixed the same way `has_org_role()` already solves this identical class of problem
elsewhere in the schema: added `caller_is_tenant_of_lease(p_lease_id uuid)`, a `SECURITY DEFINER`
function whose internal query runs as the function owner and so does not re-trigger
`lease_tenants`'s own RLS, breaking the cycle. Re-ran `npx supabase db reset` + `npx supabase test
db` after the fix: clean 176/176 pass, same count as before this migration.

Verified: full pgTAP suite (176/176) after the recursion fix; admin typecheck/lint/test and a real
build/demo-mode smoke test are recorded in `WORKLOG.md`'s corresponding entry once that pass
completes.

## 2026-08-01 — Android Maintenance ticket submission deferred: a real gap between API_SPEC.md's contract and the actual server implementation

While scoping the Android Maintenance vertical slice, `MOBILE_ARCHITECTURE_DECISION.md` §6/§7 was
explicit that ticket *submission* (not just viewing) is the native-app write-path priority. Checked
what wiring a real `POST /api/v1/maintenance-tickets` call from Android would take before building
it, and found `apps/admin`'s API routes authenticate exclusively via `getServerSupabaseClient()`
(cookie-session-only) — they never read an `Authorization: Bearer` header, despite `API_SPEC.md`
§0 stating that contract explicitly "so native mobile apps consume the same API surface as the web
app." A native call with a valid JWT would 401 today, for every mutating admin route, not just this
one — every route was built and verified against the web client's cookie session, the only caller
that existed until a native write path was actually attempted.

**Decision**: don't fix it as a side effect of this Android slice, and don't route around it. Fixing
it means changing the shared auth-resolution helper (`getServerSupabaseClient()`) every existing API
route depends on — an `auth`-classified, high-risk change per this project's own task-routing rules,
deserving its own explicit pass and verification, not something to fold into a UI feature slice.
Routing around it (a direct Postgrest insert from the native client) would violate this project's
own established API-layer-writes-only discipline (`API_SPEC.md` §0's reads-only carve-out exists to
guarantee audit-trail writes and business-rule validation on every mutation). Filed as
`TECHNICAL_DEBT_REGISTER.md` TD-28. The Android Maintenance slice shipped view-only (list + detail)
instead; ticket submission stays deferred until TD-28 is deliberately paid down. Same judgment
already applied to support-mode's TD-25 for the same underlying reason — a real, security-adjacent
gap correctly flagged rather than silently patched.

## 2026-08-02 — Found and fixed: the production CSP has been blocking hydration on every admin page since the first commit

Mohammed asked for a full UI/UX redesign and to install real browser-verification tooling
(Chrome DevTools) for the work. No mechanism exists in this environment to register a new MCP
server mid-session (no `claude` CLI, and MCP servers connect at client startup, not dynamically) —
`.mcp.json` was written for shadcn/chrome-devtools so they're available after a reload, and a
standalone `puppeteer-core` script (pointed at the already-installed system Chrome) was built as a
working substitute for this session. The very first real-browser check against the running PWA
(`/overview`, production build, demo mode) surfaced something far more important than a visual
gap: every KPI card and chart was a permanently frozen `loading.tsx` skeleton — actual React
hydration was never completing.

**Root cause**: `next.config.ts`'s static `Content-Security-Policy` header
(`script-src 'self'`) has been present, unchanged, since this project's very first commit
(`ce0f389`, "Phase 0 + Phase 1: PropVault monorepo foundation") — it never included
`'unsafe-inline'` or a nonce for scripts. Next.js's own App Router streams page content to the
browser via several inline `<script>` tags (`self.__next_f.push(...)`) that deliver the RSC
payload and trigger hydration; CSP was blocking every one of them, in every real browser, on every
page, this entire project. This was never caught because every "demo-mode smoke test" claim made
across this whole session (dozens of commits) was verified with `curl | grep` against raw response
bytes — `curl` doesn't execute JavaScript or enforce CSP at all, so a page whose initial HTML
happens to contain the right text greps identically whether or not a real browser would ever
actually render it. This is a real, disclosed gap in this session's own past verification depth,
not a fabricated result — the curl checks that were run did run and did return what was reported —
but they were never sufficient to catch a client-hydration failure, and are documented here so
future verification for this app always includes a real browser, not just `curl`.

**Fix**: Next.js 16 deprecated `middleware.ts` in favor of `proxy.ts` (renaming only, same
mechanism) — migrated in the same pass since the CSP fix required touching this file anyway.
Implemented the officially documented nonce pattern (nextjs.org/docs/app/guides/content-security-policy):
`proxy.ts` generates a fresh nonce per request, sets it as the `Content-Security-Policy` response
header (`script-src 'self' 'nonce-<value>' 'strict-dynamic'`) and forwards it via an `x-nonce`
request header; Next.js automatically parses its own nonce back out of the response CSP header and
applies it to every framework/hydration script it injects, no per-component wiring needed. This
requires every page to render dynamically (a nonce can't exist at build time) — every route
group's layout and the root `/page.tsx` already forced this; `/login` and
`/onboarding/create-organization` didn't (both are single-file `'use client'` pages with nowhere
to attach the `dynamic` export) — split each into a thin Server Component `page.tsx`
(`export const dynamic = 'force-dynamic'`) plus an unchanged, relocated client `*Form.tsx`.
`next.config.ts`'s own CSP entry was removed (a static header can't carry a per-request value).

**Verified with the real browser tooling that caught this**, not just curl: `/overview` (light and
dark), `/login`, `/dashboard` all render real, fully hydrated content with zero CSP console errors
— confirmed via screenshot, not just an HTTP 200. Also: `pnpm typecheck`/`lint`/`test` (112/112) and
a real production build, all clean. The rest of this session's already-shipped functionality (RLS,
API business logic, Android) is unaffected — this bug was specifically about client-side script
execution in a browser, which none of the backend/pgTAP/pnpm-test verification this session relied
on would ever exercise.
