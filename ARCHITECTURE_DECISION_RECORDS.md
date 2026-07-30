# Architecture Decision Records

Standard ADR format: Status, Context, Decision, Consequences. Compiled from decisions already made across `DECISIONS.md` (chronological log) and this document's own Production Readiness Review (2026-07-30) — this file is the structured, query-by-topic index; `DECISIONS.md` remains the chronological narrative. If the two ever disagree, `DECISIONS.md`'s dated entry is the source of truth for _when/why_, this file for _what/consequences_.

---

### ADR-001: PropertyVault supersedes PropVault as the product direction

**Status**: Accepted (2026-07-29)
**Context**: The existing codebase was explicitly scoped as a single-owner personal document vault ("not a rental-management platform," `PROJECT.md`). The governing product specification requires a full multi-tenant landlord/tenant SaaS.
**Decision**: PropertyVault (multi-tenant) supersedes PropVault (single-owner) as the product this codebase builds toward, decided module-by-module on evidence (`RETAIN_REFACTOR_REBUILD_MATRIX.md`), not a wholesale restart.
**Consequences**: Every table keyed by `owner_user_id` requires eventual cutover to `org_id` (tracked as technical debt, `TECHNICAL_DEBT_REGISTER.md`). Existing monorepo tooling, CI, auth wrapper, RLS pattern, and UI primitives are retained; the ownership model, accounting engine, and most domain tables are net-new.

### ADR-002: Organization/membership as a first-class layer, not additive columns

**Status**: Accepted (2026-07-30)
**Context**: Multi-tenancy requires distinguishing staff-of-an-org, owner-records, and tenant-records as independent relationships, since one human can hold multiple simultaneously (evidenced: one PropView login with both Landlord and Tenant portals).
**Decision**: `organization_members` (staff, role-scoped), `owners` (payee records, optional login), and `tenants` (occupant records, optional login) are three separate tables, each optionally pointing at `auth.users`, never merged into one role column on the user.
**Consequences**: Every permission check resolves through the correct one of three tables depending on what's being accessed (`PERMISSIONS.md`) — more query complexity than a single role column, but the only model that supports the evidenced dual-portal-per-login pattern and avoids conflating "can log in" with "has a business relationship to this org."

### ADR-003: South Africa as the explicit V1 target jurisdiction

**Status**: Accepted (2026-07-29)
**Context**: The reference product is deeply South Africa-specific (POPIA, RHA, SARS tax years, CIPC, Property Practitioners Act FFC) — not a generic template.
**Decision**: Build compliance modules (Trust & Deposits, Tax Pack, Organisation profile) as real South African regulatory features, not behind a jurisdiction-abstraction layer.
**Consequences**: Faster V1 delivery, evidenced-accurate compliance behavior. Expansion to a second jurisdiction later requires a real redesign of these modules (not a config flip) — accepted risk, logged in `RISK_REGISTER.md`.

### ADR-004: Accounting engine built in-house, no third-party integration

**Status**: Accepted (2026-07-29)
**Context**: PropView's own Trial Balance/Owner Statements/Tax Pack appear to be a bespoke double-entry ledger, not a Xero-style integration.
**Decision**: Build a real double-entry accounting engine in-house (`ACCOUNTING.md`).
**Consequences**: Highest-effort, highest-risk single workstream in the whole build (`TASKS.md` M14) — full control and evidenced-accurate behavior, at the cost of owning correctness (immutability, balancing, period-locking, trust accounting) that a third-party integration would have offloaded. No accounting-software export path exists for orgs wanting to hand data to an external accountant's tool of choice — logged as a gap in `RISK_REGISTER.md`.

### ADR-005: No vendor self-service portal in V1

**Status**: Accepted (2026-07-29)
**Context**: `Vendor Bills` implies vendor invoice submission, but no vendor-facing login was ever evidenced in the 138 reference screenshots.
**Decision**: Staff/landlord captures vendor bills on the vendor's behalf (upload + AI-assisted extraction); no new vendor authentication surface in V1.
**Consequences**: Smaller V1 attack surface and scope. Vendors cannot self-serve; revisit in V2 if this proves a real operational bottleneck.

### ADR-006: One native app per platform, role-aware, not separate Owner/Tenant apps

**Status**: Accepted (2026-07-29)
**Context**: The reference product's own account model has one login holding both Landlord and Tenant portal identities, switchable in-session.
**Decision**: A single iOS app and single Android app each, with role-aware navigation switching between Owner/Landlord and Tenant experiences based on the account's enabled portals.
**Consequences**: Lower App Store/Play Store management overhead (2 listings instead of 4), shared auth/biometric/notification infrastructure. Security is unaffected either way — enforced server-side (`PERMISSIONS.md`), not by which app binary is running. Full reasoning: `MOBILE_ARCHITECTURE_DECISION.md` §5.

### ADR-007: `admin_users` → `platform_admin_users` rename deferred to Milestone M19 (Super Admin)

**Status**: Accepted (2026-07-30)
**Context**: `DATABASE.md`'s target schema names this table `platform_admin_users`; the live table is still `admin_users`.
**Decision**: Defer the rename until the Super Admin portal rebuild (M19) actually opens `apps/admin/lib/auth.ts`/`middleware.ts`/`roleRank.ts` — do not touch working code for a cosmetic rename ahead of that milestone.
**Consequences**: Documentation and live schema intentionally disagree on this one table's name until M19 lands — every architecture doc referencing `platform_admin_users`/`is_platform_admin()` carries an explicit naming note (fixed in the 2026-07-30 consistency review) so this isn't mistaken for an oversight.

### ADR-008: Journal entries and audit events are insert-only with no update/delete RLS policy for any role

**Status**: Accepted (2026-07-30)
**Context**: Financial and audit history must be tamper-evident even against a compromised service-role credential or a rogue insider with database console access.
**Decision**: `journal_entries`, `journal_lines`, `audit_events` carry no `update`/`delete` RLS policy at all, for any role, including `principal`. Corrections are reversing entries, never edits.
**Consequences**: A correction is always visible as two entries (original + reversal), never a silent edit — this is the mechanism that makes the audit trail and Trial Balance trustworthy. Slightly more complex correction UX (staff must understand "reverse and re-enter," not just "edit the wrong field") — accepted, since the alternative (mutable financial history) is not acceptable for a regulated trust-accounting product.

### ADR-009: WhatsApp identity resolution never trusts message content, only verified phone numbers

**Status**: Accepted (2026-07-30)
**Context**: A shared single platform WhatsApp number means an inbound message's only reliable signal is the sender's phone number — trusting sender-claimed identity in message text would allow trivial impersonation.
**Decision**: Resolve inbound WhatsApp identity exclusively via `verified_phone_numbers` (OTP-verified, not just typed into a form). Zero, one, or multiple matches are handled explicitly (unauthenticated / resolved / ambiguous); ambiguous matches disclose only generic role labels, never identifying details, until resolved (tightened by the 2026-07-30 review — see `WHATSAPP.md` §1.2).
**Consequences**: More upfront design/build cost (a new verification table and OTP flow) than a naive "look up by phone number" approach, but closes an impersonation vector that would otherwise be trivial to exploit on a shared-number channel. Residual risk: phone-number recycling between verification and use — logged in `RISK_REGISTER.md`.

### ADR-010: Email sends from a shared PropertyVault domain with org-level Reply-To, not per-org custom domains, in V1

**Status**: Accepted (2026-07-30)
**Context**: Per-org custom-domain verification (SPF/DKIM/DMARC per org) is real operational complexity for a benefit (cosmetic sender address) that doesn't change deliverability or trust.
**Decision**: One PropertyVault-owned sending domain, centrally configured; `Reply-To` set to the org's own contact address so replies reach the landlord/agency directly.
**Consequences**: Faster, lower-risk V1 email launch. No white-label sending for orgs wanting their own domain — explicitly a revisit-later item, not foreclosed (`EMAIL.md` §7).

### ADR-011: Conversational Assistant and Portfolio Intelligence are architecturally separate AI surfaces, never blurred

**Status**: Accepted (2026-07-30)
**Context**: The reference product evidences two distinct AI-adjacent features with different trust properties: an LLM-backed chat, and a rules-based insights feed explicitly marketed as "nothing is estimated or made up."
**Decision**: Portfolio Intelligence never calls an LLM, under any framing — this is a hard architectural constraint, not an implementation detail (`AI_ARCHITECTURE.md` §2.1).
**Consequences**: Two codepaths to maintain instead of one unified "AI features" module, but preserves a specific, evidenced product guarantee that would be silently broken by a future engineer routing insight text through an LLM "just for phrasing."

### ADR-012: Owner and tenant records are decoupled from `auth.users`, with optional portal login

**Status**: Accepted (2026-07-30)
**Context**: An owner or tenant must be able to exist as a real business record (for accounting/lease purposes) before, or entirely without, ever being invited to a portal.
**Decision**: `owners`/`tenants` are independent tables with a nullable `user_id` — a login is a capability granted to a record, not a prerequisite for the record existing.
**Consequences**: Clean support for "bookkeeping-only" owners/tenants and for the portal-invite workflow. Slightly more complex than assuming every owner/tenant has a login from creation.

### ADR-013: RLS is the enforcement ground truth; the API layer is a fail-fast convenience, not the security boundary

**Status**: Accepted (2026-07-30)
**Context**: A buggy or bypassed API layer must not become a cross-tenant data breach.
**Decision**: Every table's RLS policy independently re-derives org/role/tenant/owner scoping from `organization_members`/`tenants`/`owners`, assuming the API layer could be wrong. The API layer additionally checks the same thing for a fast, clear 403 before any query runs.
**Consequences**: Two places to keep in sync (API-layer checks and RLS policies) instead of one — accepted, because a single-layer design means one bug class (an API-layer authorization mistake) becomes a full tenant-isolation breach instead of a caught-by-the-database non-event.

### ADR-014: Every external integration is built behind a vendor-agnostic provider interface with a mock implementation shipped first

**Status**: Accepted (2026-07-21, PropVault-era pattern; extended 2026-07-30 to WhatsApp/Email/LLM)
**Context**: OCR, subscriptions, email, WhatsApp, and LLM vendor selections are all either deferred decisions or external-service blockers this session cannot resolve.
**Decision**: Every one of these integrations is built against a typed interface (`DocumentIntelligenceProvider`, `SubscriptionProvider`, `EmailProvider`, `WhatsAppProvider`, `LLMProvider`) with a deterministic mock implementation shipped first, so the surrounding UI/business logic can be built and tested before any real vendor account exists.
**Consequences**: The rest of the system is never blocked on an external account being provisioned. Vendor switching later is an implementation swap behind an unchanged interface, not a re-architecture.

---

## New ADRs from the Production Readiness Review (2026-07-30)

### ADR-015: No general-purpose caching layer in V1; targeted, measured fixes only

**Status**: Accepted (2026-07-30)
**Context**: Review found no caching strategy existed anywhere in the architecture. The obvious fix (add Redis) was considered and rejected as premature.
**Decision**: Cache only reference data that's safe to serve slightly stale (`plans`), rely on correct indexing rather than caching for RLS-scoped per-org reads, and treat "add an external cache" as an escalation path gated on measured (not speculative) load-test evidence.
**Consequences**: Lower V1 build cost and no second-source-of-truth staleness risk to reason about. Accepted risk: if org-membership resolution does become a bottleneck at real scale, the fix (session-scoped Postgres claims, `DATABASE.md` § RLS performance at scale) is a bigger change than adding a cache would have been — judged worth it to avoid solving a problem that may never materialize at the cost it would take to solve prematurely.

### ADR-016: Mobile offline support scoped to read-through cache + a single write queue (Maintenance), not full offline-first

**Status**: Accepted (2026-07-30)
**Context**: Review found offline/sync entirely unaddressed. A full offline-first architecture (local DB, bidirectional sync, conflict resolution) was considered and rejected as disproportionate to V1's already-narrow native-app scope.
**Decision**: Cached last-known-good reads for view screens; a real local write queue with background retry for Maintenance ticket submission only (the one write action most likely to happen with no signal, and a pure-insert with no conflict-resolution stakes); every other write requires connectivity in V1.
**Consequences**: Real gap closed for the highest-value flow at a fraction of full offline-first's cost. Payments/approvals/settings changes remain online-only — accepted, explicit V1 boundary, revisit with usage evidence.

### ADR-017: Single-region deployment for V1, with `org_id` preserved as the future sharding key

**Status**: Accepted (2026-07-30)
**Context**: Review evaluated multi-region readiness against a South-Africa-first target market.
**Decision**: One Supabase project, one region, for V1 — but confirm the deployment schema (every table org-scoped) already supports future geographic partitioning by `org_id` without a data-model change.
**Consequences**: No premature multi-region infrastructure cost. Accepted risk: single-region is a single point of regional failure — mitigated (not eliminated) by the backup/DR strategy (`DEPLOYMENT.md` §9), logged in `RISK_REGISTER.md`.

### ADR-018: Platform-level cross-org metrics via scheduled snapshot rollups, never live aggregate queries

**Status**: Accepted (2026-07-30)
**Context**: Super Admin dashboard metrics (`count(*)` across all orgs) would become a real cost/latency problem at "tens of thousands of organisations" scale if computed live on every dashboard load.
**Decision**: `platform_metrics_snapshots`, computed hourly by a scheduled job, is what the dashboard reads — mirroring the `usage_snapshots` pattern already used for per-org metering.
**Consequences**: Dashboard is up to one hour stale on platform-wide figures — acceptable for a Super Admin operational dashboard, not acceptable if it were ever repurposed for real-time alerting (it isn't).

### ADR-019: Manual accounting period locking in V1, not automatic

**Status**: Accepted (2026-07-30)
**Context**: Review found no mechanism preventing a backdated post into an already-reconciled month.
**Decision**: `accounting_periods` table; an accountant/principal explicitly closes a period; the posting service rejects new entries dated into a closed period; reopening is itself an audited, role-gated action.
**Consequences**: Requires org staff to remember to close periods (no automatic enforcement in V1) — accepted as a reasonable V1 scope given real usage data doesn't yet exist to design automatic closing rules around.

### ADR-020: RLS performance mitigation is staged — index first, session-claim escalation only if measured need exists

**Status**: Accepted (2026-07-30)
**Context**: `has_org_role()` is `security definer` and not plan-inlined, a real but currently-unmeasured performance concern at "tens of thousands of orgs" scale.
**Decision**: Ship with a composite index supporting the function's internal query; document (but do not build) the session-scoped-claim escalation path; do not build a caching layer preemptively.
**Consequences**: V1 ships without a load-tested performance guarantee at extreme scale — acceptable given no production traffic exists yet to profile against; the escalation path is documented precisely so it's a known, planned change rather than a scramble if/when it's needed. Logged as a monitored risk, `RISK_REGISTER.md`.
