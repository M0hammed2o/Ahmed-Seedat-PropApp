# PropVault → PropertyVault Codebase Audit

Repository root: `C:\Users\junsm\Downloads\PropValt (Property App)`. Read-only investigation; no files were modified in the course of this audit. All findings below are `Verified:` (inspected file content directly, or captured actual command output, in this session) unless explicitly labeled otherwise.

**Context**: the existing codebase ("PropVault") was built as a personal property-document-vault app for individual owners — single-owner-per-record data model, no landlord/tenant relationships. The confirmed direction (see `DECISIONS.md`) is that this project now becomes "PropertyVault": a full multi-tenant landlord/tenant property-management SaaS, evaluated module-by-module against the reference product documented in `PROPVIEW_SCREENSHOT_AUDIT.md`.

---

## 1. Monorepo / tooling

**Verified:** Infrastructure is sound and pivot-agnostic — no coupling to the single-owner domain model.

- `pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*"]` — standard glob, nothing product-specific.
- `turbo.json`: standard `build`/`dev`/`lint`/`typecheck`/`test` pipeline with `dependsOn: ["^build"]` and cache outputs. No product-specific task wiring.
- `tsconfig.base.json`: strict TS config — `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, ES2022 target, Bundler resolution. High-quality, reusable baseline.
- `eslint.config.mjs` (root, flat config, shared across the monorepo): `@typescript-eslint/no-explicit-any: 'error'`, `@typescript-eslint/consistent-type-imports: 'error'`, `import/no-cycle: ['error', { ignoreExternal: true }]`, `no-console: ['warn', { allow: ['warn','error'] }]`. Generic, reusable.
- `.github/workflows/ci.yml`: single `verify` job — `pnpm install --frozen-lockfile` → `format:check` → `lint` → `typecheck` → `test` → `pnpm --filter admin build` (with `NEXT_PUBLIC_DEMO_MODE: 'true'`, so CI never needs a live Supabase project) → a secret-scan grep step. No mobile build/EAS step exists in CI (mobile has no `build` script — see §5/§8).
- `package.json` (root): `packageManager: pnpm@9.15.0`, `engines.node >=20`. Package is named/described as `"propvault"` / `"PropVault - personal property document vault and payment-tracking SaaS"` — cosmetic-only rename needed, not structural.

**Assessment:** monorepo tooling, TS config, lint config, and CI pipeline shape are reusable as-is regardless of the pivot. Only the root `package.json` name/description is stale.

---

## 2. Database / data model

**Verified** — read all 15 migration files in `supabase/migrations/`. Full table inventory:

| Table                                                           | Key columns                                                    | Ownership model                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `admin_users` (000003)                                          | `auth_user_id`, `role admin_role`, `display_name`, `is_active` | Platform-staff table — not org-scoped, single flat role enum               |
| `profiles` (000004)                                             | `id` (=auth.users.id), `display_name`, `onboarding_step`       | 1:1 with `auth.users` — **the account holder IS the record**, no org layer |
| `user_preferences` / `user_terms_acceptances` (000005)          | `user_id` PK                                                   | single-user                                                                |
| `properties` (000006)                                           | `owner_user_id uuid not null references auth.users(id)`        | **single-owner**                                                           |
| `document_categories` / `property_expected_categories` (000007) | `owner_user_id` (nullable, for custom categories)              | single-owner or global default                                             |
| `documents` (000008)                                            | `owner_user_id`, `property_id`                                 | **single-owner**                                                           |
| `bills` / `payments` (000009)                                   | `owner_user_id`, `property_id`                                 | **single-owner**                                                           |
| `payment_matches` (000010)                                      | `owner_user_id`, `payment_id`, `bill_id`                       | **single-owner**                                                           |
| `extraction_jobs` / `extraction_results` (000011)               | `owner_user_id`, `document_id`                                 | **single-owner**                                                           |
| `subscriptions` / `subscription_events` (000012)                | `owner_user_id` (unique — one subscription per user)           | **single-owner**                                                           |
| `audit_events` (000013)                                         | `owner_user_id`, `actor_user_id`, `actor_type`                 | **single-owner**                                                           |

Every customer-owned table's ownership column is literally `owner_user_id uuid not null references auth.users(id) on delete cascade` — a direct FK to the Supabase auth user, confirmed identically across `properties` (line 3), `documents` (line 3), `bills` (line 5), `payments` (line 49), `payment_matches` (line 8), `extraction_jobs`/`extraction_results` (lines 5, 34), `subscriptions` (line 7), `audit_events` (line 10). `DATABASE.md` line 11 states this as a hard convention: _"Every customer-owned table has `owner_user_id uuid not null references auth.users(id)` and an RLS policy scoped to `auth.uid() = owner_user_id`."_

**Concepts present:** none of the following exist anywhere in the schema — confirmed by reading all 15 migrations: `organization`, `org_id`, `tenant_id` (multi-tenant sense), `landlord`, `tenant` (renter sense), `lease`, `rent`, `maintenance_ticket`, `vendor`, `vendor_invoice`, `staff`, `unit` (rental unit). `admin_users.role` is a flat `admin_role` enum (`super_admin`, `support_admin`, `operations_admin`, `read_only_admin`) scoped to the whole platform, not to any organization.

**Plain statement:** this schema is **fundamentally single-tenant** — every business table hangs off exactly one `auth.users.id` via `owner_user_id`, with no intermediate organization/account entity, no concept of an owner _record_ distinct from the logged-in user, no staff-within-an-org, no tenant/lease/rent-collection concept at all. It supports "one individual owns their own data," not "an organization's staff manage many owners' and tenants' data." Building PropertyVault's multi-tenant SaaS on this schema requires a new organization/membership layer and near-total redesign of every business table's ownership/RLS model, not additive columns.

---

## 3. RLS / security model

**Verified** — read `SECURITY.md` in full, cross-checked against migrations and app code.

- RLS pattern (`SECURITY.md` lines 27-38, confirmed identical in every migration): `select`/`update`/`delete` using `owner_user_id = auth.uid()`, `insert` with `check (owner_user_id = auth.uid())`. Single-owner RLS throughout — no org-membership join, no role-based policy branching for staff, no landlord-vs-tenant policy split.
- `admin_users` (000003, lines 19-23): **no RLS policy at all** for any client role — access is service-role-only by design (default-deny). `is_admin(min_role)` (lines 28-49) is a `security definer` SQL function used as defense-in-depth in route handlers, "never used to grant customer-table RLS access" (comment, line 55).
- **Demo-mode auth bypass — confirmed still present and still defaults ON:**
  - `apps/admin/lib/demoMode.ts:16`: `export const ADMIN_DEMO_MODE = isDemoMode(process.env.NEXT_PUBLIC_DEMO_MODE);` — reads `packages/config`'s `isDemoMode()`, which (per `SECURITY.md` line 7 and code comment lines 8-14) defaults **ON when unset**.
  - `apps/admin/middleware.ts:18-20`: `if (ADMIN_DEMO_MODE) { return NextResponse.next(); }` — skips the session check entirely.
  - `apps/admin/lib/auth.ts:24-31`: `getAdminSession()` returns a fixed fake `super_admin` session when demo mode is on, never touching Supabase.
  - `apps/mobile/src/features/auth/AuthProvider.tsx:56-60, 82-107`: when `DEMO_MODE` is true, `signIn`/`signUp` resolve after a fake 400ms delay and set a locally-constructed fake `Session` — no real Supabase Auth call.
  - `SECURITY.md` lines 5-18 flags this as "⚠️ RELEASE-BLOCKING": _"an unset variable in a real deployment is a full authentication bypass, not a safe default."_ `TODO.md` line 5 repeats this as the first release-blocking item.
  - **Status: unresolved as of this audit** — the flag mechanism, its ON-by-default behavior, and every bypass path `SECURITY.md` describes are still present in code exactly as documented.
- Storage: private bucket (`public=false`), path-scoped RLS requiring `(storage.foldername(name))[1] = auth.uid()::text` (migration 000015, lines 18-44) — sound single-owner pattern, needs the same organization-layer rework as table RLS.
- Admin route handlers described in `ARCHITECTURE.md` (`app/api/admin/**`, `app/api/webhooks/revenuecat/`, `app/api/webhooks/ocr/`) **do not exist in the codebase** — `Glob apps/admin/app/api/**/*` returned zero files. Designed but not implemented; the only real server-side admin logic is `lib/auth.ts`'s `getAdminSession()`/`requireRole()` plus page components calling `getServiceRoleClient()` directly.

**Assessment:** the RLS _pattern_ (deny-by-default, explicit owner-scoped policies, service-role-only for privileged tables, security-definer helper functions) is sound engineering worth preserving as a pattern. Every actual policy predicate must be rewritten for org/role/landlord/tenant scoping.

---

## 4. Auth

**Verified.**

- **Admin (`apps/admin`)**: Supabase Auth via `@supabase/ssr`, gated by `middleware.ts` (coarse redirect-to-login) plus `lib/auth.ts`'s `getAdminSession()`/`requireRole(minRole)` (re-checked in every handler — `middleware.ts:8-12` comment: _"middleware can be bypassed in some deployment configurations"_).
- **Mobile (`apps/mobile`)**: `AuthProvider.tsx` wraps `@supabase/supabase-js` (`getSupabaseClient()`, SecureStore-backed per `ARCHITECTURE.md:67`), exposing sign-in/up/out, password reset, email verification. No role concept on the mobile side at all — every mobile user is a plain `auth.users` row with a `profiles` row.
- **Role model:** the only role enum anywhere is `admin_role` on `admin_users` (migration 000002 lines 23-25) — a **platform-staff** role (functionally a proto-Super-Admin-portal), not a client-organization role. No concept of roles _within_ a client account.
- **Super Admin distinction:** `admin_role` already separates `super_admin` from lower tiers (`is_admin()` ranks roles), so the _shape_ of a platform-level Super Admin role already exists — it just has no organizations underneath it yet. `DATABASE.md` line 35 notes `admin_roles` (a join-table version) was deferred in favor of the enum column — worth revisiting for a proper Super-Admin billing portal.

---

## 5. Frontend apps

### `apps/admin` (Next.js App Router)

**Verified routes** (`Glob apps/admin/app/**/*.tsx`): `layout.tsx`, `page.tsx`, `login/page.tsx` (demo mode accepts any credentials), `error.tsx`/`global-error.tsx`, `(dashboard)/layout.tsx`, `(dashboard)/overview`, `customers`, `customers/[id]`, `subscriptions`, `processing`, `system`. No `app/api/**` routes exist despite being documented in `ARCHITECTURE.md` — not yet implemented, demo-mode-only currently.

`customers/page.tsx` (read in full) is representative: `requireRole('read_only_admin')` is always called, then data comes from a real Supabase query (`getCustomers()`) or `DEMO_CUSTOMERS` mock data, branched on `ADMIN_DEMO_MODE`. The real Supabase code paths exist and are reachable, per `TODO.md:6`.

UI components (`AdminDataTable`, `AdminMetricCard`, `HealthStatusIndicator`, `MiniBarChart`, `MiniLineChart`, `CustomersTable`, `SubscriptionsTable`, `ProcessingTable`) are generic dashboard/table/chart primitives with no single-owner-domain coupling in their props — reusable as visual/structural building blocks; the _data_ each table renders (customers = individual owners) needs new tables (organizations, staff, properties-per-org, tenants, leases).

### `apps/mobile` (Expo Router)

**Verified: no native project scaffolding exists.** A repo-wide search for `.xcodeproj`, `.xcworkspace`, `build.gradle`, `AndroidManifest.xml` (excluding node_modules) returned **zero results** — this is a pure Expo-managed-workflow app; iOS/Android native projects would need to be generated (`expo prebuild`) or built via EAS from scratch. No Xcode/Android Studio project exists today.

**Verified routes**: `(auth)/` (welcome, register, login, verify-email, forgot/reset-password), `(onboarding)/` (paywall, restore, enable-biometrics, add-first-property, first-upload), `(app)/` (dashboard, search, settings, properties index/add/[id]/checklist/upload/processing/review/match).

All screens are single-owner-per-user: property CRUD, document upload, OCR-extraction review, payment-to-bill matching, monthly document checklist. **No screen anywhere implements or references** lease creation, tenant records, rent collection/reminders, landlord-vs-tenant roles, or a tenant-facing portal — confirmed by the route list and by `src/features/` (`auth`, `biometrics`, `subscriptions`, `properties`, `documentIntelligence` — no `leases`, `tenants`, or `rent` feature folder) and `packages/types` (`property.ts`, `document.ts`, `subscription.ts`, `admin.ts`, `enums.ts` — no `lease.ts`/`tenant.ts`).

Design-system components (`PropertyCard`, `Card`, `Chip`, `PrimaryButton`, `FormTextField`, `StatCard`, `SkeletonState`, `EmptyState`, `ErrorState`, `ConfirmationSheet`, `BiometricLockScreen`, `PaymentStatusBadge`, `ConfidenceBadge`, `UploadProgress`, `AnimatedProgressBar`, etc.) are generic RN primitives — reusable as visual building blocks the same way the admin table/chart components are, though the screens wired around them assume single-owner data shapes and will need new tenant/lease-aware screens built around the same primitives.

---

## 6. Shared packages

**Verified contents** (all `src/index.ts` barrel exports read):

| Package               | Exports                                                                                                                           | Reuse verdict                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/types`      | `enums`, `property`, `document`, `subscription`, `documentIntelligence`, `admin`                                                  | Domain-agnostic pieces (enums pattern, admin/audit shapes) reusable as-is; needs wholesale **extension** — no `Organization`, `Lease`, `Tenant`, `RentLineItem`, `MaintenanceTicket`, `VendorInvoice` types exist. |
| `packages/validation` | `auth`, `property`, `document` (Zod schemas)                                                                                      | Pattern (Zod-first, client+server validated) reusable; schemas are single-owner-property-shaped and need new schemas for org/lease/tenant/rent entities.                                                           |
| `packages/config`     | `branding`, `planLimits`, `subscriptionPolicy`, `entitlements`, `featureFlags`, `matchingThresholds`, `limits`, `env`, `demoMode` | Mechanism (typed config constants, `isDemoMode()`) reusable; content (plan limits, entitlements) is written for an individual-subscriber SaaS and needs re-modeling for per-org seat limits/billing tiers.         |
| `packages/utils`      | `dateMonth`, `currency`, `fileValidation`, `matching`, `analytics`, `errorMonitoring`                                             | Mostly domain-agnostic — **reusable as-is**. `matching.ts`'s bill/payment match-scoring is a genuinely reusable building block for rent-payment reconciliation once a rent/lease domain exists.                    |
| `packages/ui`         | `tokens`, `statusPresentation`                                                                                                    | Purely presentational — reusable as-is.                                                                                                                                                                            |

**Assessment:** the _mechanism_ of every shared package is a good pattern to keep. The _content_ is entirely single-owner-property-domain; multi-tenant SaaS needs net-new modules for organizations, staff/roles, tenants, leases, rent, maintenance, vendor invoices. `packages/utils` and `packages/ui` are the most reusable as-is since they're least coupled to the ownership model.

---

## 7. Marker search (whole repo, excluding node_modules/.git/.next/.turbo/.expo)

**Verified** via search for `TODO|FIXME|HACK|XXX|mock|fake|demo|sample|placeholder|hardcoded|not implemented|coming soon|bypass|skip auth` (case-insensitive) across `**/*.{ts,tsx,md,sql,json}`: **70 files matched.**

Narrowing to higher-signal markers in code files: all benign — comments pointing at `TODO.md` for genuinely-deferred Phase 2/3 work (RevenueCat stub, upload UX, unimplemented admin controls), and one comment explicitly noting match results come from the real `calculateMatchScore` function rather than a hardcoded result.

Narrowing to `bypass|skip auth`: every hit is the **already-known, already-documented demo-mode auth bypass** (`SECURITY.md`, `README.md:71`, `apps/admin/lib/demoMode.ts:11`, `apps/admin/middleware.ts:10`, `TODO.md:5`, `WORKLOG.md:19`) — no _undocumented_ bypass found anywhere.

**No hardcoded secrets found** in this pass (not an independent live re-run of the CI secret-scan pattern — `Likely`, not independently re-verified this session).

**Summary judgment:** all 70 marker hits are either (a) demo-mode infrastructure — deliberately built, visibly badged in the UI, explicitly flagged as release-blocking — i.e. **known and documented, not hidden**, or (b) benign forward-reference comments. Nothing found silently fakes business logic without disclosure; nothing found looks like an accidentally-committed secret.

---

## 8. Command output (this session, Windows via Git Bash, Node per `.nvmrc`/`engines>=20`)

All commands run from repo root, actual output captured (not simulated).

| Command                                                  | Result                                            | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install`                                           | **Pass**                                          | "Lockfile is up to date... Done in 43s." All 8 workspace projects resolved.                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm lint`                                              | **Pass**                                          | `turbo run lint` — 7/7 packages successful, 18.7s.                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm typecheck`                                         | **FAIL (mobile only)**                            | 6/7 packages pass. `mobile#typecheck` fails with 4 errors, all Expo Router typed-route mismatches: `properties/[id]/processing.tsx(47,15)`, `review.tsx(105,11)`, `review.tsx(154,24)`, `upload.tsx(124,7)` — each `TS2322: Type '...' is not assignable to type '"/(auth)/welcome"                                                                                                                                                        | ...'`(a route-string template literal not matching Expo Router's generated typed-route union). **Not documented in`KNOWN_BUGS.md`** — a real, previously-unflagged failure, distinct from the jest-expo issue below. |
| `pnpm test`                                              | **FAIL (mobile only)**                            | `packages/validation` (9), `packages/config` (9), `packages/utils` (19), `admin` (6) all **pass**. `mobile` fails: all 3 suites fail identically at collection with `TypeError: The "path" argument must be of type string. Received null` inside `jest-expo/src/preset/setup.js:223`. **This exactly reproduces the failure `KNOWN_BUGS.md` documents as a known upstream jest-expo/Windows issue — confirmed still current, not fixed.** |
| `pnpm build` (`NEXT_PUBLIC_DEMO_MODE=true`, matching CI) | **Pass (admin only; mobile has no build script)** | Next.js 16.2.11/Turbopack, "Compiled successfully in 17.1s", all routes built. `apps/mobile/package.json` has no `build` script — mobile is never built by `turbo run build`, matching CI (`ci.yml` only runs `pnpm --filter admin build`).                                                                                                                                                                                                |

**Net:** lint clean everywhere; typecheck and test both fail specifically and only in `apps/mobile`, for two distinct, real, reproducible reasons. Admin build succeeds; mobile has no configured build step to even attempt (native build tooling doesn't exist yet — consistent with §5's finding of no `ios/`/`android/` projects).

---

## 9. Accounting / financial integrity

**Verified.** The entire financial data model is `bills` + `payments` + `payment_matches` — there is **no ledger table, no chart-of-accounts, no double-entry journal, no trial balance concept anywhere** in the schema, `packages/types`, or `packages/utils`. `packages/utils/src/matching.ts` implements `calculateMatchScore` — a heuristic scorer comparing a payment's amount/date/reference against candidate bills, used to _propose_ `payment_matches` rows, never to auto-confirm them (`payment_matches.status` starts `'proposed'`; migration 000010 comment: _"Confirmation is always a customer action... never silently mark paid"_).

This is document-tracking/reconciliation, not accounting: `bills.amount_due`/`amount_paid` are simple numeric fields with a status enum, not ledger entries. No double-entry validation, no running-balance computation, no trial-balance report anywhere.

**Is anything mocked in a way that would be presented as real?** No — every mock/demo financial figure is gated behind `ADMIN_DEMO_MODE`/`DEMO_MODE` and visibly badged ("Demo data"), consistent with §7's finding that all demo infrastructure is disclosed, not silent. The real match-scoring/bill/payment logic is real, working code — just for a much narrower problem than PropertyVault's required trial balances, owner statements, or tax packs (see `PROPVIEW_SCREENSHOT_AUDIT.md` §1/§3 for the reference product's real double-entry Trial Balance and Owner Statement modules).

**Plain statement:** for the new scope (owner statements, trial balance, tax packs, rent-ledger accounting), there is **no reusable accounting engine at all** — it must be built from scratch as a proper ledger/accounting subsystem.

---

## 10. Doc-derived findings (`KNOWN_BUGS.md`, `TODO.md`, `DATABASE.md`, `ARCHITECTURE.md` — read in full)

- **From `DATABASE.md:35`** (doc-sourced): tables _designed but not yet migrated_ — `document_versions`, `reminders`, `notification_preferences`, `notification_deliveries`, `device_push_tokens`, `storage_usage`, `admin_roles`, `admin_notes`, `admin_support_access_requests`, `system_events`, `feature_flags`, `application_config`. None help with multi-tenancy — all Phase 2 single-tenant features, not org/tenant/lease infrastructure.
- **From `TODO.md`**: confirms real DocumentIntelligenceProvider, real upload pipeline, RevenueCat webhook Edge Function, and the admin dashboard's live-Supabase paths are all still pending — even the _existing_ single-owner product isn't backend-complete, independent of the multi-tenant pivot question.
- **From `KNOWN_BUGS.md`**: jest-expo Windows bug confirmed still present and independently reproduced in §8; the doc's suggested unblocking steps (macOS/Linux/WSL, a `jest-expo` release past 56.0.5, or dropping the preset for a manual RN Jest config) remain the only paths forward — not attempted here (read-only scope).
- **From `ARCHITECTURE.md`**: describes `app/api/admin/...`, `app/api/webhooks/revenuecat/`, `app/api/webhooks/ocr/` as part of the admin app structure — **verified these do not exist**. The document describes an intended structure that was never actually built for this part — a naive reading of `ARCHITECTURE.md` alone would overstate what's implemented.

---

## Module reuse assessment

| Module                                                       | Reusable as-is |   Reusable with refactor    | Must rebuild | Reason                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | :------------: | :-------------------------: | :----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo tooling (pnpm/Turborepo/TS/ESLint)                  |       ✅       |                             |              | Product-agnostic infra (§1); only cosmetic rename needed.                                                                                                                                                                                                                                                                                                                        |
| Database schema                                              |                |                             |      ✅      | Every business table's ownership model is `owner_user_id → auth.users`, zero org/tenant/lease/rent concepts exist anywhere in 15 migrations; needs a new org/membership layer and near-total table redesign (§2).                                                                                                                                                                |
| RLS/security model                                           |                |             ✅              |              | The _pattern_ (deny-by-default, owner-scoped policies, service-role-only privileged tables) is sound and worth keeping; every actual policy predicate must be rewritten for org/role/landlord/tenant scoping, and the documented demo-mode auth bypass is still live and unresolved (§3).                                                                                        |
| Admin auth (`apps/admin`)                                    |                |             ✅              |              | Supabase-Auth + middleware + `requireRole()` mechanism reusable; `admin_role` enum already distinguishes a `super_admin` tier suitable as a seed for platform Super Admin, but has zero concept of per-organization roles (§4).                                                                                                                                                  |
| Mobile auth (`apps/mobile`)                                  |       ✅       |                             |              | `AuthProvider.tsx`'s Supabase-Auth wrapper is domain-agnostic and works unchanged for tenant-portal or landlord-mobile auth (§4).                                                                                                                                                                                                                                                |
| Admin frontend (`apps/admin`)                                |                |             ✅              |              | UI/chart/table primitives are generic and reusable; actual pages/data need substantial rebuilding for the multi-tenant domain; no `app/api` routes exist yet (§5).                                                                                                                                                                                                               |
| Mobile frontend (`apps/mobile`)                              |                |             ✅              |              | Design-system components reusable as visual primitives; every screen assumes single-owner-per-user data with zero lease/tenant/rent screens; no native iOS/Android project exists yet — needs new screens plus `expo prebuild`/EAS native setup, or a from-scratch native rebuild per the master prompt's Swift/Kotlin requirement (§5 — see `MOBILE_ARCHITECTURE_DECISION.md`). |
| Shared packages (`types`/`validation`/`utils`/`ui`/`config`) |  (utils, ui)   | (types, validation, config) |              | `utils`/`ui` are domain-agnostic and reusable as-is; `types`/`validation`/`config` follow a good pattern but have zero org/lease/tenant/rent content and need substantial extension (§6).                                                                                                                                                                                        |
| CI/CD                                                        |       ✅       |                             |              | Product-agnostic; only needs a mobile/native build step added eventually (§1/§8).                                                                                                                                                                                                                                                                                                |
| Accounting/financial engine                                  |                |                             |      ✅      | No ledger, no double-entry, no trial balance anywhere — `bills`/`payments`/`payment_matches` doesn't generalize; 100% net-new build (§9).                                                                                                                                                                                                                                        |

### Additional notes

- The mobile typecheck failure found in §8 (4 Expo Router typed-route errors, not in `KNOWN_BUGS.md`) is a small, real, currently-broken build state independent of the pivot — worth fixing or logging before treating `apps/mobile` as a clean baseline.
- No native iOS/Android project exists anywhere in the repository (confirmed by repo-wide search for `.xcodeproj`/`.xcworkspace`/`build.gradle`/`AndroidManifest.xml`, zero hits). See `MOBILE_ARCHITECTURE_DECISION.md` for the resulting native-app strategy.
