# PropertyVault PWA — Version 1 Readiness Report

**Compiled 2026-08-03**, closing out `PWA_V1_COMPLETION_PLAN.md`'s phase of work. Confidence labels follow this repo's own convention: `Verified` (I personally ran the check this session and observed the result), `Derived` (computed/read directly from something Verified), `Likely` (strong basis — code exists, matches an established pattern, or is covered by a passing automated test — but not personally exercised end-to-end in a live browser this session), `Assumption`, `Unknown — [what would settle it]`.

## 1. Plan items closed this phase

All 15 **Pilot**-severity items and all 4 **Blocker**-severity items in `PWA_V1_COMPLETION_PLAN.md` are closed:

| # | Item | Evidence |
|---|---|---|
| 1 | Org-status RLS enforcement | pgTAP, real `docker exec` role-impersonation |
| 2 | Tax Pack demo-mode fix | Real-browser check |
| 3 | Invite-acceptance UI | Built, page exists (`/invitations/accept`) |
| 4 | Password reset | Real Supabase Auth flow (fixed 2 real bugs: CSP `connect-src`, missing PKCE exchange) |
| 5 | Not-found + PermissionDenied | Real-browser check |
| 6 | Search/filter (12 lists) | Real-browser check, vitest |
| 7 | User settings | Typecheck/lint/vitest, real-browser render check |
| 8 | Organization settings | Typecheck/lint/vitest, real-browser render check |
| 9 | Lease templates | New pgTAP suite (9 assertions), typecheck/lint/vitest |
| 10 | Tenant My Documents | SQL-level role-impersonation (`docker exec`) proving a tenant sees exactly the lease-tagged document, not owner-only docs |
| 11 | Tenant Profile | pgTAP (`tenants_isolation.test.sql` flipped assertion) |
| 12 | Support-session enforcement | New adversarial pgTAP suite (11 assertions) |
| 13 | Usage metering UI | Typecheck/lint/vitest |
| 14 | Audit log viewer | Typecheck/lint/vitest |
| 19 | Rate limiting | New pgTAP suite (7 assertions) |
| 23 | RLS isolation test execution | Run continuously — 281/281 passing across 21 files as of the final batch |
| 24 | TD-27(2) correction | Doc update |

Full automated suite as of the last commit (`c66d609`): **281/281 pgTAP assertions**, **155/155 vitest tests**, typecheck and lint clean across every touched package.

Deferred/External items (**#15–18, 20, 22**) are unchanged from the plan's original classification — genuine business decisions, external credentials, or an unmade hosting-platform choice, not something buildable in this environment.

## 2. New finding: no web self-service signup path exists

**`Verified`** (confirmed directly, then independently re-confirmed via a fresh grep pass): there is no way for a brand-new user with no existing Supabase Auth account to register through `apps/admin`.

- `LoginForm.tsx` only calls `supabase.auth.signInWithPassword` — never `signUp`.
- No `/register`, `/signup`, or equivalent page exists anywhere in `apps/admin/app`.
- `packages/validation/src/auth.ts` exports a fully-specified `registerSchema` (email, password, confirmPassword, `acceptedTermsVersion`, `acceptedPrivacyVersion`) with **zero call sites** anywhere in the web app.
- `/onboarding/create-organization` — the page that looks like it might be the entry point — only creates an *organization* for an **already-authenticated** user (`POST /api/v1/organizations` 401s immediately if there's no session); it never creates an `auth.users` row.
- `API_SPEC.md` §1 documents `POST /api/v1/auth/signup` as intended surface, but no such route exists anywhere in `apps/admin/app/api` — this is an unbuilt spec, not evidence of an intentional decision.
- `apps/mobile` **does** have `app/(auth)/register.tsx` — registration exists on mobile only.
- No doc in the repo root (`DECISIONS.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `MOBILE_ARCHITECTURE_DECISION.md`) states this is an intentional mobile-first-signup design. It reads as an unflagged gap, not a documented scope call.

**Why this wasn't caught by the earlier 24-item audit**: that audit was scoped to *client-org-facing feature pages* (settings, templates, tenant portal, etc.) and Super Admin panels — it never asked "can a brand-new customer with zero prior account actually get in the door via the web app at all." Every workflow this phase built (invite-accept, org creation, password reset) implicitly assumes an `auth.users` row already exists.

**Severity, by the plan's own taxonomy**: this meets the definition of **Blocker** ("breaks a mandatory end-to-end workflow") if self-service web signup is in scope for V1 at all. It is **not** blocking if the intended V1 flow is mobile-first signup (register on the app, then use the web dashboard with the same credentials) — a legitimate design that simply was never written down anywhere.

**I have not built anything for this.** It's a real scope/product decision (does V1 need a web signup form? What about terms/privacy acceptance and email verification?), not a mechanical fix, and I did not want to silently ship a new auth surface without confirming that's actually wanted. Flagging it here rather than deciding unilaterally.

## 3. Workflow verification — confidence and evidence

I could not locate the original literal "22 mandatory end-to-end workflows" enumeration anywhere in this repo — it's referenced by `PWA_V1_COMPLETION_PLAN.md` but the itemized list itself isn't persisted in any file, only in an earlier conversation's original instructions that aren't available to me now. The list below is my own reconstruction from the codebase's documented module scope (`TASKS.md` milestones M4–M19, `PERMISSIONS.md` §3–4), not a recovery of the literal original wording.

| # | Workflow | Confidence | Evidence |
|---|---|---|---|
| 1 | Sign up (web) | **Blocked** | See §2 — no code path exists |
| 2 | Sign in (web) | `Likely` | `LoginForm.tsx` calls real `supabase.auth.signInWithPassword`; a live non-demo click-through was attempted this session but blocked by the app's own `upgrade-insecure-requests` CSP header (correct for production HTTPS, breaks browser-driven testing against a plain-HTTP local server — see §4) |
| 3 | Create organization | `Likely` | `create_organization()` RPC exists and is atomic (org + principal membership in one transaction); RLS around it pgTAP-covered; not live-clicked this session (same HTTPS constraint) |
| 4 | Invite staff → accept → active membership | `Likely` | Both API routes reviewed directly this session; `organization_members`/invite RLS pgTAP-covered; UI page exists (built in an earlier session per commit `1b39f4e`, not personally re-verified live by me this session) |
| 5 | Forgot / reset password | `Likely` | Built and disclosed as verified-against-real-Supabase-Auth in an earlier session (commit `b51079a`'s own message describes fixing 2 real bugs found via that verification) — I did not re-run this live myself in this conversation |
| 6 | Add property / unit | `Likely` | pgTAP (`multi_tenant_isolation`, `rls_isolation`), vitest table tests; demo-mode rendering `Verified` this session |
| 7 | Add owner, link to property | `Likely` | pgTAP coverage exists; not live-clicked this session |
| 8 | Add tenant | `Likely` | pgTAP (`tenants_isolation.test.sql`), vitest |
| 9 | Application → decision → lease created | `Likely` | pgTAP (`leasing_isolation.test.sql`), vitest (`ApplicationActions.test.tsx`) |
| 10 | Create lease manually (+ template picker) | `Likely` | Template picker code reviewed and typechecked this session; underlying lease-create flow pgTAP-covered; live click-through not run |
| 11 | Rent schedule → invoice → bank match | `Likely` | pgTAP (`recurring_rent_schedules`, `trust_deposit_release_and_interest`), vitest (`RentScheduleTable`, `BankTransactionsTable`) |
| 12 | Record expense | `Likely` | vitest (`ExpensesTable`), pgTAP org-scoping coverage |
| 13 | Upload document (+ tag to lease) | `Verified` (the tenant-visibility half) | SQL-level role-impersonation this session proved a tenant sees exactly the lease-tagged storage object, not an owner-only one, and an outsider sees zero |
| 14 | Maintenance ticket lifecycle | `Likely` | pgTAP (`maintenance_inspections_isolation`), vitest (`MaintenanceBoard`, `InspectionActions`) |
| 15 | Inspection scheduling | `Likely` | Same suite as above |
| 16 | Notifications (receive/read/preferences) | `Likely` | pgTAP (`notifications_isolation`), vitest (`NotificationsList`, `NotificationPreferencesForm`) |
| 17 | Announcements | `Likely` | pgTAP coverage in `multi_tenant_isolation`/`notifications_isolation`, vitest (`AnnouncementsTable`) |
| 18 | Tenant portal (lease/payments/maintenance/documents/profile) | `Verified` (My Documents, Profile — built this session) / `Likely` (My Lease, My Payments, My Maintenance — built earlier) | Demo-mode render `Verified`; RLS `Verified` via pgTAP + direct SQL |
| 19 | Owner statements | `Likely` | pgTAP (`owner_statements.test.sql`), vitest |
| 20 | Super Admin: suspend/restore, archive | `Verified` | pgTAP adversarially tests the exact access-change (this session's #1 blocker work) |
| 21 | Cross-org data isolation | `Verified` | The single most heavily pgTAP-tested property in the whole suite — every isolation test file asserts it independently |
| 22 | Super Admin: support session + usage/audit panels | `Verified` (RLS/access logic) / `Likely` (UI click-through) | 11 adversarial pgTAP assertions this session; a live browser click-through was attempted but blocked by the same HTTPS constraint as #2/#3 |

## 4. Testing-environment limitation discovered this session

`Verified`: `proxy.ts`'s CSP includes `upgrade-insecure-requests` unconditionally (not gated to production), and `next.config.ts` sets `Strict-Transport-Security` unconditionally too. Both are **correct for a real HTTPS deployment** and I did not change them. Their side effect: any client-side fetch a page makes after initial load (Next.js's RSC-payload fetches on `router.push`/`router.replace`, used by every post-login/post-action redirect in this app) gets upgraded to `https://` by the browser, which fails against a plain-`http://` local test server (`next start -p <port>` without TLS) with `ERR_SSL_PROTOCOL_ERROR`.

This blocked live non-demo-mode browser click-throughs for login and the support-session flow this session. It does **not** affect:
- Demo-mode browser testing (no real Supabase network call is made, so nothing gets upgraded) — used extensively and successfully throughout this phase.
- pgTAP testing (pure SQL, no browser/CSP involved at all) — the primary verification method for every security-relevant change this phase.
- A real production deployment (served over real HTTPS, where the upgrade is a no-op).

**Not a product defect** — flagging it because it's a real gap in *this environment's* ability to do full live browser QA of non-demo-mode auth flows, and a future session hitting the same wall should know why rather than re-diagnosing it. Fixable for local testing (a self-signed local HTTPS cert, or a temporary dev-only CSP relaxation) if that testing capability is wanted going forward — not done here since it would mean touching the security header itself.

## 5. Recommendation

1. **Decide on web signup** (§2): build a `/register` page + `POST /api/v1/auth/signup` (spec already exists in `API_SPEC.md` §1, schema already exists in `packages/validation`), or explicitly document "mobile-first signup, web is existing-account-only by design" so this isn't rediscovered as a surprise later. I'd suggest asking before either — it's a product-shape question, not an engineering one.
2. Everything else in `PWA_V1_COMPLETION_PLAN.md`'s Pilot/Blocker scope is closed and verified to the standard described above. Deferred/External items are correctly parked, not silently dropped.
