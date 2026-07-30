# Architecture

## System overview

PropertyVault is a multi-tenant property-management SaaS: a monorepo backend + responsive web app (retained/extended from PropVault), plus two from-zero native mobile apps. Backed by Supabase (Postgres + Auth + Storage + Edge Functions) for the backend, with an application-service layer enforcing business rules that RLS alone can't express (accounting immutability, application-approval automation, inspection-gated deposit release).

```
                         ┌─────────────────────────┐
                         │   Supabase Postgres      │
                         │  (org-scoped tables,     │
                         │   RLS on every table,    │
                         │   see DATABASE.md)       │
                         └────────────┬─────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
          ┌─────────▼──────┐ ┌────────▼────────┐ ┌──────▼───────┐
          │ Supabase Auth   │ │ Edge Functions   │ │ Storage       │
          │ (all identity)  │ │ (posting service,│ │ (documents,   │
          │                 │ │  webhooks, OCR    │ │  photos,      │
          │                 │ │  orchestration)   │ │  PDFs)        │
          └─────────┬───────┘ └────────┬─────────┘ └──────┬───────┘
                    │                  │                   │
        ┌───────────┴──────────────────┴───────────────────┴───────────┐
        │                          REST/RPC API surface (API_SPEC.md)   │
        └───────────┬───────────────────┬───────────────────┬──────────┘
                    │                   │                   │
          ┌─────────▼──────┐  ┌─────────▼──────┐  ┌─────────▼──────┐
          │ apps/web        │  │ Native iOS      │  │ Native Android │
          │ (Next.js,       │  │ (Swift/SwiftUI) │  │ (Kotlin/       │
          │  staff+admin+   │  │  Owner+Tenant   │  │  Compose)      │
          │  super admin)   │  │                 │  │  Owner+Tenant  │
          └─────────────────┘  └─────────────────┘  └────────────────┘
```

## Applications

| App                                                      | Stack                                          | Users                                                                          | Status                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `apps/admin` → renamed `apps/web`                        | Next.js App Router, retained shell             | Landlord/agency staff (all roles), platform Super Admin (separate route group) | Refactor — retained auth/RBAC pattern and UI primitives, rebuilt data/routes per `RETAIN_REFACTOR_REBUILD_MATRIX.md` |
| `apps/ios` (new, replaces `apps/mobile` for iOS)         | Swift, SwiftUI, Xcode                          | Owner/Landlord + Tenant (role-switched in one app)                             | Full rebuild — see `MOBILE_ARCHITECTURE_DECISION.md`                                                                 |
| `apps/android` (new, replaces `apps/mobile` for Android) | Kotlin, Jetpack Compose, Android Studio/Gradle | Owner/Landlord + Tenant (role-switched in one app)                             | Full rebuild — see `MOBILE_ARCHITECTURE_DECISION.md`                                                                 |
| `apps/mobile` (Expo)                                     | Retired once native apps reach feature parity  | —                                                                              | Reference only during migration; not deployed to app stores                                                          |

**Why one web app, not two (client-facing + Super Admin)**: the master prompt requires the Super Admin portal be inaccessible to client roles (§12) — this is enforced by route-group separation (`app/(dashboard)/**` for client orgs, `app/(super-admin)/**` for platform staff) plus an independent auth check (`platform_admin_users` membership, never an org role), not by a shared role enum with a "super" tier. A client `principal` role and a platform `super_admin` role are unrelated types; conflating them was the exact anti-pattern the master prompt's §12 warns against ("must not be visible or accessible to... client administrators").

## Multi-tenancy model

Organization-scoped throughout (`DATABASE.md` §0.1). A request is authorized by: (1) Supabase Auth verifies `auth.uid()`, (2) the API layer resolves which `org_id`(s) that user belongs to via `organization_members`/`tenants`/`owners`, (3) RLS independently re-enforces the same scoping at the database layer. Two independent enforcement layers (API + RLS) rather than one, so a bug in application-layer authorization doesn't become a cross-tenant data leak by itself.

Portal identity (Landlord/Owner vs. Tenant, evidenced in the reference product as a "Switch Portal" control on one account) is resolved per-session from which role records (`organization_members`, `tenants`, `owners`) the authenticated user has — not a separate credential per portal.

## Business logic placement

- **Simple CRUD** (properties, units, vendors, announcements): RLS + thin API validation is sufficient; no dedicated service layer needed.
- **Multi-table transactions** (application approval → tenant+lease+rent_schedule; inspection completion → gated deposit release; rent posting → journal entries): implemented as Postgres functions or Edge Functions wrapping an explicit transaction, never as client-side sequential API calls — a partial failure must not leave, e.g., a `lease` created without its `rent_schedules`.
- **Accounting posting**: a dedicated posting service (Edge Function) is the _only_ code path permitted to write `journal_entries`/`journal_lines`. No other part of the system writes to these tables directly, even server-side — this is what makes the "immutable, reversing-entries-only" rule in `ACCOUNTING.md` actually enforceable rather than just documented.
- **AI Assistant**: conversational turns are LLM calls that produce _staged_ changes (`ai_messages.staged_changes`), written nowhere else until the user confirms — the LLM never has direct write access to business tables.
- **Portfolio Intelligence**: a scheduled rules job (not an LLM) that evaluates live data against fixed conditions (overdue rent, expiring leases, etc.) and writes `portfolio_insights` rows — kept separate from the AI Assistant specifically to preserve the evidenced "nothing is estimated or made up" guarantee (`AI_ARCHITECTURE.md`).

## Retained from PropVault (evidence: `EXISTING_CODEBASE_AUDIT.md`)

- Monorepo tooling (pnpm/Turborepo/TS/ESLint), CI pipeline shape.
- Supabase-Auth wrapper on both web and mobile (sign-in/up/out, password reset, email verification).
- RLS _pattern_ (deny-by-default, `security definer` helpers, service-role-only privileged tables) — policies themselves rewritten per `DATABASE.md` §12.
- `packages/utils`'s `calculateMatchScore` — retained, re-targeted at bank-line↔rent-payment matching.
- `packages/ui` design tokens and both apps' component primitive libraries (Card, StatCard, EmptyState, table/chart primitives) — extended with new screens, not replaced.
- The upload → AI-extract → human-review pattern (`DocumentIntelligenceProvider`) — extended from bills-only to leases/invoices/expenses.
- `audit_events` table and its insert-only, no-client-write RLS pattern.

## Rebuilt from zero

Organizations/membership/roles, owners, tenants, leases, applications, rent schedules, inspections, maintenance, vendors, the entire accounting subsystem (chart of accounts, journal entries, trust ledgers, bank reconciliation, owner statements, tax pack), announcements, notifications, WhatsApp/email integration, Super Admin billing/plan configuration, AI Assistant + Portfolio Intelligence, and both native mobile apps. See `RETAIN_REFACTOR_REBUILD_MATRIX.md` for the full module-by-module list and reasoning.

## Caching strategy (added by Production Readiness Review, 2026-07-30 — previously unaddressed anywhere in the architecture)

No caching layer existed in the design prior to this review. Three genuinely hot, cheap-to-cache read paths, addressed with the least-invasive option that solves each (not a single blanket cache layer bolted on everywhere):

1. **Reference data that changes rarely, read constantly**: `plans`, `plans.feature_limits`. In-process/edge-cache with a short TTL (e.g. 60s) or cache-on-deploy invalidation — this data changes only when Super Admin edits a plan, which is rare and can tolerate a minute of staleness. No Redis needed for this one; a simple in-memory cache per Edge Function instance (or Next.js's built-in data-cache primitives for `apps/web`) is sufficient.
2. **Org-membership/role resolution**: resolved on every authenticated request today (`API_SPEC.md` §0, `ARCHITECTURE.md` § Multi-tenancy model). At scale this is the highest-frequency lookup in the system. V1 does **not** add a cache here — it relies on the index-friendly query path (`DATABASE.md` § RLS performance at scale, mitigation 1) being fast enough on its own, since a cache here introduces a real correctness risk (a revoked membership must take effect immediately for security-sensitive checks, not after a cache TTL expires) that isn't worth taking on without a measured need. If load testing later shows this is a bottleneck, the fix is the session-scoped Postgres claim (`DATABASE.md`'s mitigation 2), not an external cache, specifically because a Postgres-session-scoped value is re-resolved every request by construction — it can't go stale between requests the way a Redis-cached value could.
3. **Computed/expensive reports**: Trial Balance (`ACCOUNTING.md` §6) is a live aggregate query over `journal_lines` — cheap for a single org at V1 data volumes, but grows with ledger size. Rather than caching a query result that must always reflect the very latest posting (staleness here is unacceptable — an accountant reconciling books needs the true current state), the mitigation is the indexing already specified (`journal_lines(org_id, ...)`) plus the explicit non-goal of caching this particular read: if it ever becomes slow, the fix is a materialized summary table refreshed on every posting-service write (kept exactly current, not TTL-stale), not a generic cache.

**Explicit non-goal for V1**: a general-purpose Redis/Upstash caching layer across arbitrary API responses. Every read in this system is RLS-scoped and mostly per-org (bounded working set per query), which is the main reason a blanket cache isn't the first tool reached for here — the real lever at this scale is correct indexing (`DATABASE.md` §13), which is cheaper to build, cheaper to reason about correctness for, and doesn't introduce a second source of truth to keep in sync. Revisit if profiling data from production (not speculation) shows a specific endpoint is both hot and safely cacheable.

## Environments

- **Local dev**: `supabase start` (Docker) for a local Postgres/Auth/Storage instance; demo-mode flag available for zero-backend UI iteration (existing pattern retained, but see `SECURITY.md` — the default-ON behavior is fixed in this rebuild, not carried forward as-is).
- **Staging**: a real Supabase project, seeded with synthetic multi-org data for QA across tenant boundaries specifically (verifying org A can never read org B's data is a standing staging-environment test, not a one-time check).
- **Production**: a separate Supabase project; `SUPABASE_SERVICE_ROLE_KEY` never reaches any client bundle (retained pattern, `server-only` package enforced at build time).

## Deployment topology

See `DEPLOYMENT.md` for the full pipeline. Summary: `apps/web` deploys to Vercel (or equivalent Next.js host) from `main` via CI; `apps/ios`/`apps/android` build via Xcode Cloud/Fastlane and Gradle/Fastlane respectively, gated on the same CI checks (lint/typecheck/test) applied to their native toolchains; Supabase migrations apply via CI on merge to `main`, never manually against production.
