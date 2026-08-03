# Worklog

## 2026-08-03 — Web account creation + tenant activation-code system

`PWA_V1_READINESS_REPORT.md` (this session's own earlier finding, same day) surfaced that no web
signup flow existed anywhere in `apps/admin` — every module so far assumed an org/account already
existed. Mohammed's instruction specified two product decisions explicitly rather than leaving them
inferable (full text: `DECISIONS.md`, this date): web registration is in scope for V1
(email/password + Google + Apple), and tenants must link to landlord-captured records via secure
invitations/activation codes rather than re-entering their own data.

**Audited first**: read the existing `organization_invites` flow, `has_org_role()`, and
`resolvePortalSession()` before designing anything new, to avoid duplicating working architecture.
Confirmed `organization_invites` and the new tenant-invitation requirement have different enough
lifecycle/security needs (short code + email/phone cross-check, failed-attempt lockout, masked
destinations) to warrant a dedicated table rather than a shared, ambiguous one.

**Built**: `tenant_invitations` schema + RLS + `create_tenant_invitation()`/
`accept_tenant_invitation()` (migration `20260101000059`); web registration (`/register` +
`RegisterForm.tsx`) with email verification; Google/Apple OAuth buttons + `/auth/callback`
(code and token_hash exchange, provider-error redirect); `LinkedAccountsPanel` (identity
linking/unlinking via Supabase's native `linkIdentity`/`unlinkIdentity`); tenant activation UI
(`/activate` — sign-in/create-account, secure-link auto-confirm, manual code+email entry, clear
success/error states, never renders lease/property data pre-activation); staff-facing
`TenantInvitationPanel` (generate/resend/revoke, one-time plaintext token/code display, masked
destination, status/expiry); `/forgot-password`→`/reset-password` already existed from the prior
entry this session, `next=` continuation now threads through `/register`/`/login` so an invited
user who registers instead of signing in still lands back on their invitation.

**Real bug found by testing, not review**: `accept_tenant_invitation()` originally raised an
exception for every recoverable failure (wrong code, expired, etc.); pgTAP proved this silently
rolled back the `failed_attempt_count` increment made earlier in the same function call — PL/pgSQL
rolls back all writes in an invocation the instant it raises, not just the failing statement.
Redesigned to return a result row instead of raising for every expected failure. Full account:
`DECISIONS.md` 2026-08-03.

**Verified**: full pgTAP (26 new assertions in `tenant_invitations.test.sql`, covering cross-org
attack rejection, replay prevention, lockout, expired/revoked/archived/suspended-org handling,
email-mismatch, already-linked conflicts); new vitest suites for `OAuthButtons`, `RegisterForm`,
`TenantInvitationPanel`, `ActivateClient`, `LinkedAccountsPanel` (19 tests, all passing); admin
typecheck/lint clean; real production build (`/register`, `/activate`, `/terms`, `/privacy`,
`/auth/callback`, all three new API routes registered); real-browser check (Chrome via
puppeteer-core, demo mode) across all 8 new/touched pages — zero console errors beyond the
pre-existing benign favicon 404 on `/login`. Google/Apple OAuth could not be verified live (no real
provider credentials exist yet — `TECHNICAL_DEBT_REGISTER.md` TD-29); email/password registration
and tenant activation *were* verified against real local Supabase, matching this session's earlier
password-reset entry's standard of a genuine end-to-end round trip, not just route-status checks.

No Android/iOS files touched, no production deploy, no Microsoft OAuth built (documented as a later
enhancement only, `AUTHENTICATION.md` §7).

## 2026-08-03 — PWA V1 completion phase begins: repository audit + first 3 blockers closed

Mohammed approved the reviewed UI direction and asked to finish the complete PWA and its
supporting backend to V1 pilot readiness. Wrote PWA_V1_COMPLETION_PLAN.md first -- a fresh
repository-based audit (not trusting old percentages), evidence for every finding, classified by
severity. Two TECHNICAL_DEBT_REGISTER.md claims turned out stale (Owner Statements/Tax Pack/Bank
Transactions already have UI, built earlier this session).

**Blocker 1 — organizations.status was never enforced by any RLS policy** (TD-17/R-22, flagged
since 2026-07-31 as an open product decision). Closed it: `has_org_role()` now denies all access
for archived orgs, forces read-only for suspended/cancelled, leaves trial/active/overdue
unaffected -- inferred from SUPER_ADMIN.md's own language and universal SaaS convention, not
guessed at. Found and fixed a real pgTAP-surfaced bug while verifying: the RLS UPDATE policy on
`organizations` itself now depends on the same status check, so a *test* that mutated status while
running as the `authenticated` role hit a real (and correct) circular-lockout -- once archived, no
RLS-gated UPDATE can change status again. Confirmed this doesn't affect the real product (Super
Admin's suspend/activate/archive routes all use the service-role client, RLS-exempt) and fixed the
test to change status the same way the real system does. Full pgTAP now passes 254/254 (up from
253, extended not just fixed).

**Blocker 2 — Tax Pack showed "Sign in required" in demo mode.** TaxPackClient always called the
real API with no demo branch; lib/demoMode.ts is server-only and can't be imported into a client
component, so the parent Server Component now passes a `demoMode` prop down, matching the
established pattern. CSV export (a live-only route) is visually disabled rather than left as a
dead link in demo mode.

**Blocker 3 — invite acceptance had no UI.** `POST /api/v1/organizations/invites/accept` existed
and was already pgTAP-tested at the RPC level; nothing ever called it. Built `/invitations/accept`
(public route, branches on token-present/signed-in/not-signed-in) + AcceptInviteClient. Also wired
the "Team — Invite a team member" email (EMAIL.md §1's own approved catalogue entry, evidenced
against PROPVIEW_SCREENSHOT_AUDIT.md) into the invite-creation route -- previously nothing sent the
invitee anything, so they'd have no way to discover the token at all. Added a host-agnostic
`getAppUrl()` helper for the link (no hosting platform chosen yet, same root gap as TD-20).

**Blocker 4 — no password-reset flow existed anywhere.** Built `/forgot-password`
(`resetPasswordForEmail`) and `/reset-password` (`updateUser`), plus a "Forgot password?" link on
`/login`. Real end-to-end verification against local Supabase (not demo mode, not route-status-only)
found and fixed two genuine bugs neither typecheck nor lint could have caught:
1. **CSP blocked every client-side Supabase call against local Supabase.** `connect-src` only ever
   allowed `'self'` and `https://*.supabase.co` -- confirmed live via a real Chrome CSP violation.
   Never caught before because every prior real-browser pass this session ran in demo mode, which
   never makes a real Supabase call. Fixed by deriving the allowed origin from
   `NEXT_PUBLIC_SUPABASE_URL` when it's a local address, rather than gating on `NODE_ENV` (a
   production build pointed at local Supabase -- the exact scenario that surfaced this -- still has
   `NODE_ENV=production`, so that gate alone wouldn't have fixed it).
2. **The reset-password page never actually established a session from a real link.** Supabase's
   recovery email now uses the PKCE flow (`?code=` in the query string), which
   `@supabase/ssr`'s `detectSessionInUrl` does NOT auto-exchange the way it auto-detects a
   hash-fragment token. Fixed with an explicit `exchangeCodeForSession()` call.
   Full loop proven for real: submitted a real email → real "Reset your password" message
   arrived in local Supabase's Mailpit inbox → followed the actual link in the same browser
   session → PKCE exchange succeeded → new-password form → "Your password has been updated" →
   signed in with the new password successfully. (An earlier attempt using a fresh browser context
   per step correctly failed — that's PKCE's code-verifier binding working as designed, not a bug;
   redone in one continuous session to match how a real user actually clicks their own email link.)

No Android/mobile files touched. Verified per batch: typecheck/lint clean, full vitest (155/155
after blocker 3), real `supabase db reset` + full pgTAP (254/254), real-browser check in both demo
and live mode, and blocker 4's full real-email round trip against local Supabase.

## 2026-08-03 — Login and organization onboarding

The first thing anyone sees before the shell even exists. Both LoginForm and
CreateOrganizationForm had the same flat rounded-xl card with no shadow and raw unstyled inputs/
button. Upgraded both to rounded-card + shadow-lift, added a brand icon badge (Building2 in an
accent-coloured, glow-shadowed square, matching the sidebar logo mark), restyled inputs with the
same focus-ring treatment used everywhere else, and swapped the raw <button> for the shared Button
component. react-hook-form/zod validation and submit handlers untouched.

No backend/API/schema changes. Verified: typecheck/lint clean, full vitest 153/153, real next
build clean, real-browser check on /login light+dark -- zero console errors beyond the pre-existing
favicon 404. (CreateOrganizationForm only reachable post-signup in live mode -- visually inspected
via code review of the now-identical markup pattern, not a separate live screenshot.)

## 2026-08-03 — Applications (V1) and Tenant Portal

Applications list and detail pages, and the whole Tenant Portal (My Lease, My Payments, My
Maintenance + its submit form, Notices) moved onto PageHeader/Panel and the rounded-card table
chrome. Confirmed the tenant portal's own AppShell layout (a separate, deliberately un-merged
identity system from org staff -- PERMISSIONS.md's "never merge role systems") already passes
through demoBadge and renders the shared header correctly with no identityLine (falls back to a
generic "User" avatar). No changes to the simplified V1 application-review workflow itself or to
tenant-portal authorization -- purely presentational.

No backend/API/schema changes. Verified: typecheck/lint clean, full vitest 153/153 (including
TenantMaintenanceTicketForm.test.tsx unmodified and still green), real next build clean,
real-browser check across all 7 pages light + My Lease dark -- zero console errors beyond the
pre-existing favicon 404.

## 2026-08-03 — Reports, Notifications, and Announcements

Reports' local ReportCard component (flat rounded-lg border) replaced outright with Panel -- same
title-header/body shape, one less duplicated card implementation, four report tiles now match the
rest of the app's card language. Notifications, Notifications preferences, and Announcements all
moved onto PageHeader (Preferences link now lives in PageHeader's actions slot instead of floating
next to a bare h1).

No backend/API/schema changes. Verified: typecheck/lint clean, full vitest 153/153, real next build
clean, real-browser check across all 4 pages light + Reports dark -- zero console errors beyond the
pre-existing favicon 404.

## 2026-08-03 — Accounting section (Bank Accounts/Transactions/Expenses/Rent Due/Owner Statements/Tax Pack/Trial Balance)

The whole Finance nav group had never been through the redesign -- all 7 pages still had the
original bare `<h1>`+`<p>` header. Brought every one onto PageHeader, matching the rest of the app.
Trial Balance's raw `<table>` (a hand-built aggregation view, not AdminDataTable-based) got its
header row upgraded to `bg-*-surfaceStrong` and wrapped in a Panel for the same card chrome as
everywhere else; its balanced/unbalanced banner moved from a bespoke coloured div into the header's
actions slot as a Pill.

Real-browser check surfaced a pre-existing, unrelated gap: TaxPackClient (a client component this
pass didn't touch) fetches `/api/v1/tax-pack` directly with no demo-mode branch, so in demo mode it
correctly shows "Sign in required" rather than crashing -- not a regression from this batch, just an
observed limitation worth flagging. Not fixed here: fixing a client-side data-fetching gap is
backend/business-logic work, out of scope for a presentation-layer pass per this session's own
constraint against touching working functionality without a proven defect blocking the UI itself
(it doesn't -- the page renders its error state correctly).

No backend/API/schema changes otherwise. Verified: typecheck/lint clean, full vitest 153/153, real
next build clean, real-browser check across all 7 pages light + Trial Balance dark -- zero console
errors beyond the pre-existing favicon 404 and the pre-existing Tax Pack demo-mode 401 just described.

## 2026-08-03 — Maintenance board card language; Documents/Inspections checked, already current

MaintenanceBoard was the one remaining flat `rounded-lg border` surface in the Operations section --
upgraded its column wrapper and empty state to the same `rounded-card`/`shadow-card`/
`bg-light-surfaceStrong` header language every other card in the app already carries, plus a pill-
style count badge and softer ticket-card hover state. Checked DocumentsTable/InspectionsTable and
the Documents detail/OCR pages first -- all already use StatusBadge + the card language from the
Documents/OCR review batch earlier this session, nothing further needed there.

No backend/API/schema changes. Verified: typecheck/lint clean, full vitest 153/153, real next build
clean, real-browser check on /maintenance light+dark -- zero console errors beyond the pre-existing
favicon 404.

## 2026-08-03 — Owners/Tenant-detail Lovable polish (continuing past the approved checkpoint)

Checkpoint approved -- continuing module order. OwnersTable gained the same avatar-initial chip
TenantsTable got in the checkpoint, plus its local two-value OwnerStatusBadge replaced with the
shared Pill component (one less duplicated badge implementation). Tenant detail's bare title/status
stack replaced with a proper profile header (large Avatar, name, status, email/phone with icons),
adapted from the reference's tenant profile panel -- LeasesTable was checked and left alone, it
already uses StatusBadge/LEASE_STATUS_PRESENTATION correctly, no Lovable-style Pill needed there.

No backend/API/schema changes. Verified: typecheck/lint clean, full vitest 153/153 (OwnersTable.
test.tsx and TenantsTable.test.tsx both still green against the restyled markup), real next build
clean, real-browser check on /owners and /tenants/[id] light+dark -- zero console errors beyond the
pre-existing favicon 404.

## 2026-08-03 — Lovable UI donor integration: checkpoint batch (branch propertyvault/lovable-ui-integration)

Strategy change mid-redesign: instead of hand-building analogues of reference/lovable-ui-reference's
patterns page by page, Mohammed asked for a controlled integration -- treat the Lovable project as a
UI donor and adapt its strongest implementation directly, on a dedicated branch, strangler-style
(new UI connected to real data and verified before anything old is removed).

Full audit written to UI_INTEGRATION_PLAN.md first: framework/routing/styling/component-library/
licence findings, then a component-by-component mapping table. Key findings: TanStack Start+Vite
vs this repo's Next.js App Router means the framework itself isn't portable, only JSX/Tailwind
markup; already has lucide-react and recharts installed so no new icon/chart dependency; no LICENSE
file in the reference project but its own README embeds the original design brief Mohammed gave
Lovable to generate "PropertyVault" specifically for this project, so copyright risk on adapting the
code is low; added only @radix-ui/react-dropdown-menu and @radix-ui/react-popover (MIT, small) for
the shell's user menu/notifications rather than the reference's full 46-primitive shadcn set.

Checkpoint batch (7 items, per Mohammed's mandatory-checkpoint list): design tokens (already mostly
converted in the prior pass, gaps checked, none found), a real desktop header for AppShell
(breadcrumbs, notifications popover wired to real `notifications` rows, user menu with a real
Supabase sign-out -- none of this existed before, the shell had no header row at all on desktop),
Owner Dashboard (swapped "Vacant units" for a real "Expiring leases" count computed from
`leases.end_date`), Properties (new card-grid default view with grid/list toggle, real per-property
income/outstanding/occupancy aggregated from units+leases+rent_schedules, no property photo storage
exists so cards show a placeholder icon rather than fabricating or hotlinking a stock photo),
Property detail (new hero header: placeholder image band, status pill, stat strip), Units (status-
tab filter with real counts + client-side search over the already-fetched real rows), Tenants
(avatar-initial chips added to the existing table).

Two things the reference project does that were deliberately NOT copied: `portfolioValue`/property
valuations and a "Vault Intelligence" fabricated-AI-insight banner with an invented rand figure --
no PropertyVault field backs either, and Mohammed's own instruction explicitly bans inventing
portfolio values or analytics the app can't calculate. Also not copied: the Tenants page's
client-side master-detail single-pane pattern (would have broken deep-linking to `/tenants/[id]`,
a real server-rendered route) and the Property detail page's full tab-per-module layout (Documents/
Accounting/Maintenance are real separate modules with their own permissions, not visual-only tabs).
Both are documented as deliberate adaptation decisions in UI_INTEGRATION_PLAN.md, not omissions.

No backend/API/schema changes. Verified: typecheck/lint clean across the whole batch, full vitest
153/153, real next build clean. Real-browser check (puppeteer + system Chrome, demo mode) across
dashboard/properties/property-detail/units/tenants at 1440 light+dark, 768, and 390 -- zero console
errors beyond the pre-existing favicon 404. Screenshots confirm the new header (breadcrumbs, bell,
avatar user menu), property cards, hero header, and status-tab units table all render correctly in
both themes with no double borders or layout breaks.

## 2026-08-03 — Documents and OCR review redesign

Module 8 of the redesign order. /documents/[id]'s bare metadata dl moved into a Panel, matching
every other detail page. The real work was OcrPanel itself: it was still a flat rounded-lg border
div, the one leftover flat card in the whole document flow. Rebuilt as a Panel -- title/description
in the header, and once a document's been reviewed, a dot+label "Reviewed {date}" badge sits in the
header's actions slot instead of a plain green sentence below the content, matching StatusBadge's
established dot+text convention (never colour alone).

Each extracted field's OCR confidence score changed from parenthetical grey text to a small neutral
pill next to the value. Deliberately did NOT colour-code by confidence (red/amber/green) -- checked
DOCUMENT_INTELLIGENCE.md for a documented threshold first and found none, so inventing one would
have been exactly the kind of unsupported-metric fabrication the redesign instructions warn against.
DocumentUploadForm got the same PageHeader+Panel treatment as the other 5 forms, including its
"no properties yet" empty-state branch.

No extraction/review API changes -- OcrPanel.test.tsx's existing 5 cases were left untouched and
still pass against the restyled markup, confirming the human-confirms-first OCR workflow itself
(DOCUMENT_INTELLIGENCE.md) is unaffected. Verified: typecheck/lint clean on all 3 files, full
vitest 153/153, real next build clean. Real-browser check (puppeteer + system Chrome, demo mode)
on the document detail page light+dark and the upload form light -- zero console errors beyond the
pre-existing favicon 404.

## 2026-08-03 — Properties/Units/Owners/Tenants/Leases create/edit form consistency pass

Finished the Properties/Units/Owners/Tenants/Leases module group: NewPropertyForm, UnitForm,
OwnerForm, TenantForm, and LeaseForm all shared the identical bare <h1> + max-w-xl <form> floating
on the page background. Wrapped each in PageHeader (title) + Panel className="max-w-xl" (form
body) -- the same two primitives from the foundation batch, no new components needed. Left field/
input styling (the shared inputClass string, Field wrapper) and all validation/submit logic
untouched -- a shared Input/FormField primitive to de-duplicate that string across 14 form files
would be a legitimate follow-up but is out of scope for a presentation-only batch.

No backend/API/schema changes. Verified: typecheck/lint clean on all 5 files, full vitest 153/153,
real next build clean. Real-browser check (puppeteer + system Chrome, demo mode) across
/properties/new, unit-new, owner-new, tenant-new light plus /properties/new dark -- zero console
errors beyond the pre-existing favicon 404. Screenshot-confirmed: form now sits inside a visible
elevated card in both themes.

With this, list/detail/create/edit are all on the new card language for these five modules.
Continuing to Documents and OCR review next per the module order.

## 2026-08-03 — Properties/Units/Owners/Tenants/Leases detail-page consistency pass

Continued straight on from the list-page batch into the matching detail pages: /properties/[id],
/properties/[id]/units/[unitId], /owners/[id], /tenants/[id], /leases/[id]. Each page's bare
<h1> + floating dl replaced with PageHeader (title, status pill or edit action) + Panel wrapping
the key-facts dl, giving the record's top-line facts the same card language the list pages just
got. Nested-table sections (a property's Units/Maintenance, a unit's Leases/Applications/
Inspections) were deliberately left as lightweight header rows rather than wrapped in Panel --
same double-border reasoning as AdminDataTable's own upgrade in the previous batch.

No backend/API/schema changes. Verified: typecheck/lint clean on all 5 files, full vitest 153/153,
real next build clean. Real-browser check (puppeteer + system Chrome, demo mode) across all 5
pages at 1440px light plus Properties dark -- zero console errors beyond the pre-existing favicon
404. Screenshots confirm the Panel-wrapped details block and nested tables render correctly
side by side with no double borders.

## 2026-08-03 — Properties/Units/Owners/Tenants/Leases/Maintenance/Inspections/Documents list-page consistency pass

Continued the module redesign order (UI_REDESIGN_PLAN.md) into the eight core list pages. Every
page's ad hoc <h1>+<p>+button header block replaced with the shared PageHeader component built in
the previous batch. Tried wrapping each table in the also-new Panel component first, starting with
Properties -- reverted immediately after noticing AdminDataTable already renders its own
rounded-lg border wrapper for every one of its 18 callers, which would have produced a visible
double border. Fixed at the source instead: AdminDataTable's own empty-state and populated-state
wrappers upgraded directly to rounded-card/shadow-card/bg-light-surfaceRaised with a
bg-light-surfaceStrong header row, so all 18 table components across the app inherit the new card
language for free, no per-page wrapper needed.

No backend/API/schema changes -- pure presentation layer. Verified: apps/admin typecheck and
targeted lint clean on all 10 changed files, full vitest suite 153/153, real next build clean.
Real-browser check (puppeteer-core + system Chrome, demo mode) across all 8 pages at 1440px plus
768/390/dark spot checks. First pass showed a suspicious console error on /properties; isolated it
with a single clean navigation and confirmed it's the pre-existing missing-favicon 404, not a
regression. All net::ERR_ABORTED entries cross-referenced against the sidebar's own Link-prefetch
targets -- confirmed noise, not real failures. One test-script artifact caught before being
misreported as a bug: headless Chrome's default prefers-color-scheme reads dark, so an unset
"light" run in the batch script rendered identically to the explicit dark run -- re-verified with
an explicit light-scheme navigation, which renders correctly.

## 2026-08-03 — Design foundation v2 + Owner Dashboard redesign (UI redesign resumed)

With all 8 functional-completion priorities closed and the audit concluding remaining work is
primarily UI/UX/deployment, resumed the paused PWA redesign. Mohammed supplied a new reference,
reference/lovable-ui-reference/propertyvault-essence-main -- a TanStack Start + Tailwind v4 +
shadcn/Radix project purpose-built as PropertyVault's visual direction. Audited it (styles.css's
OKLCH design tokens, app-shell.tsx, kit.tsx's small reusable primitives, routes/index.tsx's
dashboard composition) alongside reference/propview-screenshots and the current Owner PWA.

Not literally portable (different router/build tool) -- adapted as values and patterns. Converted
its OKLCH palette to precise hex via the real CSS Color 4 conversion matrices (not eyeballed) so
Tailwind v3's opacity modifiers keep working. Replaced packages/ui/src/tokens.ts's colorLight/
colorDark VALUES only, keeping every existing KEY NAME -- a blue accent (#106ADD/#4A91F8) instead
of the old verdigris, soft near-white/near-black-blue surfaces, a 5-colour chart palette, new
shadow and expanded radii tokens. Every pre-existing `text-light-textPrimary`-style class across
the whole app kept working with zero edits, matching the "presentation-layer transformation, not a
rebuild" instruction. Added Plus Jakarta Sans + Inter via self-hosted next/font (never an external
CDN request -- the exact class of issue that broke hydration under CSP earlier this session).

Built PageHeader/Panel shared components (adapted from kit.tsx's PageHeader/Panel), extended
AdminMetricCard with optional icon/href props, and rebuilt the Owner Dashboard on top: a real
recharts area chart (rent collected vs expenses, 6 months, real data only), a point-in-time
occupancy donut (no fabricated trend -- no historical snapshot table exists to compute one
honestly), a real audit_events-backed activity feed, and an icon-tile quick-actions grid. recharts
added as a new dependency -- justified by the explicit "strong data visualization" requirement; no
existing lightweight chart component supported gradients/tooltips/responsive containers.

Real-browser verification (puppeteer + system Chrome) across 1440/1280/1024/768/390 light + 1440
dark caught one real bug before it shipped: the chart's Y-axis labels were clipped by a margin
value copied from the reference without adjusting for this chart's own tick width -- fixed,
re-verified. A separate false alarm (500 + wrong-MIME-type JS chunk) turned out to be a stale dev
server left running on the same port from an earlier verification pass, not a real defect --
confirmed by a clean rebuild on a fresh port.

apps/admin typecheck/lint/vitest (153/153) clean, real next build clean. No backend/schema changes.

## 2026-08-02 (continued) — WhatsApp notification dispatch wiring (TD-23 fully closed, item 8/8 — all 8 functional-completion priorities now done)

dispatchWhatsApp() (apps/admin/lib/whatsappDispatch.ts) mirrors dispatchEmail()'s exact shape:
idempotent, preference-gated (notification_preferences.whatsapp_enabled), audit-logged. WHATSAPP.md
§2 is explicit that no code path may free-text through the platform's single shared WhatsApp
number outside this one dispatcher, and that the trigger list is closed -- deliberately wired only
3 of the 16 WhatsAppNotificationType values (payment_accepted, owner_statement_available,
maintenance_update_critical), each backed by a real synchronous trigger already in the codebase.
The other 13 (rent overdue, lease expiring, ...) all need a scheduled-detection job this codebase
doesn't have -- same missing cron infrastructure as TD-20, correctly left unwired rather than
inventing an ad-hoc "check on every request" trigger. maintenance_update_critical only fires when
a ticket's priority is 'urgent' -- routine updates stay email-only, matching "don't overuse
WhatsApp." Outbound sends use tenants.phone/owners.phone directly, not verified_phone_numbers
(that table is for inbound identity resolution only, per WHATSAPP.md §1.1 -- unverified numbers
are explicitly valid for outbound).

New whatsappDispatch.test.ts (6 real integration tests against local Supabase, all passed on the
first run this time -- the uuid-column lesson from the email pass was applied up front). Full
monorepo typecheck (6/6 non-mobile packages), apps/admin lint/vitest (151/151), real next build,
and 252/252 pgTAP (unaffected) all clean.

This closes the eighth and final item of Mohammed's ordered functional-completion list. A new
repository-based audit follows next, per his own closing instruction, before any return to the
paused UI redesign.

## 2026-08-02 (continued) — Email notification dispatch wiring (TD-23 email half, item 7/8)

The email provider/schema layer (M16) existed with nothing calling it. dispatchEmail()
(apps/admin/lib/emailDispatch.ts) is the one place every trigger site now calls into --
idempotent (one email per (related_entity_type, related_entity_id, template_name)), suppression-
checked, and preference-gated for non-transactional categories only (EMAIL.md's own rule:
transactional mail is never user-suppressible). Wired into 5 real, already-existing trigger
points: rent-schedule invoicing, bank-transaction payment confirmation, owner-statement issuance,
maintenance-ticket status changes, and the billing webhook's payment_failed event.

A real bug was caught by the new test suite before it shipped: email_messages.related_entity_id
is a uuid column, and an early draft tried to encode a maintenance ticket's status into it as a
composite string (so repeated distinct status transitions on the same ticket each get counted as
a separate, real event rather than deduped as "already sent") -- failed with "invalid input syntax
for type uuid" against a real ticket id. Fixed by moving that extra context into
related_entity_type instead (a plain text column), keeping related_entity_id a real entity uuid
throughout. The same fix was needed in the billing webhook's subscription_payment_issue dispatch.

New emailDispatch.test.ts (6 real integration tests against local Supabase). Full monorepo
typecheck (6/6 non-mobile packages), apps/admin lint/vitest (145/145), real next build, and
252/252 pgTAP (unaffected, no schema change) all clean.

## 2026-08-02 (continued) — Payment gateway abstraction (item 6/8)

Organization-level SaaS billing was entirely unbuilt -- distinct from the mobile app's already-
decided RevenueCat entitlement flow (SUBSCRIPTIONS.md), this is the org (agency/landlord customer)
paying PropertyVault for its own subscription. Built the abstraction before touching any specific
gateway, per the instruction: BillingGatewayProvider (createCustomer/createSubscription/
getPaymentStatus/cancelSubscription/refundPayment/verifyWebhookSignature/parseWebhookEvent),
MockBillingGatewayProvider as the only implementation, and a billing service
(apps/admin/lib/billing.ts) that only ever talks to the interface.

The real idempotency guard is a DB constraint, not application logic: billing_events has
unique(provider_name, provider_event_id), so a gateway's retried webhook delivery (which every
real gateway does on any non-2xx response) hits 23505 and is treated as already-processed, not
reprocessed. Verified with a real replayed-webhook integration test against local Supabase, not
just asserted.

Kept explicitly mock-only -- no real PayFast/Yoco/Stitch account exists, and none was activated.
Documented in SUBSCRIPTIONS.md that the existing Capitec business bank account can keep receiving
settlements regardless of which gateway is chosen later (settlement destination vs. collection
method are separate decisions).

New API: POST .../billing/checkout, .../billing/cancel, GET .../billing/payments, POST
/api/v1/admin/subscription-payments/:id/refund, POST /api/v1/billing/webhook (unauthenticated,
signature-verified). New Super Admin UI: a Billing panel on the customer detail page.

12 new vitest cases (6 real integration tests against local Supabase) + 7 new pgTAP assertions.
Full regression 252/252 pgTAP across 18 files. Full monorepo typecheck (6/6 non-mobile packages),
apps/admin lint/vitest (139/139), real next build all clean.

## 2026-08-02 (continued) — South African Tax Pack (item 5/8)

`compute_tax_pack()` is a live report, same "computed on demand, never stored" pattern as Trial
Balance -- sums journal_lines for the SA tax year (1 March - end of February), grouped
per-property and per-account. Grouping by account IS grouping by category: record_expense()
already matches an expense's category to a same-named chart_of_accounts row, so there's no
separate category concept to build. No SARS classification beyond account name is invented.

The SA tax-year window is computed as `make_date(tax_year, 3, 1) - 1` for the end date rather than
hardcoding Feb 28, so leap years resolve correctly automatically. Verified with a real
out-of-year entry: since journal_entries is permanently immutable (a post-then-backdate attempt in
the test correctly failed against that trigger, confirming the enforcement itself works), the test
posts the old entry directly via post_journal_entry() at a controlled entry_date instead, then
confirms it's excluded from the current year's pack.

record_tax_pack_export() writes an audit row only when a real export/download happens, not on
every on-screen view -- the CSV download route triggers it as a side effect. CSV chosen over a
server-rendered PDF (no new dependency for V1, same call as Owner Statements' print-to-PDF); the
disclaimer ships as the CSV's first line and as a JSON field the UI renders verbatim.

New tax_pack.test.sql (12 assertions) + TaxPackClient.test.tsx (2 cases). Full regression:
245/245 pgTAP across 17 files. Full monorepo typecheck (6/6 non-mobile), apps/admin lint/vitest
(127/127), real next build, and a real demo-mode smoke test all clean.

## 2026-08-02 (continued) — Owner Statements (item 4/8)

`generate_owner_statements()` batch-drafts one statement per owner per period across their whole
portfolio, splitting each property's rent/expenses by `property_owners.ownership_pct` and applying
ACCOUNTING.md §10's rounding-remainder-to-last-owner rule -- verified with a real two-owner,
60/40-split-property test: the sum of both owners' shares equals the true combined total to the
cent (20001.00), never a cent short or over from independent per-owner rounding. `management_fee`
uses a new `organizations.management_fee_pct`, mirroring the existing `deposit_interest_pct`
pattern rather than inventing a fee schedule ACCOUNTING.md never specified.

`issue_owner_statement()` freezes a draft (ACCOUNTING.md §5's snapshot rule -- verified: 
regenerating the same period after issuing leaves the issued statement's numbers untouched).
`confirm_owner_statement_payout()` posts the owner_payout journal entry only once issued and
matched to a real outgoing bank transaction, the same confirm-only principle as rent-schedule
matching.

Web UI: `/accounting/owner-statements` (list + generate-for-period), `/accounting/owner-statements/:id`
(detail + issue/confirm-payout actions), and a `.../print` view. The "printable/downloadable PDF"
requirement is met via the browser's own print-to-PDF (`window.print()` on a print-styled page) --
deliberately not a new server-side PDF-generation dependency for V1. AppShell's sidebars/top bar
gained `print:hidden` so this works for any (dashboard) page going forward, not just this one.

New `supabase/tests/owner_statements.test.sql` (20 assertions) + `OwnerStatementsTable.test.tsx`
(2 cases). Full regression: 233/233 pgTAP across 16 files. Full monorepo typecheck (6/6 non-mobile
packages), apps/admin lint/vitest (125/125), real `next build` (8 new routes) all clean, plus a
real demo-mode smoke test (next build && next start, all three new pages 200 with real content).

## 2026-08-02 (continued) — Trust deposit release and interest accrual (TD-22, item 3/8)

`release_trust_deposit()` and `accrue_trust_interest()` were the two trust-money operations
deliberately left unbuilt in M14 part 2, pending an account-mapping decision `ACCOUNTING.md` §4
didn't specify. Resolved by adding two clearly-labeled new system accounts (`4900 Deposit
Deduction Income`, `5950 Trust Interest Expense`, backfilled onto every existing org) rather than
leaving the mapping unmapped -- ACCOUNTING.md's computation/gating rules were already unambiguous
(release requires a completed move_out inspection; interest applies the org's own configured
rate), only the GL pairing was open.

`release_trust_deposit()` settles a lease's entire trust-ledger balance in one call, split into a
deduction portion (recognised as landlord income) and a refund portion, gated on
`inspections.inspection_type = 'move_out'` AND `status = 'completed'` specifically, one-time via a
new `trust_ledgers.status` column (no partial/staged release in V1). `accrue_trust_interest()`
posts simple daily-prorated interest at the org's configured rate as an explicit
accountant-triggered action, not an unattended cron job -- no scheduler infrastructure exists yet
(same gap as TD-20), so this ships as manual-trigger-only rather than blocking the computation
itself on missing infrastructure.

A real bug was found and fixed by the new test suite before this shipped: `SELECT ... FOR UPDATE`
against `trust_ledgers` (which has an accountant+-only "for all" write RLS policy) silently
requires satisfying that write policy just to lock the row -- an agent-only caller got a
misleading "No trust ledger exists" instead of the intended "Caller does not have accountant+
rights" message, since RLS filtered the row out before the function's own role check ever ran.
Fixed by removing `FOR UPDATE` from both functions, matching every other posting operation in this
codebase (none of them lock rows this way either).

New `supabase/tests/trust_deposit_release_and_interest.test.sql` (21 assertions) plus one
pre-existing test updated (system-account count 11 -> 13). Full regression: 213/213 pgTAP across
15 files on a real `supabase db reset`. `apps/admin` typecheck/lint/vitest (123/123) clean, real
`next build` (2 new routes: `POST /api/v1/trust-ledgers/:id/release`,
`.../accrue-interest`) registers cleanly. No PWA screen was built for this item -- API/RPC layer
only, per this item's scoped work; Owner Statements/Tax Pack (items 4-5) do require screens and
come next.

## 2026-08-02 (continued) — Native Bearer-JWT authentication (TD-28, item 2/8)

`getServerSupabaseClient()` (`apps/admin/lib/supabase/server.ts`) now accepts
`Authorization: Bearer <supabase-jwt>` in addition to the existing `@supabase/ssr` cookie
session, through one shared abstraction rather than editing every route handler. Checks for a
bearer header first (via `next/headers`); when present, builds a client whose every REST/RPC call
carries that JWT, and overrides `auth.getUser()` to default to it when called with no argument --
this is what lets every existing route's unchanged `await supabase.auth.getUser()` keep working
for both caller types. Falls back to the byte-for-byte original cookie code path otherwise.

Verified against the real local Supabase Auth server, not mocked: created two real test users via
the Auth admin API, signed in for real access tokens, and ran a live `next build && next start`
against the local instance. `POST /api/v1/maintenance-tickets` and `POST /api/v1/device-push-tokens`
both succeeded end to end with a genuine Bearer token and no cookie at all; an invalid token,
missing token, cross-org token, and a role-downgraded (viewer) token all produced the correct
401/403, matching pre-change behaviour for every case that should still be denied. New
`apps/admin/lib/supabase/__tests__/server.test.ts` (9 cases, 4 of them real integration tests
against `supabase start`) makes this repeatable in CI/dev without hand-run curl. One side-check
was inconclusive and is disclosed rather than glossed over: a full browser-driven login through the
React `LoginForm` (to prove zero regression on the *cookie* path specifically, not just the bearer
path) hit a pre-existing Turbopack/HMR dev-artifact in this sandbox (client bundle never hydrates,
same symptom on both `next dev` and a real `next build && next start`) — unrelated to this change
(the cookie branch is verbatim-unchanged code), but not independently re-verified live in a
browser this pass. Full monorepo `apps/admin` `tsc --noEmit`/`eslint --max-warnings=0` clean,
`vitest run` 123/123, real `next build` clean, 192/192 pgTAP unaffected (schema untouched).

## 2026-08-02 (continued) — Functional-completion checkpoint begins: recurring rent-schedule generation (TD-20, item 1/8)

Full repository implementation audit delivered (per-module status, 20 special-attention items,
Android/iOS breakdown, completion percentages) — verdict: continue functional work before the
full UI redesign resumes. Mohammed ordered 8 launch-critical gaps, starting with the highest
priority: recurring `rent_schedules` generation (TD-20), since without it the Rent Due dashboard
silently goes blank after any lease's first month.

Migration `20260101000050`: `generate_rent_schedules_for_lease()`/
`generate_rent_schedules_for_active_leases()`, both `security definer`/`service_role`-only
(matching `resolve_whatsapp_sender()`'s lockdown pattern), plus a real `(lease_id, due_date)`
unique constraint so duplicate prevention is a DB guarantee, not application logic. Anchored every
period's due date to the lease's own `start_date` rather than chaining off the previous row --
Postgres's `date + interval 'N months'` clamps a day that doesn't exist in the target month
(`2026-01-31 + 1 month = 2026-02-28`), and a naive running total would have permanently lost the
31st for every later period on any lease starting on the 29th-31st. No proration invented for
mid-month starts (none is documented; matches `approve_application()`'s existing full-amount
behaviour). Callable via new `POST /api/v1/system/generate-rent-schedules` (super_admin session or
`CRON_JOB_SECRET` bearer) until a real production scheduler is wired against it in M24.

Verified: real `supabase db reset`, new `recurring_rent_schedules.test.sql` (16 assertions covering
first/subsequent months, idempotent retry, lease-ends-mid-horizon, terminated-lease no-op,
partially-paid row preservation, cross-org bulk isolation, privilege lockdown) — full regression
suite 192/192 pgTAP across 14 files. `apps/admin` `tsc --noEmit`/`eslint` on changed files clean.

## 2026-08-02 (continued) — PWA redesign foundation: responsive AppShell, real dark mode, two more real bugs found by the new audit tooling

With the CSP hydration bug fixed, moved to the redesign's own foundation step (shared tokens +
shell/navigation, per Mohammed's specified order). The new real-browser audit script kept paying
for itself immediately.

**Bug 1: dark mode has never activated anywhere.** `tailwind.config.ts` uses `darkMode: 'class'`
-- requires a `.dark` class on an ancestor, which nothing in this codebase has ever set (no
`ThemeProvider`, no toggle, a bare `<html>`/`<body>` in `app/layout.tsx`). Confirmed by screenshot:
a `prefers-color-scheme: dark`-emulated capture of `/overview`, taken *before* this fix, was
pixel-identical to light mode. Every `dark:` utility class written across every module this session
was correct and completely unreachable. Fixed with `next-themes` (`attribute="class"`, matching the
existing Tailwind strategy exactly -- zero of the already-written `dark:` classes needed touching),
wired through `app/layout.tsx` with the CSP nonce (from `proxy.ts`'s `x-nonce` header) passed to
`ThemeProvider` so its own small no-FOUC inline script isn't blocked by the very CSP that broke
hydration in the first place. Added `components/ui/ThemeToggle.tsx` -- a real System/Light/Dark
three-way control, `DESIGN_SYSTEM.md` line 220 already specified one, it just never had an
implementation.

**Bug 2: the sidebar has never actually been responsive**, confirmed by an early screenshot this
same pass at 390px width -- the full desktop sidebar just sat there unchanged, squeezing every KPI
card into unreadable ~1-word-wide columns with heavy text wrapping. `DESIGN_SYSTEM.md`'s own
"Responsive rules" already fully specified the fix (persistent+expanded >=lg, icon-only >=md,
overlay drawer <md) -- it had just never been built. Built `components/shell/AppShell.tsx`, one
shared shell for all three route groups ((dashboard)/(super-admin)/(tenant)) rather than three
independently drifting sidebar copies -- each layout now just supplies its own `NavSection[]`.

Hit two real implementation bugs building it, both caught before commit: (1) passing raw Lucide
icon *component references* as props from a Server Component layout.tsx into the client AppShell
produced a real runtime 500 ("Functions cannot be passed directly to Client Components") -- React
Server Components can only serialize plain data and already-rendered elements across that boundary,
never a function reference. Fixed by pre-rendering each icon (`navIcon(LayoutDashboard)` -> a
`<LayoutDashboard .../>` element) in the Server Component before it ever reaches the client
boundary. (2) `DESIGN_SYSTEM.md`'s own documented breakpoint scale (`sm 640, md 1024, lg 1280,
xl 1536`) turned out to have never actually been configured in `tailwind.config.ts` -- it was
silently using Tailwind's stock `md 768/lg 1024` scale the entire time, so an "icon rail at md"
test at 1024px was actually hitting the *full-sidebar* breakpoint under the old, unconfigured
scale. Added a real `screens` override matching the documented scale exactly.

Also swapped the codebase's hand-rolled-SVG-only icon convention for `lucide-react` (shadcn's own
default icon set, and the user's own instructions call for "high-quality icons" -- a deliberate
design-system upgrade for this pass, not scope creep) and added `components/shell/navIcon.tsx`, a
tiny per-icon helper so every layout.tsx doesn't repeat the same size/stroke/aria props.

Verified with real screenshots at every step this time, not assumed from code review: 1440px (full
sidebar, light and dark), 1100px (icon rail -- confirmed the mobile top bar was *also* incorrectly
showing here on the first pass, a `lg:hidden` vs `md:hidden` mixup, fixed and re-verified), 390px
(overlay drawer, plus a scripted click-to-open interaction confirming the drawer actually opens).
Also caught a false alarm worth recording precisely because it wasn't a bug: a scrollable nav
region (the (dashboard) shell's grouped list is taller than a 900px viewport) initially looked cut
off in a static screenshot -- checked `scrollHeight`/`clientHeight`/`overflowY` directly via
`page.evaluate()` and scrolled it programmatically to confirm it's a real, working
`overflow-y-auto` region, not a layout bug. Distinguishing an actual bug from an artifact of how a
static screenshot represents a scrollable region is exactly the kind of judgment this new tooling
requires that curl never could.

Verified: admin typecheck/lint/test (114/114, +2 new `ThemeToggle` tests -- needed a scoped
`window.matchMedia` polyfil since jsdom doesn't implement it and `next-themes`' `enableSystem` path
calls it) and a real production build, both clean.

## 2026-08-02 — Design-tooling setup surfaces a P0: the production CSP has been silently breaking hydration since the first commit

Mohammed asked for a full PWA UI/UX redesign and to install real design/browser-verification
tooling first (shadcn MCP, 21st.dev Magic MCP, the Anthropic frontend-design plugin, Chrome
DevTools MCP, plus Vercel's skills CLI and a plain markdown design-guidelines reference).

**Tooling reality check**: this environment has no `claude` CLI and no mechanism to register a new
MCP server mid-session (MCP servers connect at client startup, not dynamically) -- wrote
`.mcp.json` at the project root configuring `shadcn` and `chrome-devtools` (both installable
without a paid account) so they're live after a reload; `21st.dev` Magic MCP needs a fresh API key
from their own signup flow, a real external-account requirement, so it's flagged blocked rather
than worked around. The Anthropic frontend-design plugin turned out to be a prompting methodology
("Claude automatically uses this skill for frontend work"), not a registrable tool -- applying its
documented principles directly rather than chasing a formal install step. Since Chrome DevTools MCP
couldn't be live this session either, built a small standalone substitute: `puppeteer-core`
pointed at the already-installed system Chrome, giving real screenshots + console/network error
capture without needing the MCP wrapper.

**First real-browser check found something much bigger than a styling problem.** Pointed the new
audit script at the running `/overview` page and got back a screenshot of nothing but grey skeleton
bars -- every KPI card, chart, and activity feed frozen in its `loading.tsx` fallback state, plus a
wall of `Content-Security-Policy` console errors blocking inline scripts. `next.config.ts`'s static
CSP (`script-src 'self'`, no nonce, no `'unsafe-inline'`) had been blocking every one of Next.js's
own inline hydration `<script>` tags in every real browser -- since this project's literal first
commit (`ce0f389`). Every "demo-mode smoke test... 200 with real content" claim made across this
entire session was a `curl | grep` against raw HTML bytes, which doesn't execute JavaScript or
enforce CSP at all, so it was structurally blind to this exact class of bug the whole time.

Fixed properly, not patched around: migrated `middleware.ts` -> `proxy.ts` (Next.js 16 renamed the
convention; deprecated but still working, migrated anyway since this file needed touching regardless)
and implemented Next's own documented nonce-based CSP -- a fresh nonce generated per request, set as
the `Content-Security-Policy` response header, which Next.js automatically applies to its own
framework/hydration scripts. This requires dynamic rendering everywhere a nonce needs to exist;
`/login` and `/onboarding/create-organization` were the only two static pages (single-file
`'use client'` components with nowhere to attach `export const dynamic`) -- split each into a thin
dynamic `page.tsx` wrapper plus an unchanged, relocated client form component.

Verified with the same real-browser tooling that caught the bug: `/overview` (light + dark),
`/login`, `/dashboard` all now render fully hydrated real content with zero CSP violations --
confirmed by screenshot, not just a curl status code. `pnpm typecheck`/`lint`/`test` (112/112) and a
real production build all clean afterward. Full narrative in `DECISIONS.md` 2026-08-02 -- this is
disclosed there as a real gap in this session's own past verification depth (the curl checks that
ran did run and did return what was reported; they were just never sufficient to catch a
client-hydration failure), not a retraction of anything specific that was claimed.

Now moving on to the actual UI/UX redesign work this was meant to set up for, with real
browser-based verification as the standard going forward rather than curl alone.

## 2026-08-01 (continued, 27) — Android: Maintenance vertical slice (priority 12, continued) -- and a real, pre-existing API gap found while scoping ticket submission

Fifth Android module. Started by re-reading `MOBILE_ARCHITECTURE_DECISION.md` §6/§7, which is explicit
that Maintenance ticket *submission* -- not just viewing -- is the master prompt's own native-app
write-path priority ("full flow both directions," the one write action that gets a real offline
queue in V1). So before building the read-only list this pass planned to start with, checked what
wiring a real POST would actually take.

Found a real gap: `apps/admin/lib/supabase/server.ts`'s `getServerSupabaseClient()` -- the one auth
resolution helper every API route handler in the app calls -- only ever reads the caller's session
from cookies (`@supabase/ssr`'s `createServerClient`). It never inspects an `Authorization: Bearer`
header at all. `API_SPEC.md` §0 itself says the contract is `Authorization: Bearer <supabase-jwt>`
on every request, specifically so native apps can "consume the same API surface as the web app" --
but the actual server-side implementation never grew to match that stated contract, because every
API route built this session was verified against the web client's own cookie session, the only
caller that has existed until now. A native Android POST with a valid JWT in a Bearer header would
still get an unconditional 401 today, for every mutating route in `apps/admin/app/api/v1/**`, not
just maintenance-tickets.

Filed as `TECHNICAL_DEBT_REGISTER.md` TD-28 rather than either (a) quietly patching around it with
a direct-Postgrest insert (violates this project's own established API-layer-writes-only discipline
-- `API_SPEC.md` §0's carve-out is reads-only, for good reason: audit-trail writes, business-rule
validation), or (b) building the write call anyway and letting it 401 in the first real use. Fixing
TD-28 properly means changing the shared auth-resolution path every existing route depends on -- an
`auth`-classified, high-risk change per this project's own task-routing rules, not something to
fold into an Android UI slice without it being asked for. Support-mode's TD-25 got the same
treatment for the same underlying reason (a security-relevant gap correctly flagged, not silently
routed around).

Scoped this slice down to view-only accordingly (list + detail, org-wide, same shape as the Tenants
slice) -- a new fourth bottom-nav tab, `MaintenanceTicket` domain model, DTO/Entity/Dao/repository
pair. `PropertyVaultDatabase` bumped 4 -> 5. Tests: `MockMaintenanceRepositoryTest` (3),
`MaintenanceListViewModelTest` (4). Verified: real `gradlew testDebugUnitTest assembleDebug
lintDebug` -- BUILD SUCCESSFUL, 37/37 unit tests (7 new, 30 pre-existing, none broken), lint 0
errors/55 warnings (unchanged). Device-verified same as every prior slice this pass: AVD, sign-in,
tap through to the ticket list and detail, light and dark mode, `logcat` confirmed no crash.

## 2026-08-01 (continued, 26) — Android: Leases vertical slice (priority 12, continued), device-verified in the same pass

Fourth Android module. Unit-scoped (a lease only makes sense for a specific unit), reached from
Unit Detail's new "View leases" button -- no new bottom-nav tab, same reasoning as Units.
File-for-file the same shape as Units/Tenants: `Lease` domain model (provenance fields
`source`/`sourceDocumentId`/`sourceApplicationId` left out, same call as `Tenant.idNumberRef`),
DTO/Entity/Dao/real-repository/mock-repository, `PropertyVaultDatabase` bumped 3 -> 4.

Extracted `formatCurrency()`/`formatArea()` out of `UnitDetailScreen` (where they were private,
added during the last entry's bug fix) into a shared `ui/common/NumberFormatting.kt`, since Lease
Detail needs identical formatting for rent/deposit and copy-pasting the exact logic that just
caused a real bug would be asking for the same bug twice.

Tests: `MockLeasesRepositoryTest` (4), `LeasesListViewModelTest` (4). Verified with a real Gradle
run: `gradlew testDebugUnitTest assembleDebug lintDebug` -- BUILD SUCCESSFUL, 30/30 unit tests (8
new, 22 pre-existing, none broken), lint 0 errors/55 warnings (unchanged).

Given the previous entry's device pass caught a real bug that no unit test could have, repeated the
same device verification here rather than treating it as optional now that the toolchain is warm:
booted the AVD, installed the APK, drove Property -> Unit -> View leases -> Leases list -> Lease
Detail by hand via `adb`, confirmed via `logcat` (no crash) and screenshots in light and dark mode.
The formatted values ("R10,650" for rent and deposit) render correctly, confirming the extracted
shared formatter carried the earlier fix over cleanly rather than silently reintroducing it.
Reverted dark mode and shut the emulator down cleanly afterward.

## 2026-08-01 (continued, 25) — Android: real device verification, one bug found and fixed

Mohammed installed a current Android Studio and asked for the previously-disclosed device/emulator
verification gap (Units + Tenants slices) to actually be closed. Booted the pre-existing
`PropertyVault_Pixel7_API35` AVD (created during the M22 toolchain setup), installed the real debug
APK via `adb install -r`, and drove the whole flow by hand via `adb shell input`/`screencap`:
sign-in (mock auth, any non-blank credentials) -> Dashboard/Properties/Tenants bottom-nav (all 3
tabs, confirming the new Tenants tab is really there) -> Property Detail -> "View units" -> Units
list (both fixture units, correct labels/status) -> Unit Detail -> back to Tenants tab -> Tenant
Detail. Confirmed via `adb logcat` (`Displayed com.propertyvault.app/.MainActivity`, zero
`AndroidRuntime`/`FATAL` lines across the whole session) and real screenshots at every step, then
repeated the key screens with `adb shell cmd uimode night yes` for dark mode.

**Real bug caught on-device, not by any of the earlier unit tests**: Unit Detail showed "Market
rent: R10650.0" and "Size: 65.0 m²" -- Kotlin's default `Double.toString()` always keeps a trailing
`.0`/decimal, which none of `MockUnitsRepositoryTest`/`UnitsListViewModelTest` would ever catch
since they assert on the `PropertyUnit` domain value, not the rendered string. Fixed with two small
formatting helpers in `UnitDetailScreen.kt` (`formatCurrency()`/`formatArea()` -- whole numbers
print without a decimal, e.g. "R10,650"/"65 m²"). Rebuilt (`gradlew testDebugUnitTest assembleDebug`
-- BUILD SUCCESSFUL, 22/22 still passing), reinstalled on the same emulator, re-verified the fixed
screen with a fresh screenshot before considering this closed. Reverted dark mode and shut the
emulator down cleanly (`adb emu kill`, confirmed `adb devices` empty) afterward.

This is exactly the kind of bug format/rendering unit tests structurally can't catch (they check
domain values, not what actually lands on screen) -- concrete evidence for why this session's
"install and screenshot on a real device" bar exists as a separate verification step, not a
formality superseded by a green test suite.

## 2026-08-01 (continued, 24) — Android: Tenants vertical slice (priority 12, continued)

Third Android module. Org-wide list + detail, not property-nested (mirrors `apps/admin`'s own
Tenants module shape, unlike Units which is correctly property-scoped) -- added as a real third
bottom-nav tab now that there's real content behind it, same discipline against stubbing dead tabs
that kept the nav to 2 items until now.

Identical stack to the Units slice, same file-for-file shape: `Tenant` domain model (`idNumberRef`
deliberately left out -- an `encrypted_secrets` pointer with no view-only-screen use), DTO/Entity/
Dao/real-repository/mock-repository, `PropertyVaultDatabase` bumped 2 -> 3. Tests:
`MockTenantsRepositoryTest` (3), `TenantsListViewModelTest` (4).

Verified with one real Gradle run (`testDebugUnitTest assembleDebug lintDebug` together, since the
toolchain is now warmed up and each task shares compiled output with the others): BUILD SUCCESSFUL,
22/22 unit tests across the whole module (6 new, 16 pre-existing, none broken), real ~20.8MB debug
APK, lint 0 errors / 55 warnings (identical to the pre-existing baseline, no new warnings). Not run:
device/emulator install or a screenshot pass, same disclosed gap as the Units slice.

## 2026-08-01 (continued, 23) — Android: Units vertical slice (priority 12)

Second Android module, same one-module-at-a-time pattern Properties established. View-only
(`MOBILE_ARCHITECTURE_DECISION.md` §6), reached from a new "View units" button on Property Detail
rather than a bottom-nav tab -- units only make sense in a property's context, matching
`apps/admin`'s own original build order (org-wide `/units` came later there too).

Mirrored Properties' full stack: `PropertyUnit` domain model (named to dodge Kotlin's own `Unit`
type), `UnitDto`/`UnitEntity`/`UnitDao` (Room cache scoped to `propertyId`, a `replaceForProperty()`
transaction rather than `PropertyDao`'s whole-table `replaceAll()` since a units read never spans
more than one property), `PostgrestUnitsRepository` (real, same write-through-cache-then-fallback
shape as its Properties counterpart) + `MockUnitsRepository` (2 fixture units under
`demo-property-1`, the same id the Properties fixture uses, so the demo click-through is coherent
end to end), never mixed. `PropertyVaultDatabase` bumped 1 -> 2 with `fallbackToDestructiveMigration()`
-- acceptable, this is a read-through cache, never a source of truth. Two new routes added to the
existing shared NavHost in `OwnerRootScreen` (no new nested graph needed).

Tests: `MockUnitsRepositoryTest` (4), `UnitsListViewModelTest` (4, same dispatcher pattern
`PropertiesListViewModelTest` already established). Verified with real Gradle runs (not claimed
without command output): `gradlew testDebugUnitTest` -- BUILD SUCCESSFUL, 15/15 unit tests across
the whole module passing; `gradlew assembleDebug` -- BUILD SUCCESSFUL, real ~20.7MB debug APK;
`gradlew lintDebug` -- 0 errors, 55 warnings, identical to the pre-existing baseline. Not run this
pass: install/launch on a device or emulator, or a light/dark screenshot pass -- the first
vertical slice's own bar included those; this pass's actual verification is build+test+lint.

## 2026-08-01 (continued, 22) — UI consistency audit (priority 11): loading-state gaps closed

Audited every `(dashboard)`/`(super-admin)`/`(tenant)` page against `DESIGN_SYSTEM.md`'s per-module
conventions (loading states, shared table/empty-state/badge components, dark-mode class coverage).
Checked: which list/detail pages lack a `loading.tsx` sibling, whether every table component
reuses `AdminDataTable` (17/17 do), whether any component has color styling with no `dark:`
variant (one false positive — `BankAccountsTable`'s only class is `capitalize`, not a color, no
fix needed), whether Super Admin pages use hand-rolled colors instead of the shared
`StatusBadge`/`HealthStatusIndicator` components (none found).

**Real gaps found and fixed**: `/properties` (the very first vertical slice built this session,
predating the explicit per-module loading-state convention M20 later established) and all six
`(super-admin)` pages (`/overview`, `/customers`, `/customers/[id]`, `/subscriptions`,
`/processing`, `/system` — the whole M19 milestone predates that convention too) had no
`loading.tsx`. Added all seven, same `PageLoading` skeleton pattern every other module uses.
Confirmed the apparent gap on every `new`/`edit` create-form page is not an inconsistency — zero
create/edit pages anywhere in the app have a `loading.tsx`, a consistently-applied (if implicit)
scope choice, not something this pass needed to touch.

Verified: admin typecheck/lint/test (112/112, unchanged -- no new logic, loading.tsx has nothing
to unit-test) and real `next build` clean.

## 2026-08-01 (continued, 21) — Super Admin PWA completion pass (priority 10): plan-change UI wired, support-session UI deliberately held back

Reviewed M19's open items for "Super Admin PWA completion." Two categories: small bounded UI gaps
(safe to close now) and one genuinely unbuilt authorization mechanism (not safe to build
speculatively). Also committed `apps/admin/app/error.tsx`/`global-error.tsx`/
`components/tables/ProcessingTable.tsx` — all three already existed on disk and are required by
already-committed code (the `/processing` page literally can't build without `ProcessingTable`),
just never got `git add`ed in an earlier pass; the repo would not have built from a fresh clone
until this fix.

**Closed**: `OrganizationActionsPanel` gained a "Change plan" section (plan picker fetched from
`GET /api/v1/admin/plans`, optional discount %, PATCH to the already-built, already-audited
`.../organizations/:orgId/plan` endpoint) — a straightforward UI-to-existing-endpoint gap, same
category as the activate/suspend/archive/credit controls the design phase already wired.

**Deliberately not closed**: support-mode's "read-only by default, explicit escalation per write"
enforcement (`SUPER_ADMIN.md` §6). The session lifecycle (start/end, reason, audit trail) is real
and tested, but there is no RLS/API-layer mechanism anywhere in this schema that grants a platform
admin viewer-equivalent read access into a target org — building one is a real, cross-tenant
authorization change, not a wiring task, and PropertyVault's tenant-isolation protections are never
waived without an explicit go-ahead. Left the "start support session" control unwired rather than
surface a control that would imply a scoping guarantee the system doesn't actually enforce yet.

Tests: `OrganizationActionsPanel.test.tsx` (4 cases, including a fetch-mocked plan-list render).
Verified: admin typecheck/lint/test (112/112) and real `next build` clean. Not verified via a
demo-mode click-through — `customers/[id]/page.tsx`'s demo-mode branch is a separate, simpler
read-only view that never renders `OrganizationActionsPanel` at all (true for every action this
panel already had, not a new gap); the component test suite is the real verification here, same as
every prior pass on this component.

## 2026-08-01 (continued, 20) — Tenant portal: V1 scope correction (priority 9), a real RLS recursion bug found and fixed before commit

Priority 9 ("Tenant-facing experience") directly conflicted with this project's standing "no
tenant portal in V1" decision, applied consistently across every earlier module (Applications,
Maintenance ticket submission, Announcement acknowledgement all deliberately excluded tenant UI on
that basis). Asked Mohammed how to proceed; answer: treat it like the Applications V1
simplification — build a basic tenant portal now, update `PERMISSIONS.md`/
`MOBILE_ARCHITECTURE_DECISION.md` to match. Full narrative in `DECISIONS.md` 2026-08-01.

Built: `supabase/migrations/20260101000049_tenant_portal_rls.sql` (RLS for
leases/lease_tenants/rent_schedules/invoices/maintenance_tickets/documents/units/properties, all
keyed on the same `tenants.user_id = auth.uid()` predicate `tenants`/`announcements` already used),
`lib/tenantSession.ts` (`resolveTenantSession()`, a third independent identity system alongside
org-staff/platform-admin), a third branch on `/`'s routing, and a `(tenant)` route group:
`/my-lease`, `/my-payments`, `/my-maintenance` (+ `/new`, posting through a new tenant-scoped
`POST /api/v1/tenant-portal/maintenance-tickets` route that derives property/unit/lease context
server-side rather than trusting the client), `/notices` (reusing the already-existing
`POST /api/v1/announcements/:id/acknowledge` endpoint).

**Real bug found and fixed before any commit**: the first draft of the migration wrote
`leases`/`documents`/`rent_schedules`'s tenant-self policies as raw subqueries into
`lease_tenants`. `lease_tenants` already has its own policy that queries back into `leases` to
resolve `org_id` — the two together produced `42P17: infinite recursion detected in policy for
relation "leases"`, caught by `npx supabase test db` failing 3 of 13 suites. Fixed the same way
`has_org_role()` already solves this identical class of problem: wrapped the cross-table checks in
`SECURITY DEFINER` functions (`caller_is_tenant_of_lease()`, and while building the tenant UI's
unit/property-name lookups, `caller_is_tenant_of_unit()`/`caller_is_tenant_of_property()` for the
same reason — `units`/`properties` are org-member-only by default and the tenant UI needs to read
through them). Re-ran `db reset` + `test db` after the fix: clean 176/176, same count as before
this migration.

Deliberately not built (same "basic, not a platform" instruction the Applications correction
used): tenant messaging, tenant document upload, profile/settings editing, native tenant app.
Documents stay staff/owner-only by default — tenant-visible only when a staff member explicitly
tags one with the new `documents.lease_id` column, not a blanket property-scoped grant (owner-only
paperwork must stay invisible to tenants).

Tests: `NoticesList.test.tsx` (3), `TenantMaintenanceTicketForm.test.tsx` (2). Verified: full pgTAP
(176/176), admin typecheck/lint/test (108/108), real `next build` clean, demo-mode smoke test
across all 5 new routes with real rendered content (lease/unit/property names, rand-formatted
balances via `en-ZA` locale, ticket summaries, notice acknowledgement state). Not verified: a live
authenticated tenant session end-to-end over HTTP (no live Supabase project/test tenant user in
this environment) — RLS correctness rests on pgTAP, UI rendering rests on the demo-mode smoke test,
same split every other RLS-touching module this session used.

## 2026-08-01 (continued, 19) — Owner Dashboard (priority 7) + a real login-routing bug found and fixed

Built `/dashboard` (KPI row: Properties/Units occupied %/Cash left this month/Units available,
matching PROPVIEW_SCREENSHOT_AUDIT.md exactly, plus quick links) — and while wiring up "where does
a signed-in client-org user actually land," found that they couldn't: root `/` only ever checked
platform-admin auth and `/login` hardcoded `/overview`, so a real org member would sign in and
immediately bounce back to `/login` in a loop. Full root-cause writeup in `DECISIONS.md` 2026-08-01
(not repeated here) — fixed `/` to check both session types, `/login` to redirect through `/`
instead of hardcoding a destination, demo mode left untouched on purpose.

Also caught and fixed, same pass: `middleware.ts`'s protected-route list hadn't been updated since
this session's M20 pass added 12 new route segments — every page still independently enforced its
own auth (never a data-exposure gap), but middleware's own pre-render gate had silently stopped
covering any of them. Added all 12 plus `/dashboard`.

Verified: admin typecheck/lint/test (103/103) and real `next build` clean (middleware's `matcher`
stayed a static array), demo-mode smoke test confirming `/` still resolves to `/overview` unchanged
and `/dashboard` renders real content.

## 2026-08-01 (continued, 18) — Reports module (priority 6)

Built the 4 report cards `PROPVIEW_SCREENSHOT_AUDIT.md` evidences (IMG_7991-7995) exactly: Income
vs Expense Trend, Occupancy by Property, Tenant Payment Status, Maintenance by Status, each with a
matching empty state + CTA (moved up from its original M25 launch-checkpoint slot into this M20
pass, per Mohammed's restated priority order).

Income/expense trend uses month-bucketed sums of paid `rent_schedules`/recorded `expenses` rather
than a `journal_lines`/`chart_of_accounts` join — Trial Balance already is the general-ledger
report; this card is the simpler evidenced "trend" view, and building a second ledger-accurate
report would be duplicate, unrequested complexity. Reused the existing dependency-free
`MiniLineChart`/`MiniBarChart` components (already used by the Super Admin overview dashboard)
rather than adding a charting library.

No migrations, no new tests (read-only report page, no role gate — viewer+ already see everything
it queries via existing RLS, same as every list page).

Verified: admin typecheck/lint (clean), full test suite (103/103, unchanged as expected), real
`next build` clean, demo-mode smoke test confirming all 4 cards render real content.

## 2026-08-01 (continued, 17) — Payments/bank-matching V1 slice (priority 4)

Web UI for the M14-part-2 bank accounts/transactions API, which already existed and needed no
schema changes. Bank Accounts (list/create) and Bank Transactions (list/create + inline "Match"
control) round out the Accounting section alongside the already-shipped Rent Due/Expenses/Trial
Balance pages.

Matching stays confirm-only per TD-22 (already-documented, deliberate gap: no `calculateMatchScore`
propose step wired in yet) — the UI has staff pick the specific pending/overdue rent_schedule row
to match a transaction against from a plain dropdown, rather than fabricating a scored-suggestion
UI around a feature that isn't built. Simpler, and matches the "don't over-engineer" instruction.

No migrations this pass (existing schema/RPCs only), so no `supabase db reset`/pgTAP re-run needed.

Verified: admin typecheck/lint/test (103/103) and `next build` clean, demo-mode smoke test across
all 4 new routes.

## 2026-08-01 (continued, 16) — Documents + OCR review V1 slice (priorities 2-3)

First real Documents module implementation — M11 (2026-07-31) only did the schema/RLS org-scoping
cutover and explicitly left API/UI unbuilt. Also closed TD-21 (storage bucket still per-user, not
per-org) as part of the same pass, since it's a real prerequisite for a safe upload.

- Migration `20260101000048`: storage bucket policies now check `has_org_role()` against a
  `{org_id}/{property_id}/{uuid}{ext}` path (was `{user_id}/...`); `extraction_results` gained
  `reviewed_at`/`reviewed_by`.
- `POST /api/v1/documents`: real multipart upload, server-parsed, SHA-256 hashed, uploaded via the
  caller's own session client (RLS-protected write, no service-role) — orphan-cleanup on insert
  failure. `GET /documents`, `GET /documents/:id` (+ signed URL).
- `POST /api/v1/documents/:id/extract` generalizes M12's lease-upload-and-parse pattern (service-
  role for extraction_jobs/extraction_results only) to any bill/lease document.
  `POST /api/v1/documents/:id/review` records human confirmation only — no field-correction/auto-
  apply, since a generic Documents module has no single business record to apply onto.
- UI: `/documents` list, `/documents/new` upload form, `/documents/:id` detail with an OcrPanel
  (Extract fields / view results / Confirm reviewed, only shown for bill/lease types).
- Caught and fixed a real bug in code review before running: `overallConfidence ?? 0 * 100` parsed
  as `?? (0*100)` due to operator precedence, would have shown a raw 0-1 fraction instead of a
  percentage — fixed to `(x ?? 0) * 100` before the first test run.

Verified: real `supabase db reset` replaying all 48 migrations clean, full pgTAP 176/176 (no
regressions), admin typecheck/lint/test (96/96) and `next build` clean, demo-mode smoke test
confirming upload form, list, and OCR panel all render real content.

## 2026-08-01 (continued, 15) — Applications simplified to V1 scope (product-scope correction)

Mohammed corrected scope: PropertyVault V1 isn't a tenant-screening platform. Simplified the
Applications module to New → Reviewing → Approved/Declined/Withdrawn, manual only.

- Migration `20260101000047` (expand-only): added `reviewing`/`withdrawn` to `application_status`,
  added `applications.notes`. Left `screening` status, `screening_status`/`screening_consent_at`,
  and `TenantScreeningProvider` fully intact and dormant — moved to ROADMAP.md V2, not deleted.
- New endpoints: `POST /applications/:id/notes` (also flips submitted→reviewing on first save),
  `POST /applications/:id/withdraw`.
- UI: removed screening-consent/run-screening from `ApplicationActions`; kept POPIA consent only;
  added Notes panel + Withdraw button. Status badges now show the real outcome (Approved/Declined)
  via a new `applicationDisplayPresentation()` helper instead of the generic "Decided" label.
  Approve still atomically creates tenant+lease via the unchanged `approve_application()`.
- Caught and fixed a real bug via the demo-mode smoke test: the `/applications` list page's KPI
  row still read "Submitted/Screening/Decided" after the status-model change — updated to
  New/Reviewing/Decided/Withdrawn.

Verified: real `supabase db reset` (Docker started for this) replaying all 47 migrations clean,
full pgTAP suite 176/176 passing (no isolation/RLS regressions), `pnpm --filter admin`
typecheck/lint/test (89/89) and `next build` clean, demo-mode runtime check confirming no
screening UI renders anywhere in the app.

## 2026-08-01 (continued, 14) — M20: Notifications and Announcements (tenth and eleventh modules)

Two smaller, more contained modules after Accounting's heavier role-gating investigation.

**Notifications** is the first module this milestone with no org-role gate at all — it's a personal
inbox (`notifications_select_own`/`notifications_update_own` RLS), not org data, so
`canWriteOrgRecords()`/`canPostAccountingRecords()` don't apply; every authenticated user manages
only their own rows. Built `/notifications` (list + mark-as-read) and `/notifications/preferences`
(one row per `NOTIFICATION_CATEGORIES` value, three independent channel checkboxes, each PATCHing
immediately as a per-category upsert — no batch Save button, since the endpoint itself is already a
complete atomic unit of change per checkbox). Checked the actual migration
(`20260101000039_notifications.sql`) for what a category with no preference row yet should default
to, rather than guessing a UI default: `email_enabled`/`push_enabled`/`whatsapp_enabled` are all
`not null default true`, so the "no row yet" UI state renders every channel checked, matching the
real DB default exactly.

**Announcements** is intentionally list-and-create only — checked `API_SPEC.md` §5 before assuming
a detail/edit page was needed and confirmed there's genuinely no PATCH endpoint for announcements
at all (only `GET/POST` and a tenant-only `acknowledge` action, out of scope with no tenant portal
in V1). First slice publishes org-wide only; a per-property announcement is evidenced as possible
in the schema (`propertyId` optional) but there's no reference UI pattern for picking one
target property to copy, so it's deliberately deferred rather than invented. Used the
`canWriteOrgRecords()` helper introduced during the Accounting slice for the first time in a
brand-new file (rather than another inline `role !== 'viewer' && role !== 'accountant'` copy) —
exactly the kind of small, low-risk win TD-27 flagged as available going forward without needing to
touch the 8 already-shipped files that still use the inline form.

**Full verification, both modules**: `pnpm --filter admin typecheck`/`lint`/`test` clean on every
attempt (81/81 after Notifications, 84/84 after Announcements) and `pnpm --filter @propvault/ui
typecheck` clean; real clean `next build` after each, registering all new routes; runtime smoke
tests via `next start` in demo mode covering every new route — all 200, response bodies grepped for
real rendered content. Server processes confirmed via `Get-CimInstance Win32_Process` before
stopping, same discipline as every prior port-owning process this session.

## 2026-08-01 (continued, 13) — M20: first Accounting vertical slice (Rent Due, Expenses, Trial Balance) — ninth module

Mohammed's broader instruction explicitly named Accounting as real financial-correctness surface
("Protect accounting integrity" under Database, "never weaken security to make implementation
easier" under Security) — approached this one more carefully than the CRUD modules rather than
copy-pasting the established pattern blindly.

**Before writing any UI, read the actual posting functions rather than assuming the same agent+
gate applied.** `PERMISSIONS.md`'s table has separate "Accounting (view)" and "Accounting (post)"
columns; agent gets View only, none for post. Confirmed this is really enforced, not just
documented, by reading `invoice_rent_schedule()` and `record_expense()`
(`supabase/migrations/20260101000038_accounting_posting_operations.sql`) directly — both call
`has_org_role(org_id, 'accountant')` as an internal check before doing anything, which (per
`has_org_role()`'s own code comment) admits exactly `{accountant, manager, principal}` — agent is
excluded, deliberately, not a linear-rank artifact. Every prior module's inline
`role !== 'viewer' && role !== 'accountant'` check would have been wrong here — it would let an
`agent` see and click an "Issue invoice"/"Record expense" button that the database would then
correctly reject, but that's still a real UX/trust bug (and a smaller version of the exact
"expected behavior contradicts audited behavior" pattern this project's security review already
flagged once before, R-22 in `RISK_REGISTER.md`, for a different reason). Added
`canWriteOrgRecords()`/`canPostAccountingRecords()` as two explicit, named, unit-tested checks
(`orgSession.test.ts`) rather than silently reusing the wrong one.

Scoped this pass to exactly three screens with a straightforward, already-shipped API: Rent Due
(list + Issue invoice), Expenses (list/create/detail + Record expense), Trial Balance (read-only
report). Explicitly did NOT attempt bank transaction matching (a genuine propose-then-confirm UI
around `calculateMatchScore`), owner statements (a batch-draft workflow), or the tax pack (PDF
export) in the same pass — each is its own multi-step workflow deserving focused attention, not
something to rush alongside a role-gating correction in the same batch.

Verified the "paid immediately" checkbox's copy against `record_expense()`'s actual behavior
(`Cr Bank` if true, `Cr Accounts Payable` if false) rather than writing a plausible-sounding label
from the field name alone — got it right on the first read, but confirmed rather than assumed.

**Full verification**: `pnpm --filter admin typecheck`/`lint`/`test` (75/75 passed, up from 64,
including the new `orgSession.test.ts` role-gate tests) and `pnpm --filter @propvault/ui typecheck`
clean, all on the first attempt; real clean `next build` registered all 5 new routes; runtime smoke
test via `next start` in demo mode covering all 7 route/query-param combinations (both status
filters on Rent Due, both ledger_class filters on Trial Balance, the expense detail/create/list
pages) — all 200, response bodies grepped for real rendered content including the action-button
states. Server process confirmed via `Get-CimInstance Win32_Process` before stopping.

## 2026-08-01 (continued, 12) — M20: Inspections vertical slice (eighth module) — CRUD/workflow-shaped modules now complete

Same no-generic-PATCH shape as Applications, reused the same design pattern deliberately:
`InspectionActions` is the edit surface (items + independent landlord/tenant signatures +
gated Complete), not a generic form, because the API genuinely doesn't have a generic form's shape
to match (`API_SPEC.md` §5 exposes only `items`/`sign`/`complete`, all workflow actions). No
`GET /api/v1/inspections/:id` route exists at all (only list) — confirmed this doesn't matter for
the detail page's own read, since every detail page this milestone reads directly via the caller's
RLS-scoped client regardless of whether a matching GET/:id API route exists (Property/Unit/Lease/
Application detail pages all already did this too).

Real bug caught by the test suite, in the test not the component: `InspectionsTable.test.tsx`'s
first run failed `getByText('Scheduled')` with "found multiple elements" — the table legitimately
renders "Scheduled" twice (the "Scheduled" date column header, and the status badge's "Scheduled"
label when a row's status happens to be `scheduled`). Not a component bug; fixed the assertion to
`getAllByText('Scheduled').length === 2`.

This closes out every M20 module with a straightforward CRUD-or-workflow-shaped API (Properties,
Units, Tenants, Leases, Maintenance, Owners, Applications, Inspections — 8 vertical slices, all
built and verified today). What's left in M20 (Accounting screens, Notifications, Announcements,
an AI Assistant chat interface, the Portfolio Intelligence feed, Portfolio Map) are each a
genuinely different UI shape — ledger/statement views, a chat interface, a rules-driven insights
feed, a map — not more of the same list/detail/create-edit pattern. Reassessing scope and sequencing
before picking the next one, per Mohammed's standing instruction to keep moving without waiting for
a prompt between milestones, but also not to leave anything half-built.

**Full verification**: `pnpm --filter admin typecheck`/`lint`/`test` (64/64 passed, up from 57) and
`pnpm --filter @propvault/ui typecheck` clean; real clean `next build` registered all 3 new routes;
runtime smoke test via `next start` in demo mode covering `/inspections`, `/inspections/
demo-inspection-1`, `/properties/demo-property-1/units/demo-unit-1/inspections/new`, and the unit
detail page's embedded inspections section — all 200, response bodies grepped for real content.
Server process confirmed via `Get-CimInstance Win32_Process` before stopping.

## 2026-08-01 (continued, 11) — M20: Applications vertical slice (seventh module)

Applications is the first module this pass with no generic PATCH endpoint — `API_SPEC.md` §4
exposes only `POST .../consent`, `POST .../screen`, and `POST .../decide`, each a distinct
workflow action with its own validation and state-machine guard. Built `ApplicationActions` (the
detail page's action panel) around that real shape rather than forcing a generic edit form onto a
resource that doesn't have one: independent POPIA/screening consent buttons (each becomes a
permanent "Granted [date]" once set, matching the API's own "never un-set" design), a Run Screening
button disabled until screening consent exists (mirroring the API's 400 `consent_required` guard
client-side, not duplicating server logic — just reflecting the same precondition in the UI), and
an Approve/Decline decision panel that disappears once the application reaches `decided`, replaced
by a read-only summary.

Real, useful bug caught by writing a real test rather than just eyeballing the component: the first
`ApplicationActions.test.tsx` run failed every case with "invariant expected app router to be
mounted" — `useRouter()` (used for `.refresh()` after each action) requires an App Router context
that plain RTL rendering doesn't provide. Every earlier form component that also calls `useRouter()`
(`NewPropertyForm`, `UnitForm`, `TenantForm`, `LeaseForm`, `MaintenanceForm`, `OwnerForm`,
`ApplicationForm`) was never itself under test — only the presentational Table/Board components
were, which don't touch routing. Fixed by mocking `next/navigation`'s `useRouter` in the test file
(`vi.mock`), not by changing the component — this is a test-environment gap, not a real bug in
`ApplicationActions` itself.

**Full verification**: `pnpm --filter admin typecheck`/`lint`/`test` (57/57 passed, up from 50) and
`pnpm --filter @propvault/ui typecheck` clean; real clean `next build` registered all 3 new routes;
runtime smoke test via `next start` in demo mode covering `/applications`,
`/applications/demo-application-1` (confirmed both the "Record" consent buttons and the
"Screening consent must be recorded first" guard message actually render), `/properties/
demo-property-1/units/demo-unit-1/applications/new`, and the unit detail page's embedded
applications section — all 200, response bodies grepped for real content. Server process confirmed
via `Get-CimInstance Win32_Process` before stopping.

Next: Inspections (M13, the last CRUD-shaped module with a straightforward API before the
remaining M20 scope shifts to genuinely different UI shapes — Accounting screens, Notifications,
Announcements, an AI Assistant chat interface, and the Portfolio Intelligence feed).

## 2026-08-01 (continued, 10) — M20: Owners vertical slice (sixth module); Mohammed's broader continue-to-completion instruction received

Mohammed sent a much larger standing instruction: continue autonomously through every remaining
milestone (backend and UI/UX) toward a production-ready commercial SaaS, stopping only for the
short list of genuine blockers (business/legal decisions, third-party credentials, app-store
submission, production payment/WhatsApp/email credentials) — explicitly not pausing after every
milestone. Continued directly into the next M20 module rather than stopping to acknowledge.

Built Owners the same way as every prior module this pass: reused the M7 API and `mapOwnerRow`/
`requireOrgRole` unchanged, org-wide `/owners` list (matches `PROPVIEW_SCREENSHOT_AUDIT.md`'s
PORTFOLIO section), detail/create/edit pages, role-gated agent+ writes, loading states, tests.

One small, deliberate deviation from the established `packages/ui` `StatusPresentation` pattern:
`Owner.status` (`'active' | 'inactive'`) is a plain inline TS union on the `Owner` type in
`packages/types/src/portfolio.ts`, not a named exported enum type the way
`UnitStatus`/`TenantStatus`/`LeaseStatus`/`MaintenanceStatus` all are. Growing
`StatusPresentation`'s `Record<T, ...>` pattern for a type that isn't separately named/exported
would need exporting a new type just to hang a presentation record off it, for a two-value field
with exactly one consumer (`OwnersTable`). Used a small local badge component instead — same visual
language (dot + label, colour never alone), just not routed through the shared map.

**Full verification**: `pnpm --filter admin typecheck`/`lint`/`test` (50/50 passed, up from 47) all
clean; real clean `next build` registered all 4 new routes; runtime smoke test via `next start` in
demo mode covering `/owners`, `/owners/demo-owner-1`, `/owners/new`, `/owners/demo-owner-1/edit` —
all 200, response bodies grepped for real content. Server process confirmed via
`Get-CimInstance Win32_Process` before stopping, same discipline maintained throughout.

Next up per the broader instruction and `TASKS.md`'s own M20 list: Applications (screening/decision
flow, more complex than the CRUD-shaped modules so far — decision approval calls
`approve_application()` which atomically creates a lease), then Inspections, then a reassessment of
what's left before committing to the next batch.

## 2026-08-01 (continued, 9) — M20: Maintenance vertical slice (fifth and final module of this pass)

Fifth module, closing the exact list Mohammed named ("Units, Tenants, Leases, Maintenance"). Reused
the M13 Maintenance Tickets API and `mapMaintenanceTicketRow`/`requireOrgRole` unchanged.

Checked `PROPVIEW_SCREENSHOT_AUDIT.md` again before designing the page: the reference product's
Maintenance module is a full kanban board (KPIs + 4 drag-and-drop columns: To Do/In Progress/
Pending Approval/Completed). Built the KPI row and the 4-column grouped layout, but explicitly
scoped out actual drag-and-drop — status changes go through the ticket's edit page instead, using
the same server-side `isValidMaintenanceTransition` state-machine check the API route already
enforces (`to_do → in_progress → pending_approval → completed`, plus one intentional backward step
at each stage per `apps/admin/lib/operations.ts`'s `MAINTENANCE_TRANSITIONS` map). This is a
confirmed, honest V1 scope reduction — noted explicitly in the page and TASKS.md, not silently
simplified — in the same category as Portfolio Map's already-confirmed "no GIS/heatmap layers."

Real, deliberate omission worth flagging: `MAINTENANCE_TRANSITIONS` lives in `apps/admin/lib/
operations.ts`, which starts with `import 'server-only'` — it cannot be imported into
`MaintenanceForm.tsx` (`'use client'`) to pre-filter the status `<select>`'s options client-side.
Rather than duplicate the transition graph into a second, client-side copy (exactly the
"guaranteed to drift" anti-pattern `requireOrgRole`'s own comment warns against for role
hierarchies), the form offers all 4 statuses and lets the server's existing 409
`invalid_transition` response surface through the form's already-built generic error banner. No
new client-side state-machine code was written.

Also scoped out: vendor assignment and photo attachments, both real evidenced features
(`PROPVIEW_SCREENSHOT_AUDIT.md`'s "up to 12 photos", `assignedVendorId` on the schema) with no
picker/upload UI anywhere in this codebase yet to build against — noted on the detail page rather
than either building a placeholder or silently dropping the capability.

**Full verification**: `pnpm --filter admin typecheck`/`lint`/`test` (47/47 passed, up from 43) and
`pnpm --filter @propvault/ui typecheck` clean, all on the first attempt; real clean `next build`
registered all 6 new/changed routes; runtime smoke test via `next start` in demo mode covering
`/maintenance`, `/maintenance/demo-ticket-1`, `/maintenance/demo-ticket-1/edit`,
`/properties/demo-property-1/maintenance/new`, and the property detail page's embedded maintenance
section — all 200, response bodies grepped for real rendered content. Server process confirmed via
`Get-CimInstance Win32_Process` before stopping.

This closes the M20 pass Mohammed's instruction asked for: Properties (already done ahead of this
pass), Units, Tenants, Leases, Maintenance — five complete, independently verified vertical slices,
same pattern throughout, no shortcuts taken to reach the finish line (every slice got its own real
build, real test run, and real runtime smoke test, not just a typecheck pass). `TASKS.md`/
`WORKLOG.md`/`DECISIONS.md` updated to match; remaining M20 modules (Owners, Applications,
Inspections, Accounting, Notifications, Announcements, AI chat UI, Portfolio Intelligence feed,
Portfolio Map) are explicitly not started, not implied done.

## 2026-08-01 (continued, 8) — M20: Leases vertical slice (fourth module)

Fourth module in the M20 sequence, same pattern. Reused the M10 Leases API and `mapLeaseRow`/
`requireOrgRole` unchanged.

Leases sit one level deeper than Tenants: `leaseCreateSchema` requires a `unitId` and there's no
unit-picker UI anywhere yet, so — same reasoning as Units being created from a property's own
context — a lease is always created from its unit's own page
(`/properties/:id/units/:unitId/leases/new`), and the unit detail page now embeds a Leases section
the same way the property detail page embeds Units. The org-wide `/leases` list still exists
separately (matches `PROPVIEW_SCREENSHOT_AUDIT.md`'s LEASING nav section), joined against
`units`→`properties` in one PostgREST query for the unit/property context columns.

Read `leaseCreateSchema`/`leaseUpdateSchema` closely before building the form: create has no
`status` field (always starts `draft` server-side) but edit does (the update schema allows moving
a lease through draft/active/expired/terminated) — the form's status `<select>` is conditionally
rendered only in edit mode, not just disabled in create mode, so there's nothing misleading shown
before it would ever apply. Also no `rentFrequency` field in either mode: `RENT_FREQUENCIES`
currently has exactly one value (`'monthly'`), a DB default, matching the same "don't build UI for
an option that doesn't functionally exist yet" judgment already applied elsewhere this session.

Added `LEASE_STATUS_PRESENTATION` to `packages/ui/src/statusPresentation.ts` — `terminated` mapped
to `statusDisputed` rather than reusing `expired`'s `statusVoid`, since an early/deliberate
termination is a materially different (often adverse) outcome from a lease simply running its
course, and the design system's rule is never to signal that distinction by colour alone (paired
with the `flag` icon and the "Terminated" label either way).

**Full verification**: `pnpm --filter admin typecheck`/`lint`/`test` (43/43 passed, up from 39) and
`pnpm --filter @propvault/ui typecheck` clean, all on the first attempt this time (no bugs found
building this slice, unlike Units' locale-formatting and `@/`-alias fixes); real clean `next build`
registered all 6 new/changed routes; runtime smoke test via `next start` in demo mode covering
`/leases`, `/leases/demo-lease-1`, `/leases/demo-lease-1/edit`,
`/properties/demo-property-1/units/demo-unit-1/leases/new`, and the unit detail page's embedded
leases section — all 200, response bodies grepped for real rendered content. Server process
confirmed via `Get-CimInstance Win32_Process` before stopping, same discipline as every prior
port-owning process this session.

## 2026-08-01 (continued, 7) — M20: Tenants vertical slice (third module)

Third module in the M20 sequence, same pattern as Properties/Units. Reused the M8 Tenants API and
`apps/admin/lib/leasing.ts`'s `mapTenantRow`/`requireOrgRole` unchanged.

Unlike Units, Tenants aren't scoped to a single property (a tenant can occupy a unit across a
lease, but the tenant record itself belongs to the org) — checked `PROPVIEW_SCREENSHOT_AUDIT.md`'s
sidebar again rather than assuming: Tenants is its own top-level LEASING-section nav item, not
nested under Properties. Built `/tenants` as an org-wide list, same direct-RLS-read pattern as
`/properties` itself.

Noticed while reading `packages/validation/src/leasing.ts` that `tenantSchema` deliberately
excludes `status` from client input (server-set only, defaults `pending`, transitions on lease
approval/expiry) — the form correctly has no status field at all, not a disabled/read-only one,
since there's nothing for a user to ever legitimately submit there yet.

Reused the `PageLoading` skeleton component built for Units rather than duplicating it.

**Full verification**: `pnpm --filter admin typecheck`/`lint`/`test` (39/39 passed, up from 36) and
`pnpm --filter @propvault/ui typecheck` clean; real clean `next build` registered all 4 new routes;
runtime smoke test via `next start` in demo mode covering `/tenants`, `/tenants/demo-tenant-1`,
`/tenants/new`, `/tenants/demo-tenant-1/edit` — all 200, response bodies grepped for real content
(tenant name/email/status, form field labels). Server process confirmed via
`Get-CimInstance Win32_Process` before stopping, same discipline as every prior port-owning process
this session.

## 2026-08-01 (continued, 6) — M20: Units vertical slice (second module, same pattern as Properties)

Continued M20 per Mohammed's instruction to build Units/Tenants/Leases/Maintenance one module at
a time, same vertical-slice approach proven by Properties. Reused the M6 Units API and
`apps/admin/lib/portfolio.ts`'s `mapUnitRow`/`requireOrgRole` unchanged — no new backend logic,
this is UI-layer work end to end.

Checked `PROPVIEW_SCREENSHOT_AUDIT.md` before designing the navigation rather than inventing a
structure: the reference product's own sidebar has Units as its own top-level PORTFOLIO nav item
(not only reachable through a property), with a KPI row ("0 Units / 0 Occupied / 0 Vacant") and a
"No units yet" empty state pointing back at Properties (units are created from a property, no
top-level bulk-create). Built both: an org-wide `/units` list (KPI row + table, direct RLS-scoped
read joined against `properties` for the nickname column — no `GET /api/v1/units` endpoint exists,
`API_SPEC.md` only has the property-scoped list/create, same "plain RLS-protected read" pattern
the Properties page itself already uses) and a per-property embedded Units section on the property
detail page (list, natural context, "+ Add unit" role-gated). Detail, create, and edit pages
follow at `/properties/:id/units/:unitId[/edit]`, sharing one `UnitForm` component between create
and edit exactly the way `NewPropertyForm` established the field/error convention.

Added `UNIT_STATUS_PRESENTATION` to `packages/ui/src/statusPresentation.ts` (vacant/occupied/
maintenance), following `BILL_STATUS_PRESENTATION`'s exact shape — no unit-status presentation
existed yet.

**Loading state, a small step beyond the Properties precedent**: Properties' own vertical slice
didn't ship a `loading.tsx` for any of its routes (it predates the explicit per-module
loading-state requirement in Mohammed's later instruction). Built a shared `PageLoading` skeleton
and added `loading.tsx` to the three data-fetching routes this slice touches (units list, property
detail, unit detail) — small, self-contained, and consistent with the instruction actually
received for this pass rather than merely copying the earlier precedent verbatim.

**Real, small test-infrastructure gap found and fixed**: `UnitsTable.test.tsx` is the first
component test in this codebase to exercise a component that itself imports `@/...`-aliased
modules (`AdminDataTable`, `StatusBadge`). `apps/admin/vitest.config.ts` only aliased
`server-only` — Vite/Vitest doesn't read `tsconfig.json`'s `paths` on its own, so the test failed
module resolution until a `@` alias (mirroring `"@/*": ["./*"]`) was added to `vitest.config.ts`.
Every existing admin test used only relative imports, so this gap was real but latent until now.

**Real test-assertion bug in my own test, not the component**: first `pnpm --filter admin test`
run failed on `expect(screen.getByText('R12,500'))` — `Number.prototype.toLocaleString('en-ZA')`
groups thousands with a space (ZA convention), not a comma, so the component's rendered output
(`R12 500`) was correct and the test's assumption was wrong. Fixed the assertion to a loose regex
rather than hardcoding the exact whitespace character Node's ICU data produces.

**Full verification**: `pnpm --filter admin typecheck`/`lint`/`test` (36/36 passed, up from 32) and
`pnpm --filter @propvault/ui typecheck` all clean; a real clean `next build` (`.next` removed
first) registered all 6 new/changed routes with no errors; runtime smoke test via `next start` in
demo mode (`NEXT_PUBLIC_DEMO_MODE`/`ALLOW_DEMO_MODE` both set, plus placeholder Supabase env vars —
the build's Zod env-schema validation requires them present even in demo mode, a real gap from the
first attempt's 500s that placeholder values resolved) covering `/properties`,
`/properties/demo-property-1`, `/properties/demo-property-1/units/demo-unit-1`,
`/properties/demo-property-1/units/new`, `/properties/demo-property-1/units/demo-unit-1/edit`,
`/units` — all 200, response bodies grepped for real rendered content (unit rows, KPI values, form
field labels), not just status codes. Server process (PID confirmed via
`Get-CimInstance Win32_Process` before stopping, matching this session's established
verify-then-stop discipline for any process on a shared port) stopped cleanly afterward.

## 2026-08-01 (continued, 5) — M22: Android toolchain verified end-to-end, real native project foundation + first vertical slice, built and run on an emulator

Mohammed confirmed Android Studio was installed and instructed a full, unassuming verification of
every toolchain component before building anything, then a real native `apps/android` project
(separate from `apps/mobile`, never converted from it) with a first verified vertical slice, proven
by actually compiling, testing, installing, and running it — not just scaffolding files.

**Toolchain inspection** (nothing assumed): Android Studio and an SDK directory existed, but
`cmdline-tools` (needed for `sdkmanager`/`avdmanager`) was missing entirely and no AVD existed.
Installed `cmdline-tools` from Google's official zip; used `avdmanager` to create
`PropertyVault_Pixel7_API35` (no Pixel 8 profile exists in this cmdline-tools version's device
list — Pixel 7 is the newest available). Full component-by-component findings (SDK platforms,
build-tools, platform-tools, emulator, system images) recorded in `apps/android/README.md`'s
toolchain table rather than repeated here.

**Real, reproduced JDK incompatibility**: attempted to use Android Studio's bundled JBR (OpenJDK
25.0.2) for Gradle, per Mohammed's "use the bundled JDK where practical" instruction — every Gradle
invocation failed immediately with `java.lang.IllegalArgumentException: 25.0.2` inside Gradle 8.7's
own Kotlin-DSL-script-evaluation tooling (confirmed via `--stacktrace`, not guessed). Installed
Eclipse Temurin 21 LTS and pointed Gradle at it via `org.gradle.java.home` in the machine-local
`~/.gradle/gradle.properties` — deliberately not a system-wide `JAVA_HOME`, per the explicit
instruction to prefer project-local configuration over system-wide env-var changes. Full reasoning
in `DECISIONS.md` 2026-08-01.

**Built the project foundation**: Gradle Kotlin DSL scripts, version catalog, Compose Material 3
theme hand-transcribed from `packages/ui/src/tokens.ts` (light/dark, typography, shape), Navigation
Compose skeleton, Hilt DI, Retrofit/OkHttp/kotlinx.serialization network client against Supabase
Auth + PostgREST directly, Room (Properties read-through cache), EncryptedSharedPreferences session
storage, `local.properties`-based config (no secrets committed — gitignored, `.example` template
committed instead), unit- and instrumentation-test scaffolding.

**Built the first vertical slice**: Auth shell (splash/session-restore, sign-in, sign-out) + Owner
portal (bottom nav, Dashboard placeholder, Properties list, Property detail) with loading/empty/
error states and a cached-data-banner foundation, each behind a `PropertiesRepository`/
`AuthRepository` interface with a real implementation and a separate mock implementation (selected
via `BuildConfig.USE_MOCK_DATA`), matching the mock-first provider pattern already used for email/
WhatsApp/AI/document-intelligence elsewhere in the project. Verified against the real PropertyVault
API surface and property model/validation rules, not Android-only business rules.

**Two real bugs found and fixed while getting the first build green** (full narrative in
`DECISIONS.md` 2026-08-01): Android XML comments rejecting `--` (this session's comment style
everywhere else), and an external Retrofit/kotlinx.serialization converter library that resolved
correctly on both classpaths (confirmed via `gradlew app:dependencies`) yet produced a persistent
unexplained "Unresolved reference" surviving a full clean/daemon-restart cycle — replaced with a
~30-line hand-rolled `Converter.Factory` on kotlinx.serialization's own JVM-reflection bridge rather
than continue debugging an opaque toolchain issue.

**Full verification, real command output for every step**:
- `gradlew assembleDebug` — BUILD SUCCESSFUL, 20,638,661-byte `app-debug.apk` confirmed on disk.
- `gradlew testDebugUnitTest` — BUILD SUCCESSFUL, 7/7 tests passed (XML result files inspected).
- `gradlew lintDebug` — BUILD SUCCESSFUL, 0 errors / 55 warnings.
- `PropertyVault_Pixel7_API35` emulator booted, confirmed via `adb shell getprop sys.boot_completed`.
- `adb install -r` + `adb shell am start`, confirmed via `logcat`: "Displayed
  com.propertyvault.app/.MainActivity ... +21s260ms", no crash.
- Real screenshots pulled off the device and visually reviewed: sign-in screen, mock sign-in
  navigating to Dashboard, Properties list showing the mock "Sea Point Apartment" fixture, Property
  detail with working back-navigation, light mode, and dark mode (`adb shell cmd uimode night yes`
  — confirmed the exact `#14161A` dark-surface token from `packages/ui`).
- Along the way, found and fixed two bugs in my own verification process, not the app: ADB
  screenshot paths mangled by Git Bash's automatic POSIX-path conversion (fixed with
  `MSYS_NO_PATHCONV=1` and plain relative destination paths), and a scaled-screenshot tap-coordinate
  bug (displayed images were 1.2x smaller than real device pixels; taps computed directly from the
  displayed image landed in the wrong place until the 1.2x factor was applied).

**Not claimed complete**: M22 is explicitly not marked done. Remaining `NATIVE_ANDROID_SPEC.md`
scope (Units, Tenants, Leases, Maintenance, remaining Owner tabs, Tenant portal, biometric
`BiometricPrompt` wiring, deep links, push notifications, tablet/foldable adaptive layout, the
cross-platform design-token codegen step) is specification only, tracked in `TASKS.md` M22 for the
same one-module-at-a-time vertical-slice approach used here. Updated `TASKS.md`, `apps/android/
README.md`, and `DECISIONS.md`; nothing in `apps/android/` committed yet at the point this entry was
written — commits follow immediately after, in small focused batches, per Mohammed's instruction.

## 2026-08-01 (continued, 4) — Route-group rename completed, a real build bug caught

Mohammed confirmed the `next dev -p 3005` process was safe to stop and instructed it directly.
Re-queried live process PIDs (they'd changed since first discovered), confirmed the exact
4-process tree for this instance by command line, stopped only those, explicitly left 6 unrelated
`node`/`vite` processes for other projects on the machine untouched. Confirmed port 3005 no longer
listening.

With the lock cleared, completed the rename: `(dashboard)`→`(super-admin)` (Super Admin, M19),
`(portal)`→`(dashboard)` (client-org, M20) — both succeeded on the first attempt. Updated every
stale `(portal)`/"blocked on a lock" comment across `layout.tsx` (both), `middleware.ts`, and the
Properties pages.

**Real bug caught by actually running the build, not just typecheck/lint**: `middleware.ts`'s
`config.matcher` (refactored last session to `PROTECTED_ROUTE_PREFIXES.map(...)` to avoid
duplicating the route list) is valid TypeScript but fails Next.js's build-time static analysis --
`matcher` must be a literal array. `pnpm typecheck` never catches this (it's not a type error), and
neither would `pnpm lint`; only a real `next build` surfaces it. Fixed by reverting to a literal
array, kept the computed list for the runtime check only. Also hit a stale `.next/types/
validator.ts` referencing pre-rename paths on the first `pnpm typecheck` after the rename --
cleared `apps/admin/.next` and re-ran clean, expected cache staleness after a route-group rename,
not a real bug.

**Full verification, in order**: `pnpm typecheck` (7/7, clean after the cache clear), `pnpm lint`
(7/7), `pnpm --filter admin test` (32/32), real `next build` (clean after the matcher fix -- every
route including `/properties/**` registered under its correct new path), runtime smoke test via
`next start` covering `/overview`, `/customers`, `/subscriptions`, `/properties`,
`/properties/demo-property-1`, `/properties/new` -- all 200, response bodies grepped for real
content (not just status codes) to confirm each page actually renders what it should, not just
that it doesn't crash.

## 2026-08-01 (continued, 3) — M20 kickoff: first client-org page (Properties), and a live dev-server found

Continuing per Mohammed's "continue." Started M20 (Responsive Web) with Properties as the first
complete vertical slice: `(portal)` layout (org-membership auth via `resolvePortalSession()`,
distinct from `(dashboard)`'s platform-admin auth), list/detail/create pages, `PropertiesTable`,
`NewPropertyForm`.

**Real architectural finding**: `ARCHITECTURE.md` names the client-org route group
`(dashboard)` and the Super Admin group `(super-admin)` — the reverse of what M19 actually built
(Super Admin ended up at `(dashboard)` because `SUPER_ADMIN.md` §0 said "reused from apps/admin
as-is" without flagging the naming mismatch, and that was accepted at the time). Attempted the
correct fix (`git mv (dashboard) (super-admin)`) and hit `Permission denied` — investigated rather
than forcing it, and found a `next dev -p 3005` process holding a live file-watcher lock on that
exact directory, with a command line showing it was launched independently of anything this
session started. Did not kill it (an unfamiliar running process that might be Mohammed's own live
preview session is not this session's to terminate) and did not force the rename. Built the new
client-org pages under `(portal)` instead — a pure internal-organization deviation, since Next.js
route group names never appear in the URL — with the proper `(dashboard)`→`(super-admin)` rename
left as a documented follow-up for whenever that lock is confirmed clear.

**Consequence for verification discipline this batch**: realized the same `next dev` process has
likely been running for the entire session, meaning every earlier `pnpm --filter admin build`/
`next start` smoke-test call (M16 through the design phase) may have been racing against it on the
shared `.next` directory. Flagged this directly to Mohammed rather than continuing to run
build/start commands that could interfere further. This batch's verification is `pnpm typecheck`/
`pnpm lint`/`pnpm --filter admin test` only (all clean, none of which touch `.next`) — a real,
disclosed reduction in verification coverage for this specific commit, not silently glossed over.

`middleware.ts`'s route-prefix list refactored to one shared array driving both the runtime check
and the matcher config, so future `(portal)` routes can't silently miss the auth gate the way two
independently-maintained lists risked.

## 2026-08-01 (continued, 2) — Design phase: review, design system rewrite, native platform specs, first implementation slice

Per Mohammed's explicit instruction after M19: paused new feature implementation for a complete
design review before continuing.

**`DESIGN_REVIEW.md`**: re-opened `IMG_7990.JPG`/`IMG_8023.JPG` from `reference/propview-screenshots/`
directly to confirm `PROPVIEW_SCREENSHOT_AUDIT.md` §5's existing extraction against real pixels,
then compared against the two Envato "Property Mobile App UI Kit" listings Mohammed pasted
in-conversation. Both Envato kits are consumer real-estate marketplace apps — confirmed explicitly
out of scope for information architecture/user journeys (PropertyVault manages portfolios, it
doesn't sell listings), extracted only as component-level visual inspiration (shadow/radius
execution, dark-theme contrast). Produced a per-pattern reuse/modernize/simplify/improve table and
role-specific experience definitions (Owner/Tenant/Staff/Super Admin) grounded in the real API
surface built through M19.

**Native platforms — asked before assuming**: confirmed via `MOBILE_ARCHITECTURE_DECISION.md`
that zero native code exists in this repo, and this session's environment has no Xcode (macOS-only
requirement) or confirmed Android toolchain. Asked Mohammed directly rather than guessing whether
to (a) spec-only, (b) write best-effort unverified source anyway, or (c) skip native platforms
entirely — a real fork where a wrong guess costs either wasted unverifiable code or an
under-delivered milestone. Answer: spec-only, explicitly not a way of skipping native work.
Produced `NATIVE_IOS_SPEC.md`/`NATIVE_ANDROID_SPEC.md` to the full depth requested — navigation
architecture, screen hierarchy, component mapping, HIG/Material-3 compliance, state management,
offline behaviour (implementing `MOBILE_ARCHITECTURE_DECISION.md` §9 per platform), accessibility,
animations, notifications (mapped 1:1 to `WHATSAPP.md` §2's 16-value closed type list — one
server-side dispatch decision fans out to WhatsApp/push/email, no native-only taxonomy invented),
deep links, biometric auth, and tablet/foldable behaviour — written so a future session with real
Xcode/Android Studio tooling needs minimal redesign, not as a lesser substitute for the real apps.

**`DESIGN_SYSTEM.md`** rewritten from its Phase-1/single-owner-era version into the component-level
single source of truth the review calls for: buttons, cards, tables, forms, modals, alerts, empty/
loading/error states, responsive rules — all grounded in `packages/ui/src/tokens.ts` (unchanged)
and the primitives that already exist in `apps/admin/components/ui/`.

**First real implementation slice** (web/PWA, continued in parallel per Mohammed's instruction,
not deferred until the whole design phase finished): `Button`/`EmptyState` components (unit
tested). While extending `statusPresentation.ts` to cover `OrganizationStatus`, found a real, live
display bug: `CustomersTable.tsx`'s inline colour map was still keyed on the old PropVault-era
subscription vocabulary, so every M19-introduced `OrganizationStatus` value except two
coincidentally-matching names would have rendered unstyled. Fixed with
`ORGANIZATION_STATUS_PRESENTATION` + a new shared `StatusBadge` component, wired into
`CustomersTable`/`SubscriptionsTable`/the organization detail page. `OrganizationActionsPanel`
(new client component) wires M19's activate/suspend/archive/credits endpoints into the
organization detail page for the first time — the first real UI built against that milestone's
API layer, role-gated for display (server-side `requireRole()` remains the actual enforcement).

**Verified, in order**: full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages) after each
implementation slice. `pnpm --filter admin test` — 32/32 (up from 26/26, +6 new: Button, EmptyState).
Real `next build` — clean, no new route conflicts (no new API routes this pass, only pages/
components). Runtime smoke check (`next start`, demo mode): `/overview`, `/customers`,
`/customers/[id]`, `/subscriptions` all return 200, including through the new StatusBadge
fallback path for demo mode's legacy status vocabulary.

## 2026-08-01 (continued) — M19: Super Admin — rename, directory/billing/support-session API, two real bugs found

Continuing autonomously per Mohammed's explicit instruction to complete M19 fully against `SUPER_ADMIN.md`/`API_SPEC.md`/`TASKS.md`, then pause for a design phase before further UI work.

**Rename** (migration `20260101000044`): `admin_users`→`platform_admin_users`, `is_admin()`→`is_platform_admin()`, plus `support_access_sessions.admin_user_id`→`platform_admin_id` (a real mismatch against `SUPER_ADMIN.md` §6's own documented column name, found and fixed in the same pass). All ~9 `apps/admin` call sites and 2 pgTAP fixture files updated. `AdminSession`/`DemoAdminSession` gained an `id` field (the `platform_admin_users` row PK, distinct from `authUserId`) — needed because `support_access_sessions.platform_admin_id` references that PK, not `auth.users.id`, and nothing had previously needed to carry it. Touched `apps/admin/lib/demo/adminMockData.ts` for this, which had unrelated pre-existing uncommitted cosmetic edits (demo-persona name swaps) already in the working tree — added the field surgically via `Edit`, not `Write`, to avoid disturbing those.

**Client directory / billing / support-session data layer**: `apps/admin/lib/superAdmin.ts` — `listPlatformOrganizations()` (with a real fix for a pagination bug caught before it ever shipped: an earlier draft filtered by plan code *after* the paginated query ran, which would have silently truncated pages when combined with a plan filter; fixed by resolving matching org ids at the SQL level first), `getPlatformOrganizationDetail()`, `computePlatformMetrics()` (live-computed, not read from a snapshot — see below), `updateOrganizationStatus()`. New SQL function `admin_organization_counts()` (migration `20260101000045`) for batched per-org properties/units/owners/tenants/staff counts, avoiding N+1 across a paginated directory page — applied the `resolve_whatsapp_sender()` EXECUTE-grant lesson proactively this time: revoked `EXECUTE` from `anon`/`authenticated` in the same migration it was created in, with a pgTAP regression test proving it, rather than finding the gap after the fact.

**`apps/admin/lib/audit.ts`**: the first real `audit_events` writer in the whole codebase — every prior mutating endpoint either predates M18's TD-14 schema cutover or was built after it without being wired up yet. Every mutating Super Admin route now writes a real audit row.

**12 new API routes** under `/api/v1/admin/**`, matching `API_SPEC.md` §2's exact ratified list (organizations list/detail, activate/suspend/archive, plan, credits, usage/usage-reset, support-sessions start/end, plans list/create) — deliberately did not build the extra endpoints `SUPER_ADMIN.md` §4 suggests but `API_SPEC.md` never ratified (payments-history, audit-history, resend-onboarding), matching this session's consistent discipline of building to the spec's closed list.

**Two real, pre-existing bugs found and fixed** while wiring these endpoints, both in already-shipped schema: `plans` (migration 019, M9-era) had a contradictory column-level `unique` on `code` alongside the table-level `unique(code, version)`, making the documented plan-versioning design impossible — fixed via migration `20260101000046` after confirming the exact constraint name live, both before and after the fix. `packages/types/src/enums.ts`'s `ORGANIZATION_STATUSES` was missing `'archived'` even though the Postgres enum gained it back on 2026-07-31 — the TS mirror had silently drifted from the DB. Full narrative for both in `DECISIONS.md` 2026-08-01.

**Rebuilt `customers/page.tsx`/`CustomersTable.tsx`, `customers/[id]/page.tsx`, `subscriptions/page.tsx`/`SubscriptionsTable.tsx`, `overview/page.tsx`** to read organizations/`organization_subscriptions`/`plans` instead of individual `profiles`/the old per-user `subscriptions` table — `SUPER_ADMIN.md`'s own explicit "not reused" list. This also resolves `TECHNICAL_DEBT_REGISTER.md` TD-16 / `RISK_REGISTER.md` R-21's real, previously-deferred bug for these two files specifically (the old `owner_user_id` query silently undercounted every org's properties) — the milestone's own mandated scope was the authorization that bug fix had been waiting on, not a separately-sought go-ahead; full reasoning in `DECISIONS.md`. `processing/page.tsx`/`adminMockData.ts` (same file family, never in M19's scope) were deliberately left untouched. Demo mode kept exactly as-is on all four pages — cosmetic-only, not the real data path these fixes target.

**Deliberately left open**: support-mode's actual "read-only by default, escalation per write" data-scoping enforcement has no client-org-facing UI to attach to yet (that's M20, not started) — building it now would be speculative infrastructure with no real caller, the same judgment already applied to TD-18/TD-21. Account-recovery workflow needs its own identity-verification design (`SUPER_ADMIN.md` §7.6). Churn rate excluded from `computePlatformMetrics()` per §7.2's own flag. Both new gaps logged as `TECHNICAL_DEBT_REGISTER.md` TD-24 (live metrics vs. a snapshot table — deliberately not built yet, same reasoning as TD-20) and TD-25 (support-mode enforcement, blocked on M20).

**Verified, in order**: fresh `supabase db reset` — 46/46 migrations clean. Full pgTAP suite — **176/176 assertions across 13 files** (new `super_admin_schema.test.sql`, 9 assertions: the rename, the EXECUTE-grant regression, both bug-fix regressions — hit the same recurring `throws_ok` 3-arg-treats-third-arg-as-message mistake yet again on first run, fixed the same way as every previous time). Full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages) — clean on the first pass, no new findings. `pnpm --filter admin test` — 26/26 unchanged (all new logic this milestone is DB-dependent, covered by pgTAP rather than vitest). Real `next build` — 12 new admin routes, no conflicts. Runtime smoke check via `next start` in demo mode: `/overview`, `/customers`, `/customers/[id]`, `/subscriptions` all return 200 with sensible rendered content. Live-mode branches verified via typecheck + pgTAP + code review, not an end-to-end browser click-through against real org data — no such click-through exists for any admin page in this session, a consistent scope boundary rather than a gap specific to this milestone. Stopped the local Supabase instance cleanly afterward.

## 2026-08-01 — M18: AI (Conversational Assistant + Portfolio Intelligence), and the TD-14 audit_events cutover

Continuing autonomously per Mohammed's "continue until something genuinely requires your decision" instruction. Built the achievable slice of M18: schema, the full staging/confirm pipeline for the Conversational Assistant, the Portfolio Intelligence rules engine, and usage metering/cap enforcement — leaving LLM vendor selection (`AI_ARCHITECTURE.md` §3, open decision) and actual job scheduling (no cron infrastructure exists yet, `TECHNICAL_DEBT_REGISTER.md` TD-20) correctly open, matching the pattern already used for OCR/M12, tenant screening/M9, and email+WhatsApp/M16-M17.

**Schema** (migration `20260101000042`, `DATABASE.md` §7-8): `ai_conversations`, `ai_messages`, `portfolio_insights`, `usage_events`, `usage_snapshots`. Conversations/messages are owner-scoped, not org-shared (RLS checks `user_id = auth.uid()`, not just org membership) — a chat may contain sensitive free-text, unlike org-shared tables like announcements. Portfolio insights are select-for-org-staff, dismiss-for-org-staff, insert-only-by-service-role (the rules engine). Usage tables are select-for-org-staff, write-only-by-service-role.

**TD-14 paydown, forced by this milestone's own requirement**: `AI_ARCHITECTURE.md` §5 requires `audit_events.actor_type = 'ai_assisted'` plus `ai_conversation_id`/`ai_message_id` pointers, which the live schema (open since 2026-07-30, `customer|admin|system` actor_type, `target_type`/`target_id`, `owner_user_id`) could not represent at all — not a stylistic gap, a hard blocker. Rather than invent a workaround, did the real cutover now (migration `20260101000043`): confirmed zero real writers existed anywhere in TS first (a pure schema change, no data-migration risk), rewrote to `DATABASE.md` §10's exact target shape, and fixed the one real blast-radius hit it caused — `accounting_core.test.sql`'s own audit_events fixture used the old columns/enum value and needed updating to match (caught immediately by the first `supabase test db` run: "column target_type does not exist"). Deliberately left the two now-unblocked call sites (`reopen_accounting_period()`, `POST /api/v1/organizations`) unwired, to keep this migration a schema change only, not also a re-open-and-re-verify pass over M5/M14's already-shipped route code. Full narrative and reasoning in `DECISIONS.md` 2026-08-01.

**Conversational Assistant** (`AI_ARCHITECTURE.md` §1): `assembleOrgContext()` (`apps/admin/lib/ai.ts`) runs every read through the acting user's own session-bound Supabase client, never service-role — batches primary-tenant-name lookups across rent schedules and expiring leases in one query rather than N+1. `POST /api/v1/ai/conversations`, `.../conversations/:id/messages`, `POST /api/v1/ai/messages/:id/confirm` implement the full stage-then-confirm flow. The confirm step's spec language ("re-enter the endpoint in-process, as the acting user") doesn't map cleanly onto Next.js's route-handler model, since there's no clean in-process call across route-file boundaries — realized instead as a same-origin `fetch()` forwarding the caller's own session cookie, so the target route's own auth resolution produces the identical `auth.uid()`/role check a human hitting that endpoint would face. Added a proactive security control not explicitly requested by the architecture doc: `isValidStagedEndpoint()` requires a staged change's `endpoint` (LLM-produced output) to match a strict `/api/v1/...`-only pattern before the confirm route is allowed to fetch it, closing an SSRF/open-redirect vector a future prompt-injected model response could otherwise exploit. `MockLLMProvider` (`apps/admin/lib/providers/llm.ts`) gives deterministic, keyword-matched replies for the three evidenced prompt chips ("How's my portfolio?", "What's overdue?", "Record an expense") — enough to exercise the full staging/confirm pipeline end-to-end without a real model.

**Portfolio Intelligence** (`AI_ARCHITECTURE.md` §2) — explicitly not an LLM, zero model calls anywhere in its code path. `reconcilePortfolioInsights()` (`apps/admin/lib/portfolioIntelligence.ts`) evaluates all 5 evidenced rule types (rent overdue, rent due soon, lease expiring, maintenance open, invoice unpaid) as fixed SQL predicates, computes severity via §2.4's deterministic thresholds, and reconciles against existing rows by a natural key (`insight_type:triggering_record_id`) — inserting newly-triggered conditions, updating severity/message on ones still triggering (severity is time-dependent: days-overdue grows daily), and auto-dismissing ones that no longer trigger, so the feed never shows a stale insight. This is a real, tested rules engine with no caller yet — no scheduled-function infrastructure exists anywhere in this codebase (the same gap `TECHNICAL_DEBT_REGISTER.md` TD-20 already documented for rent-schedule generation), so wiring an actual Edge Function schedule is left open, folded into TD-20 rather than filed as a new, disconnected debt item, since it's the same missing piece of infrastructure surfacing in a third place (rent-schedule generation, Portfolio Intelligence, usage-snapshot rollup).

**Usage metering + cap enforcement** (`AI_ARCHITECTURE.md` §4): every conversation turn with non-zero token cost records a `usage_events` row (service-role write, matches `audit_events`'/`usage_events`' established "server-side subsystems only" pattern) as best-effort telemetry (a metering-write failure is logged, not thrown — it must never fail a chat turn that already succeeded). `checkAiUsageCap()` sums the org's current-calendar-month `ai_token` usage against `plans.feature_limits.aiMonthlyTokenCap` before calling the LLM provider, matching §4's exact enforcement-point requirement — sums `usage_events` directly rather than reading `usage_snapshots`, since the rollup job that would populate snapshots doesn't exist yet either (same TD-20-class gap). No plan has a real cap number configured (that's a pricing decision, not invented here), so the enforcement code path is real and tested but currently a no-op.

**Tests**: new `supabase/tests/ai_and_usage_isolation.test.sql` (19 assertions — ai_conversations/ai_messages owner-only isolation including the cross-member-same-org case, portfolio_insights/usage_events/usage_snapshots server-only-write + org-scoped-read, and the audit_events cutover's shape confirmed live via `information_schema` rather than assumed). New `apps/admin/lib/providers/__tests__/llm.test.ts` (4 assertions) and `apps/admin/lib/__tests__/ai.test.ts` (4 assertions, the SSRF-guard function).

**Verified, in order**: fresh `supabase db reset` — 43/43 migrations clean (one `LegacyHealthCheckTimeoutError` on the storage container, retried successfully on the first attempt, consistent with the transient/retry-recoverable finding from earlier this session). First `supabase test db` run caught the `accounting_core.test.sql` fixture break described above (7 of 21 assertions failed with a real Postgres error, not a flaky test) — fixed, re-ran clean. Full pgTAP suite — **167/167 assertions across 12 files**, zero other regressions. Full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages) — one real `no-unused-vars` catch (a leftover `today` variable in `assembleOrgContext()`) fixed by actually using it as the missing lower bound on the "rent due this week" query, not by deleting it, since the missing bound was itself a minor correctness gap (a `pending` schedule with a past due date would have wrongly counted as "due this week"). `pnpm --filter admin test` — 26/26 (up from 18/18). Real `next build` — clean, 5 new routes registered (`/api/v1/ai/conversations`, `.../[id]/messages`, `/api/v1/ai/messages/[id]/confirm`, `/api/v1/insights`, `/api/v1/insights/[id]/dismiss`), no conflicts. Stopped the local Supabase instance cleanly afterward.

**Not started, correctly left open**: LLM vendor selection (`AI_ARCHITECTURE.md` §3); actual scheduling for Portfolio Intelligence's Edge Function and the usage-snapshot rollup job (TD-20); wiring `reopen_accounting_period()`/`POST /api/v1/organizations`'s now-unblocked audit writes (TD-14, narrowed not closed).

## 2026-07-31 (continued, 9) — M16/M17: Email + WhatsApp (mock-provider path), and two security findings

Continuing autonomously per Mohammed's "continue until something genuinely requires your decision" instruction. Built the achievable slice of both milestones — schema, resolution algorithm, provider interfaces, mock providers — leaving vendor accounts, webhook signature verification, OTP-verification design, and dispatcher wiring explicitly open (all correctly out of reach without a real vendor account or an undesigned flow, matching the pattern already used for OCR/M12 and tenant screening/M9).

**Schema** (migration `20260101000040`, `DATABASE.md` §7): `email_messages`, `email_suppressions`, `whatsapp_messages`, `verified_phone_numbers`, `whatsapp_conversation_state`. All five: org-staff SELECT only where org-scoped, zero client write policy — writes are server-only via `service_role`. `verified_phone_numbers`/`whatsapp_conversation_state` have RLS enabled with zero policies at all (deny-all by design, since resolution must be server-side only).

**Resolution algorithm**: `resolve_whatsapp_sender(p_phone_number_e164)`, a `security definer` function implementing `WHATSAPP.md` §1.2's three branches (0 matches = unauthenticated, 1 = resolved, 2+ = ambiguous). Verified against a real fixture where the same number is verified to both a tenant and an owner record (the actual ambiguous case), not assumed from the single-match path.

**Security finding #1, found and fixed before the migration was ever committed**: checked the function's actual grants live (`select grantee, privilege_type from information_schema.role_routine_grants where routine_name = 'resolve_whatsapp_sender'`) rather than trusting migration 024's project-wide default-privilege grant was safe here — it wasn't. Both `anon` and `authenticated` had `EXECUTE`, meaning any client, authenticated or not, could look up which org/tenant/owner owns any phone number. This function's input (a bare phone number) isn't scoped to the caller's own identity the way `has_org_role()`'s org-membership check is, so the blanket grant was a real cross-tenant information-disclosure hole. Fixed with `revoke execute on function public.resolve_whatsapp_sender(text) from public, anon, authenticated;` in the same migration, plus a regression test proving `authenticated` now gets `42501 permission denied`. Logged as `RISK_REGISTER.md` R-23 (Mitigated) and `DECISIONS.md` 2026-07-31, since this names a vulnerability *class* (unscoped-input security-definer functions need grants checked explicitly) worth remembering for any future function of this shape.

**Security finding #2, self-initiated**: while reviewing finding #1, re-checked the session's other `security definer` functions against the same pattern and found a related, lower-severity gap in already-shipped code — `reverse_journal_entry()` (migration 035) ran its `accountant`-role check *after* branching on the target entry's `reversed_by_entry_id`/`is_reversal` state, letting an accountant-level caller in any org distinguish a foreign org's entry's existence/state via the exception message (low severity: requires guessing a UUID, discloses no entry data, only state). Fixed via new migration `20260101000041` (`CREATE OR REPLACE FUNCTION`, since 035 is already committed) — the authorization check now runs immediately after "not found," before any state-dependent branch. Logged as `RISK_REGISTER.md` R-24 (Mitigated).

**Provider layer**: `EmailProvider`/`MockEmailProvider` (`packages/types/src/email.ts`, `apps/admin/lib/providers/email.ts`) — the mock always returns `status: 'queued'`, never simulates further progression, matching `EMAIL.md`'s rule that delivery status is read as proof, not assumed. `WhatsAppProvider`/`MockWhatsAppProvider` (`packages/types/src/whatsapp.ts`, `apps/admin/lib/providers/whatsapp.ts`) — deterministic synchronous responses; deliberately did not implement `WHATSAPP.md` §5's timer-based lifecycle simulation, since no webhook route or scheduled job consumes it yet. Also added the full closed `WhatsAppNotificationType` enum (16 values, `packages/types/src/enums.ts`) matching `WHATSAPP.md` §2 exactly.

**Test-infrastructure fix**: this was the first time in the session a `server-only`-guarded file was unit tested directly. The real `server-only` package unconditionally throws under plain Node import resolution — only Next.js's webpack build substitutes a no-op for genuine server bundles, and Vitest has no equivalent substitution. Fixed with a project-wide, reusable `resolve.alias` in `apps/admin/vitest.config.ts` pointing `server-only` at a new empty stub (`apps/admin/test/server-only-stub.ts`), rather than weakening the real guard or skipping the tests — this unblocks unit-testing any future server-only lib file, not just these two.

**Tests**: new `supabase/tests/email_whatsapp_isolation.test.sql` (12 assertions — all 3 resolution branches, the EXECUTE-revoke regression test, zero-client-write/cross-org isolation on all five new tables). New `apps/admin/lib/providers/__tests__/{email,whatsapp}.test.ts` (5 assertions total).

**Verified, in order**: fresh `supabase db reset` — 41/41 migrations clean. Full pgTAP suite — 148/148 assertions across 11 files, zero regressions. Full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages). `pnpm --filter admin test` — 18/18 (up from 13/13, after the `server-only` alias fix). Real `next build` — clean, no route conflicts (no new API routes this pass). Stopped the local Supabase instance cleanly afterward.

**Not started, correctly left open**: fixed trigger-list dispatcher (`WHATSAPP.md` §2) wiring product events to the notification types; OTP-verification flow populating `verified_phone_numbers` (flagged "not yet designed" in `WHATSAPP.md`'s own Unresolved section); send-triggering wiring for email; real vendor accounts for both (external-service blocker, `RISK_REGISTER.md` R-04); webhook signature verification (mock always "verifies," a real implementation must do genuine HMAC verification per `WHATSAPP.md` §4).

## 2026-07-31 (continued, 8) — M15: Notifications, and a cross-milestone RLS gap found

Continuing autonomously. Built `notifications`, `notification_preferences`, `device_push_tokens`, `announcements`, `announcement_reads` (migration `20260101000039`, `DATABASE.md` §7) and the corresponding API surface.

**Real gap found and fixed on first test run**: the announcements tenant-visibility policy needs to check whether the calling tenant leases the announcement's property, which requires reading through `lease_tenants`/`leases`/`units`. Those tables were built agent+-only in M10, since no tenant-facing read need existed at the time — there is no tenant-self RLS branch on them. A raw subquery in the announcements policy therefore silently returned zero rows for every tenant caller (RLS on the intermediate tables blocked it before the join logic ever ran), failing 3 of 4 tenant-visibility assertions on first run. Fixed with a new `security definer` function, `tenant_can_view_property_announcement()` — the exact same shape of fix `has_org_role()` itself is: read cross-table as the function owner, bypassing RLS on tables the caller has no direct policy for, while still checking `auth.uid()` for the real authorization. Verified the fix correctly distinguishes portfolio-wide vs. property-scoped announcements across two tenants leasing different properties, not just a single trivial case.

**Same recurring pgTAP-authoring mistake, again**: fixture UUIDs (`no000000...`) used non-hex characters (`n`, `o`) — the third time this exact class of typo has been caught by running the test rather than avoided by remembering it from the first two. Also hit the already-learned `throws_ok` 3-argument-treats-third-arg-as-message issue again and fixed it the same way (2-arg form).

**Verified, in order**: full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages). Fresh `supabase db reset` — 39/39 migrations clean (including one `LegacyHealthCheckTimeoutError` on the storage container, retried successfully on the first attempt — consistent with the transient/retry-recoverable finding from earlier this session). Full pgTAP suite — 136/136 assertions across 10 files, zero regressions. `pnpm --filter admin test` — 13/13 unchanged. Real `next build` — 6 new routes registered, no conflicts. Stopped the local Supabase instance cleanly afterward.

## 2026-07-31 (continued, 7) — M14 part 2: subledgers and four posting operations

Continuing autonomously per Mohammed's "continue until something genuinely requires your decision" instruction. Built the remaining `DATABASE.md` §9 tables (`trust_ledgers`/`trust_ledger_entries`, `bank_accounts`/`bank_transactions`, `invoices`, `expenses`, `owner_statements`, `tax_pack_exports`, migration `20260101000037`) and four typed posting operations (migration `20260101000038`).

**Checked `PERMISSIONS.md` §2's role table before writing the deposit-posting logic, not after**: `ACCOUNTING.md` §3 describes "a lease with a deposit goes active" as the trigger for posting the trust entry, which reads as if it should happen automatically inside `approve_application()` (agent+). But `PERMISSIONS.md`'s role table is explicit — `agent` has `—` (no rights at all) in the "Accounting (post)" column, only `accountant`+ does. Bundling a financial posting into an agent-level action would have quietly violated the documented role separation the very first time a deposit-bearing application was approved. Resolved by keeping `approve_application()` exactly as built in M9/M10 (no financial posting) and building `post_lease_deposit()` as a separate, explicit, accountant-gated action instead — reading the existing spec correctly before building beats inventing a security-definer bridge to paper over a role mismatch.

**Two real bugs found by testing, both would have been genuinely serious in production**:
1. `confirm_bank_transaction_match()`'s paid-vs-partial decision compared the *current* transaction's amount against the full schedule amount, not the *cumulative* amount matched so far. A rent schedule paid via two partial transactions (3000 + 5500 = 8500, fully covering an 8500 schedule) stayed `partial` forever, because the second call only ever compared its own 5500 against the full 8500. Found by testing the two-payment case specifically — a single-payment test would never have caught it. Fixed by adding `bank_transactions.matched_rent_schedule_id` (not in `DATABASE.md`'s original schema — a real, necessary addition found through implementation) and summing all matched transactions linked to a schedule before deciding paid vs. partial.
2. A `CASE` expression assigning a text literal to an enum-typed column inside an `UPDATE ... SET` failed with a type-inference error Postgres doesn't always catch automatically in that position — fixed with an explicit cast.

**Two real pgTAP-authoring bugs, same session, same lessons already learned once and then repeated**: fixture UUIDs using non-hex characters (`ap0...` — `p` isn't 0-9a-f — the identical class of mistake from M8's tenant tests, not caught by remembering the earlier fix, only by running it again). And a more novel one: captured `\gset` variables did not interpolate correctly inside the `$$ ... $$` blocks passed to `throws_ok`/`lives_ok` (syntax error at the literal `:` character), so the whole test file was rewritten using the subquery-by-unique-field pattern already proven across every other test file this session, trading some verbosity for zero risk of the same class of bug recurring. Also learned (the hard way, by getting it wrong first) that pgTAP's `throws_ok` 3-argument overload treats the third argument as the *expected error message*, not a description — switched to the 2-argument form (sqlstate only) for the two assertions where the real message contains a UUID not known at test-authoring time.

**Deliberately not built this pass**: `release_trust_deposit()` (deposit deduction/refund) and `accrue_trust_interest()` — both need an accounting-account mapping `ACCOUNTING.md` doesn't specify (which account absorbs a deduction? does interest accrual model real bank-earned interest, tenant-owed interest, or both?), and both touch real trust-money handling where an invented mapping carries more consequence than getting an expense posting wrong. Logged as `TECHNICAL_DEBT_REGISTER.md` TD-22, explicitly flagged as launch-blocking for Trust & Deposits going live, rather than guessed at to make this pass look more complete than it is.

**Verified, in order**: full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages). Fresh `supabase db reset` — 38/38 migrations clean. Full pgTAP suite — 123/123 assertions across 9 files (43 new across the two migrations), zero regressions. `pnpm --filter admin test` — 13/13 unchanged. Real `next build` — 9 new routes registered, no conflicts. Stopped the local Supabase instance cleanly afterward.

## 2026-07-31 (continued, 6) — M14 part 1: the core double-entry ledger, and a real immutability gap found and fixed before any migration was written

Continuing autonomously per Mohammed's "continue until something genuinely requires your decision" instruction. `TASKS.md` M14 (Accounting) has been flagged as the highest-risk single workstream since the original audit — read `ACCOUNTING.md`/`DATABASE.md` §9 fully before writing anything, and specifically checked whether the stated immutability mechanism actually holds in this Supabase project before implementing it as documented.

**Real gap found before it became a real bug**: `ACCOUNTING.md` §1 claimed immutability is "enforced at three layers," the second being "RLS has no update/delete policy on those tables for any role, including elevated ones." Checked this against `select rolbypassrls from pg_roles` (already run earlier this session) — `service_role` has `BYPASSRLS = true`. RLS's presence or absence has no effect whatsoever on a role that bypasses RLS entirely, so "no policy" was never actually a control against `service_role`, only against `anon`/`authenticated`. A hard requirement this explicit ("no financial record is ever edited after posting... a hard requirement for trust-account handling") cannot rest on a mechanism that silently doesn't apply to the credential most likely to be used for a bulk backend write. Fixed with `BEFORE UPDATE OR DELETE` triggers on `journal_entries`/`journal_lines` that unconditionally reject the operation — triggers fire regardless of RLS bypass or which role is writing, including the table owner, which is what "even elevated roles" actually requires. Corrected `ACCOUNTING.md` §1 to describe the real mechanism rather than leave the insufficient claim standing.

**Extended the same fix to `audit_events`** after re-examining the rest of the codebase for the identical documented-but-insufficient pattern, rather than stopping at the one instance already in front of me — its original migration comment makes the exact same claim ("no update/delete policy... trustworthy audit trail") with the exact same gap. Migration `20260101000036`.

**One narrow, deliberate exception, discovered as a real necessity while wiring the reversal function**: `journal_entries.reversed_by_entry_id` needs to be set exactly once (linking an entry to the reversal that negates it) — the trigger allows only this single field-and-direction change. A first version of `reverse_journal_entry()` was `security invoker`, and its final linkage `UPDATE` silently matched zero rows (RLS-filtered, not an error — the same "RLS filters, doesn't raise" class of gotcha this project has hit several times before, except this time it produced a reversal that *looked* successful but never actually linked). Fixed by making that one function `security definer` — the trigger, not RLS, is what actually constrains what the elevated privilege can be used for, and it applies identically either way.

**Wrote `supabase/tests/accounting_core.test.sql` (21 assertions) with the immutability tests specifically run in the `postgres` superuser connection context** (the default, before any `set local role authenticated`) rather than only against `authenticated` — testing only the weaker role would have proven nothing about whether the fix actually addresses the `service_role`/`BYPASSRLS` threat the requirement exists for. Also covers balance validation (rejects unbalanced entries, rejects <2 lines), period-lock rejection (a closed period blocks a post dated into it), chart-of-accounts seeding (now wired into `create_organization()`), and double-reversal prevention. Two real test-writing bugs caught and fixed before commit: a numeric-formatting mismatch (`100` vs `100.00`, since the column is `numeric(14,2)`) and one `throws_ok` expected-message that didn't match the trigger's actual (correct) output for that specific update shape.

**Built the read-layer + period-management API**: `GET /api/v1/chart-of-accounts`, `GET /api/v1/journal-entries` (deliberately read-only — `ACCOUNTING.md` §3: "no generic post a journal entry API exists"), `POST /api/v1/journal-entries/:id/reverse`, `GET /api/v1/trial-balance` (live computed report + the "Balanced" health check), `GET/POST /api/v1/accounting-periods`, `POST .../close`, `POST .../reopen`. Reopening's stated "writes an audit_events row" requirement is not implemented — `audit_events.actor_type` has no value correctly describing an org accountant, same `TECHNICAL_DEBT_REGISTER.md` TD-14 gap every route since it was found has consistently respected rather than worked around with a wrong value.

**Deliberately split M14 into two parts** rather than attempting the full `API_SPEC.md` §6 surface (rent schedules, invoices, expenses, bank accounts/transactions/matching, trust ledgers/release, owner statements, tax pack) in one pass — that surface depends on tables not yet created (`trust_ledgers`, `bank_accounts`, `expenses`, `owner_statements`, etc.) and several substantial pieces of real business logic (deposit-release inspection gating, owner-statement rounding-remainder allocation, bank transaction matching) each deserving focused attention. `TASKS.md` records this as an explicit, visible seam, not a milestone marked done because most of it looks done.

**Verified, in order**: fresh `supabase db reset` — 36/36 migrations clean. Full pgTAP suite — 103/103 assertions across 8 files (22 new), zero regressions. Full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages, one real unused-import lint error fixed). `pnpm --filter admin test` — 13/13 unchanged. Real `next build` — 8 new routes registered, no conflicts. Stopped the local Supabase instance cleanly afterward.

## 2026-07-31 (continued, 5) — M13: Maintenance and Inspections, two state machines of deliberately different strength

Continuing autonomously. Built `maintenance_tickets`/`maintenance_photos`/`vendors`/`vendor_bills` and `inspections`/`inspection_items`/`inspection_photos` (migration `20260101000034`) plus the corresponding API surface (`vendors`, `maintenance-tickets`, `inspections` + `items`/`sign`/`complete` action endpoints).

**Two state machines, deliberately enforced at different layers, for a reason worth recording**: the maintenance kanban (To Do → In Progress → Pending Approval → Completed) is enforced in the API route (`isValidMaintenanceTransition`) — a workflow convention, reversible if wrong, no financial consequence to getting it slightly wrong. The inspection completion rule (both signed, or landlord-signed-plus-refusal-logged) is enforced as a **hard DB CHECK constraint**, one layer stronger, because `TASKS.md` M14's deposit-release gate will depend on this invariant actually holding — even against a future service-role write that bypasses the API entirely. Matching the strength of enforcement to what depends on it, not applying the same treatment everywhere by default.

**Modeled `maintenance_tickets`' "submitted by a user or a tenant" as two nullable FKs with an exactly-one-set CHECK constraint**, not a single polymorphic column — consistent with `DATABASE.md` §6's correction earlier today (M11), which explicitly rejected an untyped polymorphic-relation pattern in favor of typed FKs. No tenant portal exists in V1, so `submitted_by_tenant_id` has no real caller yet; included because the column is free and the schema is correct either way.

**Real pgTAP test-writing bug caught and fixed before commit**: four `throws_ok` assertions initially passed only 3 arguments (sql, sqlstate, description) instead of the required 4 (sql, sqlstate, *expected message*, description) — pgTAP silently treated the test description as the expected error message, so every one of those assertions failed with a "wanted X, caught Y" mismatch on first run, even though the underlying constraints were correct. Fixed by supplying the actual Postgres constraint-violation text as the third argument. A reminder that pgTAP's own API has sharp edges worth getting right, distinct from bugs in the schema under test.

**Real lint error caught before commit**: an unused `encodeCursor` import in the new `inspections` list route (list endpoint returned a bare array without pagination metadata) — fixed by actually wiring up cursor pagination to match every other list endpoint's convention, rather than just deleting the unused import, since inspections lists deserve the same pagination guarantee as everything else at scale.

**Verified, in order**: full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages, after fixing the lint error above). Fresh `supabase db reset` — 34/34 migrations clean. Full pgTAP suite — 82/82 assertions across 7 files (13 new), zero regressions. `pnpm --filter admin test` — 13/13 unchanged. Real `next build` — 8 new routes registered, no conflicts. Stopped the local Supabase instance cleanly afterward.

Deliberately deferred: `vendor-bills` API (naturally pairs with M14, since its approval flow writes to the same `paid_journal_entry_id` column M14 makes real) and maintenance/inspection photo upload endpoints (need the Documents API from M11's TD-21 first). Web UI open, same as every prior milestone.

## 2026-07-31 (continued, 4) — M12: OCR lease support, upload-and-parse, and a real LegacyHealthCheckTimeoutError reproduction

Continuing autonomously. Extended `DocumentIntelligenceProvider` to handle leases (`'lease'` document type, lease-shaped optional fields on the shared `FieldExtractionResult`, a new server-side `MockDocumentIntelligenceProvider` in `apps/admin/lib/providers/` that actually branches on document type — the mobile client-side mock doesn't and wasn't touched, different runtime), then built the `POST /api/v1/leases/:id/upload-and-parse` endpoint deferred from M10 pending exactly this.

**Real bug caught before shipping, by testing the assumption directly rather than trusting the code read-through**: the route's first draft inserted into `extraction_jobs`/`extraction_results` using the caller's session-bound client. Those two tables have never had a client INSERT policy, by original Phase-1 design ("jobs are created and progressed only by the server-side processing pipeline"). Simulated the exact insert as an authenticated agent via `docker exec ... psql` role-switching — confirmed it's rejected with "new row violates row-level security policy." Fixed by using `getServiceRoleClient()` for those two tables specifically, only after `requireOrgRole()` already authorized the caller (matching that helper's own documented usage rule). Re-verified the fix the same way: the service-role insert now reaches the foreign-key constraint instead of an RLS rejection, confirming it bypasses RLS as intended.

**`LegacyHealthCheckTimeoutError` reproduced directly, for the first time this session**: `supabase start` failed with `supabase_storage_propvault: container is not ready: unhealthy` mid-way through this milestone's verification — the exact named error from Mohammed's original request, this time on the `storage` container rather than the `vector`/analytics sidecar investigated and fixed 2026-07-31 (continued). Immediate retry with zero config changes succeeded cleanly, and `docker ps` showed every container healthy seconds later. This is consistent with the working theory from the earlier investigation: a transient timing/resource-pressure issue under sustained Docker load (this session has run `supabase start`/`db reset` well over a dozen times today), not a structural defect — a container occasionally takes longer than the CLI's health-check polling window, and the CLI gives up with this specific error rather than waiting longer, but the underlying service comes up fine moments later. Noting this as confirmed-transient-and-retry-recoverable rather than closing the investigation as "fully explained," since the exact trigger condition (why storage, why this moment) still isn't pinned down.

**Verified, in order**: full monorepo `pnpm typecheck`/`pnpm lint` (7/7 packages) after the type/provider changes. Fresh `supabase db reset` — 33/33 migrations clean. Full pgTAP suite — 69/69 assertions, zero regressions. Real `next build` — new route registered. Stopped the local Supabase instance cleanly afterward.

Real OCR vendor selection remains explicitly open — a cost/accuracy tradeoff for Mohammed, not something to guess at, per the standing carve-out for decisions that need human input.

## 2026-07-31 (continued, 3) — M11: Documents/financials org-scoping — the biggest, riskiest cutover yet, and a documentation correction before writing any migration

Continuing autonomously per the "Lead Principal Engineer" mandate ("carry on until something is very important... otherwise carry on"). M11's own `TASKS.md` line said "extend documents/ocr_jobs from owner-scoped to org-scoped, generalize `related_entity_type` beyond bills (`DATABASE.md` §6)" — before writing any migration, checked what `DATABASE.md` §6 actually specified against what real application code depends on, per the standing instruction to fix implementation or correct documentation whenever the two disagree, never leave them inconsistent.

**Found a real doc-vs-reality conflict worth stopping for, even briefly**: §6's documented target schema (`related_entity_type`/`related_entity_id` polymorphic columns, a bare `category` enum) would have **regressed working, already-demoed features** — `document_categories` (13 default + org-custom categories, referenced by `property_expected_categories`), `billing_year`/`billing_month` (the Monthly Checklist feature), and `checksum_sha256` (duplicate-upload detection) all had no room in the documented shape. This wasn't a business/product decision to escalate (the mandate's carve-out) — it was a technical correctness question with hard evidence behind it (grepped `apps/mobile/src` and confirmed real code depends on these fields), so corrected `DATABASE.md` §6 directly rather than either implementing a regression or stopping to ask.

**Migration `20260101000032`** — the largest single migration in the project's history by blast radius: `documents`, `document_categories`, `property_expected_categories`, `bills`, `payments`, `payment_matches`, `extraction_jobs`, `extraction_results`, `audit_events` (9 tables) all cut over from owner-scoped to org-scoped RLS in one migration. Deliberately excluded `subscriptions`/`subscription_events` — re-examining them during this pass showed they're superseded by `organization_subscriptions`/`subscription_payments` (built in M1), not merely mis-scoped like the others; `TECHNICAL_DEBT_REGISTER.md` TD-02 had incorrectly grouped them together, corrected now.

**This is the direct fix for TD-01's long-standing blocker**: `property_expected_categories` and `documents`' policies were the exact cross-table `properties.owner_user_id` references that blocked M5's `DROP COLUMN` attempt on 2026-07-30. Re-verified live, twice (before and after two more fixes below), via a rolled-back `ALTER TABLE properties DROP COLUMN owner_user_id` transaction — it now succeeds. The drop itself is deliberately not executed as part of this migration (a separate, deliberate decision), but the blocker is confirmed gone with evidence, not assumed gone because the migration "should" have fixed it.

**Two more real bugs found by writing and running the test suite before committing, both fixed in the same uncommitted migration rather than shipped-then-patched**:
1. `owner_user_id NOT NULL` was never relaxed on 7 of the 9 tables — an org-scoped insert (no single "owner" anymore) would have hard-failed on every one of them. Not caught by re-reading the migration; caught by actually trying to insert a test row.
2. `document_categories`' original CHECK constraint (`is_default or owner_user_id is not null`, from the very first PropVault-era migration) was never updated when `org_id` was added — silently still required `owner_user_id` for every custom category, blocking the org-scoped path entirely. Same discovery method: a real insert failed with `violates check constraint`, not a static read-through.

**New test file**, `supabase/tests/documents_financials_isolation.test.sql` (14 assertions) — deliberately proves org-scoped *inserts actually succeed* (not just that old owner_user_id-based access is gone), across every cutover table, plus cross-org isolation on documents/custom-categories/payment_matches. Both bugs above were caught by this file failing on first run, exactly the "execution finds bugs design review cannot" pattern from every prior verification pass this session.

**Verified, in order**: fresh `supabase db reset` — 32/32 migrations clean (after both in-place fixes). Full pgTAP suite — 69/69 assertions across 6 files, zero regressions in the 55 pre-existing ones. Full monorepo `pnpm typecheck`/`pnpm lint` — unaffected (schema-only milestone; cache hits confirm no app code was touched, matching this milestone's own documented scope). Stopped the local Supabase instance cleanly afterward.

**Deliberately left open**: API endpoints/Web UI for documents/bills/payments (out of M11's own stated scope). Storage bucket policies still path-scoped on `auth.uid()`, not `org_id` — and, checked directly, there's no real (non-demo) mobile document/bill/payment upload flow to migrate as a consequence (`apps/mobile/src` has zero `owner_user_id` references outside `demo/` — only the mock/demo path was ever built). Both logged as new `TECHNICAL_DEBT_REGISTER.md` TD-21 rather than either rushed or silently ignored.

## 2026-07-31 (continued, 2) — M9 + M10: Applications, Leases, and the atomic approval transaction

Continuing autonomously per Mohammed's "Lead Principal Engineer/Technical Architect" mandate ("continue building until production readiness... do not wait for further instructions unless a decision genuinely requires human input"). `TASKS.md` lists M9 (Applications) before M10 (Leases), but M9's own approval transaction depends on M10's tables, so built both together as one coherent unit — the biggest single milestone so far (4 migrations, 8 API routes, 14 new pgTAP assertions, a new provider abstraction).

- **Schema** (migrations 29-31): `applications` (two CHECK-constraint invariants beyond the documented column list — decision bookkeeping is all-or-nothing, screening can't start before consent), `leases`/`lease_tenants`/`rent_schedules` (RLS patterns already established for `units`/`property_owners`), and `approve_application()` — the atomic multi-table transaction `DATABASE.md` §4 requires. Deliberately not `security definer` (unlike `create_organization()`): the caller already has agent+ org membership, so every insert inside the function runs under the caller's own RLS, adding only atomicity, not privilege. Proved this design choice is actually safe, not just theoretically sound: a pgTAP test has an "outsider" org's agent call `approve_application()` against another org's application and confirmed it fails with "Application not found" (RLS blocking the internal `SELECT ... FOR UPDATE`), not a privilege bypass.
- **A business-rule question surfaced during design, deliberately not guessed at**: should approval require `screening_status = 'passed'`? `DATABASE.md` never says so. Rather than encode an assumption as a hard DB constraint (which would be a real, silent product decision), left it unenforced at the DB layer — noted in `TASKS.md`/this entry rather than silently decided either way. This is the kind of call the "Lead Principal Engineer" mandate's own carve-out exists for ("stop only when a business rule is ambiguous") — except here the safer engineering answer was "don't build an assumption into the schema," not "stop and ask," since not enforcing it is trivially reversible (a future CHECK/API guard) while enforcing a wrong assumption would need a migration to undo.
- **New provider abstraction**: `apps/admin/lib/providers/tenantScreening.ts` (`TenantScreeningProvider`/`MockTenantScreeningProvider`), matching ADR-014's vendor-agnostic mock-first pattern already used for document intelligence/subscriptions on the mobile side — no real screening vendor (TPN/ITC-equivalent for the SA market) has been chosen, so `POST /api/v1/applications/:id/screen` is a real, callable, swappable-later contract rather than either a stub that does nothing or a premature vendor integration.
- **API**: `GET/POST /api/v1/applications`, `GET /api/v1/applications/:id` (deliberately no general PATCH — only the three action endpoints below can mutate an application), `POST .../consent`, `POST .../screen`, `POST .../decide` (approve → RPC; decline → simple update); `GET/POST /api/v1/leases`, `GET/PATCH /api/v1/leases/:id`, `GET /api/v1/leases/:id/rent-schedule`.
- **New test file**, `supabase/tests/leasing_isolation.test.sql` (14 assertions) — cross-org isolation, role-scoped write denial, and a full correctness check of `approve_application()`'s output (tenant/lease/lease_tenants/rent_schedules rows, unit flipping to occupied, application marked decided) plus its safety (outsider call fails closed; re-approving an already-decided application raises rather than double-creating a lease). All 14 passed on the first real run — the careful RLS-invoker design and the explicit "already decided" guard paid off here.
- **Deliberately deferred, not silently skipped**: `POST /api/v1/leases/:id/upload-and-parse` (needs M12 OCR — a stub faking extraction would be worse than leaving it undone) and recurring `rent_schedules` generation for periods after the first (needs real cron/scheduled-function infrastructure that doesn't exist anywhere in this codebase yet — new `TECHNICAL_DEBT_REGISTER.md` TD-20, flagged as High-severity-once-real-leases-exist since the Rent Due dashboard would otherwise silently go blank after month one).
- **Verified, in order**: fresh `supabase db reset` — 31/31 migrations clean. Full pgTAP suite — 55/55 assertions across 5 files (the new `leasing_isolation.test.sql` plus the 41 already-passing from before), zero regressions. Full monorepo `pnpm typecheck`/`pnpm lint` — 7/7 packages green. `pnpm --filter admin test` — 13/13 unit tests, unchanged. Real `next build` — all 8 new routes registered (`/api/v1/applications`, `.../[id]`, `.../[id]/consent`, `.../[id]/screen`, `.../[id]/decide`, `/api/v1/leases`, `.../[id]`, `.../[id]/rent-schedule`), no path conflicts. Stopped the local Supabase instance cleanly afterward.
- Web UI (Applications pipeline, Lease detail) remains open, same sequencing as every prior milestone (API first).

## 2026-07-31 (continued) — M8: Tenants (schema, RLS, API), continuing autonomously per Mohammed's "Lead Principal Engineer" mandate

With the multi-tenant foundation verification complete and documented, continued to M8 per `TASKS.md`'s milestone order. This is the first milestone since M2 to add a genuinely new table (not just API endpoints on existing schema), so it got the full design→implement→test→verify→document→commit cycle:

- **Design decision, recorded in `TECHNICAL_DEBT_REGISTER.md` TD-18**: `DATABASE.md` §4's `tenants` design depends on §11's `encrypted_secrets` pointer table (for `id_number_ref`), which didn't exist yet — neither did the FK constraint on `owners.banking_ref` (added nullable/unconstrained back in M2 for exactly this reason). Built `encrypted_secrets` as schema-only (migration `20260101000027`) — table + RLS lockdown, matching `DATABASE.md`'s documented shape exactly — but deliberately did not build the application-layer encryption/key-management pipeline `SECURITY.md` describes, since nothing calls it yet and building it now would be unverifiable speculative work. Same reasoning applied to `pg_trgm` search indexing (`DATABASE.md` §13, also specified but unbuilt for every table including already-existing ones) — logged as TD-19, deferred to whichever milestone first builds a real search UI.
- **New**: migration `20260101000028_tenants.sql` (table, `(org_id, status)` + partial `user_id` indexes, `updated_at` trigger, RLS mirroring `owners`'s `_select_org_or_self`/`_write_agent_plus` pattern exactly — no self-write policy, since there's no tenant portal in V1). `packages/types/src/leasing.ts` (new file — first of the Leasing domain, `Tenant` type; `Application`/`Lease`/`RentSchedule` will join it in M9/M10 rather than overloading `portfolio.ts`). `packages/validation/src/leasing.ts`. `apps/admin/lib/leasing.ts` (row mapper, reusing `requireOrgRole` from `portfolio.ts` rather than a per-domain copy). Routes: `GET/POST /api/v1/tenants`, `GET/PATCH /api/v1/tenants/:id`.
- **New test file**, `supabase/tests/tenants_isolation.test.sql` (10 assertions) — cross-org isolation, role-scoped write denial, and specifically the self-access carve-out (a tenant with a portal identity but zero org memberships can SELECT their own record, matching `owners`'s pattern), plus an `encrypted_secrets` deny-by-default check. Caught one real bug immediately on first run: the fixture used `'t1000000-...'`-style UUID literals — `t` isn't a valid hex digit, so the insert failed with `invalid input syntax for type uuid` before any RLS logic was even exercised. Fixed by using valid hex-prefixed fixture IDs (`f1000000...`).
- **Verified, in order**: `supabase db reset` — 28/28 migrations apply cleanly. Full pgTAP suite — 41/41 assertions across 4 files (`multi_tenant_foundation_integration`, `multi_tenant_isolation`, `rls_isolation`, new `tenants_isolation`), no regressions from the new migrations. Full monorepo `pnpm typecheck`/`pnpm lint` — 7/7 packages green (touched shared `packages/types`/`packages/validation`, so verified mobile didn't regress too, not just admin). `pnpm --filter admin test` — 13/13 unit tests, unchanged (no new pure-logic surface this milestone). Real `next build` — both new routes registered (`/api/v1/tenants`, `/api/v1/tenants/[id]`), no path conflicts. Stopped the local Supabase instance cleanly afterward.
- Web UI (Tenant directory) remains open, same sequencing as Properties/Units/Owners (API first, UI as its own follow-up).

## 2026-07-31 — Full multi-tenant foundation verification: LegacyHealthCheckTimeoutError root-caused, 4 more real bugs found and fixed, foundation re-verified end-to-end

Per Mohammed's instruction to not begin new business modules (M8+) until the multi-tenant foundation (M1-M5, extended here to cover M6/M7's new tables) is genuinely, evidence-backed complete — continuing the "execution finds bugs design review cannot" discipline from the previous session, not treating the earlier all-green pgTAP run as the final word.

**1. `LegacyHealthCheckTimeoutError` investigated with direct evidence, not assumed away.** Ran `supabase start` fresh twice (analytics disabled, then re-enabled as a controlled test) and `supabase status` once — none of the three reproduced the named error directly. But re-enabling `[analytics]` (which a prior session had disabled after it "failed its health check") revealed the real, concrete, currently-reproducible defect underneath: the `vector` sidecar container (log shipper feeding `logflare`) crash-loops forever. `docker logs` showed `vector::sources::docker_logs: Listing currently running containers failed... NetworkUnreachable`; `docker inspect` confirmed `Mounts: []` — the Docker socket is never bind-mounted into this container by the Supabase CLI's local compose definition on this Windows/Docker Desktop host, so `vector` can never reach the Docker API to tail container logs, which makes every one of its sources fail, which makes it exit, which makes Docker's restart policy relaunch it — `RestartCount` climbing indefinitely, `State.Health.Status: "unhealthy"`. This is a genuine Docker-health-check-never-passing situation, the exact class of defect that would produce a `LegacyHealthCheckTimeoutError` if any CLI code path's readiness gate ever waits on it (confirmed the error name itself is real — a bare `supabase db reset` before the stack was running surfaced a sibling error, `LegacyDbResetNotRunningError`, from the same "Legacy"-prefixed error family in the CLI). Whether that exact code path is what Mohammed hit is `Unknown` — not reproduced directly in this session — but the underlying container defect is `Verified`, infrastructure-only (Docker Desktop socket exposure on this host, not our migrations/config), and already correctly mitigated by the prior session's `[analytics] enabled = false`. Re-confirmed clean: with analytics disabled, `docker ps` shows every container healthy or normally running, zero restarts, zero errors.

**2. Seed script had silently never run, in any session, ever.** `supabase db reset`'s own output included `WARN: no files matched pattern: supabase/seed.sql` every single time — never investigated before. Root cause: `supabase/config.toml` never had a `[db.seed]` section, so the CLI fell back to its default path (`supabase/seed.sql`), which doesn't exist; the real file has lived at `supabase/seed/seed.sql` since M5. Fixed by adding `[db.seed]\nsql_paths = ["./seed/seed.sql"]`. Verified for real, not just "the warning went away": since a fresh reset has zero `auth.users` (the seed script's own documented precondition), signed up two dev users via the local GoTrue REST endpoint, piped `seed.sql` directly into the running Postgres container, and confirmed via SQL exactly 2 organizations / 2 memberships / 2 properties / 2 property_expected_categories rows, correctly linked (`org_id` on each property matches its organization).

**3. `organizations.status`'s `archived` value was documented but never implemented.** `DATABASE.md` §1 and `SUPER_ADMIN.md` both describe the enum as `trial|active|overdue|suspended|cancelled|archived`, dated "architecture review 2026-07-30" — but `select enumlabel from pg_enum where typname='organization_status'` against a freshly-reset database returned only 5 values, no `archived`. Fixed with a new migration (`20260101000025_organization_status_archived.sql`, `alter type ... add value`). This had zero blast radius until now only because nothing has ever tried to write `'archived'` — the corresponding Super Admin archive endpoint doesn't exist yet (M13).

**4. `organization_invites` had a SELECT policy but no INSERT policy — the invitation feature was schema-complete but had never actually been usable end to end.** Found while trying to verify "invitations" as part of the integrated M1-M5 flow, not by reading the policy list in isolation. RLS-enabled + zero matching policy = deny-by-default, and grepping the whole `apps/admin` tree confirmed `POST /api/v1/organizations/:orgId/invites` (the create-invite endpoint `API_SPEC.md` §2 documents) had never been built either — only the accept-flow route existed. Fixed both halves: migration `20260101000026_organization_invites_insert_policy.sql` (manager+ gate, matching `PERMISSIONS.md`'s role table) and a new route `apps/admin/app/api/v1/organizations/[orgId]/invites/route.ts`, which additionally enforces the finer "a manager may only invite agent/accountant/viewer, never another manager or principal" rule at the API layer (RLS only expresses the coarser "manager+ can insert at all" gate — the same category of split `PERMISSIONS.md` itself documents).

**5. Wrote a new end-to-end integration test, `supabase/tests/multi_tenant_foundation_integration.test.sql`, walking the full real user journey in one file** (create org → invite → accept → role-gated property creation → org_id propagation → role-ceiling denial → multi-org switching) rather than only testing each piece in isolation, per Mohammed's explicit "treat M1-M5 as one integrated subsystem" instruction. Writing it for real caught two bugs in the *test itself* (not the schema) that are worth recording as a methodology note: (a) the first draft looked up the invite token by querying `organization_invites` as the not-yet-member invited user — RLS correctly blocked that (you can't see an invite you haven't joined via yet), which is exactly why the real flow uses a token from an email link rather than a self-query; fixed by capturing the token via `set_config()` while still in the inviter's session. (b) a later fixture tried to `insert into organization_members` directly as an ordinary `authenticated` session — also correctly blocked (there is deliberately no client-side path to add an existing user to an org outside the two security-definer RPCs, since that would be a real privilege-escalation hole); fixed by using `reset role` for that one fixture-setup statement only, matching how the other test files already insert their fixtures before ever switching to `authenticated`.

**6. Extended `multi_tenant_isolation.test.sql`** with two more real, evidence-backed cases from Mohammed's checklist: `support_access_sessions` correctly denies even an org's own principal (zero client policies, by design — confirmed separately that `service_role` has `rolbypassrls = true` so the real route handlers are unaffected), and an explicit, honestly-labeled assertion that `organizations.status = 'archived'` currently has **no effect** on `has_org_role()` — documented as current behavior, not asserted as a security guarantee that doesn't exist (see finding 7).

**7. Found and deliberately did NOT fix a real gap: `organizations.status` is not wired into any access-control check anywhere.** An archived/suspended/cancelled org's own members keep full read/write access. This is not a bug in the sense of "code doing something wrong" — nothing was ever decided about what these statuses should mean for member access (`SUPER_ADMIN.md` only describes their effect on billing/dashboard visibility). Implementing enforcement now would mean inventing a business rule, not fixing one — logged as `TECHNICAL_DEBT_REGISTER.md` TD-17 / `RISK_REGISTER.md` R-22 and `DECISIONS.md`, explicitly flagged as needing Mohammed's decision before it's built.

**8. Corrected two stale claims found while cross-referencing today's findings against existing docs**: `TECHNICAL_DEBT_REGISTER.md` TD-16 and `RISK_REGISTER.md` R-21 both claimed the M5 migration "drops `properties.owner_user_id` entirely" — directly contradicting TD-01 (written in the same document) which correctly says the column was only relaxed to nullable. The two entries had never been reconciled. Corrected both: the real, still-valid defect in `customers/page.tsx` is that the query silently omits every property created after the org-scoped cutover (since new properties never populate `owner_user_id`), not that it throws.

**Final verification, full suite, freshly reset database**: 26/26 migrations apply cleanly; `pnpm supabase test db` — 3 files, 31 pgTAP assertions, **all pass** (`multi_tenant_foundation_integration.test.sql` 14, `multi_tenant_isolation.test.sql` 13, `rls_isolation.test.sql` 4). `PRODUCTION_READINESS_REPORT.md` updated (72→77/100) reflecting that the multi-tenancy/security and testing-strategy categories are now genuinely execution-verified, not just designed, while flagging the newly-found R-22 gap as exactly why it isn't higher. Stopped the local Supabase instance cleanly afterward.

**The throughline, again**: this pass found four more real, previously-invisible bugs (missing seed config, missing enum value, missing RLS policy, and — in the test-writing itself — two invalid test assumptions) by actually running things end to end, on top of the four already found and fixed in the prior session. None of these eight would have been caught by re-reading the architecture documents more carefully; all eight were only findable by executing the real user journey against a real database.

## 2026-07-30 (continued, 8) — M7: Owners API endpoints

Continued straight on to M7 (Owners) after M6, reusing the same patterns (`apps/admin/lib/portfolio.ts`'s `mapOwnerRow`/`requireOrgRole`, `cursorPagination.ts`) rather than growing a parallel set:

- **New routes**: `GET/POST /api/v1/owners`, `GET/PATCH /api/v1/owners/:id`, `GET/POST /api/v1/properties/:id/owners` (fractional-ownership attach; the `GET` here is a pragmatic addition beyond `API_SPEC.md`'s literal "POST ... attach owner" line, added because a property's owner list needs to be readable by something).
- **Real tenant-isolation gap found and closed at the API layer, not just noted**: `property_owners`'s RLS policy (`supabase/migrations/20260101000022`) checks the *owner's* org via `owners.org_id` but never checks the *property's* org — so RLS alone would not stop a caller with `agent`+ in Org A from attaching an Org-A owner to a property that happens to belong to Org B, if they could ever get a valid property id for it. The attach handler explicitly fetches both rows and 400s with `org_mismatch` if `owner.org_id !== property.org_id` before the insert. Documented inline in the route file and here rather than silently relying on the FK constraint (whose RLS-bypass behavior on referenced-row existence checks is itself not something to depend on for a security guarantee) — this is exactly the "API-layer checks... enforce role/scope checks RLS can't express cleanly" case `PERMISSIONS.md` describes, not a redundant belt-and-braces check.
- Used `.upsert(..., { onConflict: 'property_id,owner_id' })` for the attach so re-POSTing the same owner against the same property adjusts `ownership_pct` instead of erroring on the composite primary key — matches how a "change this owner's share" UI action would naturally call the same endpoint.
- **Verified**: `pnpm typecheck`/`lint` clean; `pnpm --filter admin test` 13/13 (unchanged — no new pure-logic surface this pass, `requireOrgRole`/RLS remain the tested boundary per the "RLS is ground truth, don't mock Supabase in Jest" approach already established); real `next build` — all three new routes (`/api/v1/owners`, `/api/v1/owners/[id]`, `/api/v1/properties/[id]/owners`) registered alongside the existing ones with no path conflicts.
- Web UI (Owners directory) remains open (`TASKS.md` M7), same as Properties/Units.

## 2026-07-30 (continued, 7) — M6: Properties + Units API endpoints

With the test-environment fix and migration verification both committed, resumed the milestone queue at M6 (Units) per the standing "continue automatically" instruction. Units nest under properties in the API (`GET/POST /api/v1/properties/:propId/units`), and M5 had explicitly left the Properties API endpoints unbuilt too, so built both together as one coherent, dependency-ordered chunk rather than building an orphaned Units API with no parent resource endpoint to nest under:

- **New**: `apps/admin/lib/cursorPagination.ts` (shared cursor-pagination helper — `API_SPEC.md` §0 mandates cursor-based pagination project-wide; this is the first list endpoint built, so it establishes the pattern owners/tenants/leases will reuse rather than each growing offset pagination). `apps/admin/lib/portfolio.ts` (shared snake_case-row → camelCase-domain-type mappers matching `propertyRepository.ts`'s existing mobile-side mapping, plus `requireOrgRole()` — the API-layer fail-fast check that calls the *same* `has_org_role()` Postgres RPC RLS itself uses, deliberately not a hand-rolled TS copy of the role hierarchy, which is asymmetric — `agent`/`accountant` are siblings, not a ladder — and would drift if duplicated).
- **New routes**: `GET/POST /api/v1/properties`, `GET/PATCH/DELETE /api/v1/properties/:id` (`DELETE` archives per `API_SPEC.md` §3, never hard-deletes), `GET/POST /api/v1/properties/:id/units`, `GET/PATCH /api/v1/units/:id`. Every route: fetches the parent resource through the caller's own RLS-scoped client first (so a resource in another org 404s, never 403s — `API_SPEC.md` §0's anti-enumeration rule), only 403s once the row is confirmed visible but the caller's role is below the required floor.
- **Next.js routing constraint hit and worked around**: `app/api/v1/properties/[id]/units/` cannot coexist with a `[propId]` folder name if `app/api/v1/properties/[id]/route.ts` also exists — Next.js requires sibling dynamic segments at the same path level to share one slug name (`'id' !== 'propId'` is a build-time error). Both directories use `[id]`; the `POST`/`GET` handlers in the units route destructure it as `propertyId` internally for readability against `API_SPEC.md`'s `:propId` naming. Confirmed via a real `next build` (not just `tsc`) that both routes register correctly with no conflict.
- **Verified**: `pnpm typecheck`/`lint` clean across `packages/types`, `packages/validation`, `apps/admin`; `pnpm --filter admin test` — 13/13 passing (7 new, for `cursorPagination.ts`'s limit-clamping and cursor encode/decode/malformed-input handling); a real `next build` with demo-mode env vars set — compiles, and the route table shows all four new endpoints registered as expected (`ƒ /api/v1/properties`, `ƒ /api/v1/properties/[id]`, `ƒ /api/v1/properties/[id]/units`, `ƒ /api/v1/units/[id]`). No new migration in this change, so the pgTAP RLS suite (already green from the prior entry) did not need re-running — the API layer adds fail-fast checks on top of RLS, it doesn't change what RLS itself enforces.
- Web UI for both Properties and Units, and AI-assisted bulk unit generation, remain open (`TASKS.md` M5/M6) — this pass was API-only, consistent with how the organizations endpoint was built before its onboarding page followed separately.

## 2026-07-30 (continued, 6) — Migration verification completed: 4 real bugs found and fixed, all 15 RLS tests passing for real

Continuation of the same verification pass: got a fully healthy local Supabase stack running (disabled the `analytics`/logflare container in `supabase/config.toml` — it was failing its own health check for unrelated reasons and blocking the rest of the, correctly-migrated, stack from being reported ready), then ran `supabase test db` for the first time this project has ever had a real database to test against. Found three more real bugs beyond the two already fixed and committed:

1. **`organization_members`'s own select policy caused infinite recursion** — its `USING` clause subqueried `organization_members` directly from a policy defined *on* `organization_members`, so Postgres re-applied the same policy to the subquery forever. Fixed by routing through `has_org_role()` (security-definer, so its internal query runs as the function owner and bypasses RLS rather than re-triggering the calling policy) — and, since `has_org_role()` isn't defined until migration 21, the policy itself had to move there too (the exact same forward-reference class of bug as the first fix, caught the same way).
2. **Zero `GRANT` statements exist anywhere in this project's migration history**, discovered via `permission denied for table properties`. RLS restricts *which rows* a role sees; Postgres separately requires the role to hold base table privileges at all. This has been missing since the very first Phase 0 commit — every table, not just the new multi-tenancy ones — and was never caught because this is the first time any of these migrations has run against a real Postgres instance. Fixed with a new forward migration (`20260101000024_grants.sql`) granting `anon`/`authenticated`/`service_role` the standard privileges plus `ALTER DEFAULT PRIVILEGES` so future migrations don't need to repeat it.
3. **Two test files asserted the wrong thing**: `throws_ok()` around an RLS-filtered `UPDATE`, expecting an exception — but Postgres RLS filtering doesn't raise an exception, it silently matches and updates zero rows. One instance was in the new test file I wrote this session; the other was in the *original* `rls_isolation.test.sql`, present since it was first written weeks ago and never caught because it had never actually run. Fixed both to use `lives_ok()` (correctly asserts no exception) paired with the row-count check that was already there to verify the actual denial.

Learned the hard way along the way that `supabase stop`/`supabase start` does **not** guarantee a fresh database — it preserves the underlying volume by default (`"backup":true` in its own output), so migrations already recorded as applied are silently skipped even after editing their source file. `supabase db reset` is the command that actually re-applies everything from scratch; used it to get a trustworthy re-test after each fix rather than being fooled by a stale pass/fail.

**Final result**: all 24 migrations apply cleanly to a genuinely clean database; all 15 pgTAP assertions across both RLS test files pass. `RISK_REGISTER.md` R-02 — the last remaining Critical risk in the entire project — is closed. Zero Critical risks remain open. `TASKS.md` M1 and M3 both updated to reflect real, executed, passing verification rather than "written but unverified." Stopped the local Supabase instance cleanly afterward (`supabase stop`) rather than leaving it running.

**The throughline worth stating plainly**: every one of these four bugs was invisible to code review, static analysis, and architecture documentation — all of it looked correct on paper (including two full architecture-review passes earlier this session). Only actually running the migrations and tests against a real database surfaced any of them. This is the concrete justification for treating "verify on a clean database" as a hard gate before further business-module implementation, not a nice-to-have.

## 2026-07-30 (continued, 5) — Engineering hardening: jest-expo genuinely fixed, real migration bug found and fixed on a clean DB

Per Mohammed's instruction to fix the test environment root cause (not suppress it), commit per-milestone, and verify migrations on a clean database before going further:

- **jest-expo test failure — root-caused for real, not re-cited.** Rather than trust the prior "Windows/Node-version" write-up, instrumented `jest-expo`'s failing `attemptLookup()` directly with temporary debug logging and observed the actual corrupted path value. Root cause: `error-stack-parser@2.1.4` (a transitive dependency via `stacktrace-js`) strips every literal parenthesis from a parsed stack-trace file path — not just the `(file:line:col)` wrapper V8 adds. This repository's own directory, `PropValt (Property App)`, contains literal parentheses, which get silently stripped, producing a nonexistent path and the observed crash. Confirmed this is a genuine, still-unfixed upstream bug (checked `error-stack-parser@3.0.0`, the latest published version — same bug present) — not Windows-specific, not Node-version-specific, not a project misconfiguration. Fixed with a committed `pnpm patch` (`patches/error-stack-parser.patch`) correcting the regex to strip only the true wrapping parens. **Verified, not assumed**: `pnpm --filter mobile test` → 3/3 suites, 12/12 tests pass; `pnpm test` at the repo root → 5/5 workspaces pass — the first time this project has been fully green, ever. Full trace and fix documented in `KNOWN_BUGS.md`/`TESTING.md`.
- **Docker was actually available this whole time.** `RISK_REGISTER.md`/`TASKS.md`/`KNOWN_BUGS.md` had all carried forward an unverified "no local Docker/Supabase instance available" assumption from the original PropVault-era sandbox. Re-checked directly (`docker ps`) — Docker is running. Ran `supabase start` for the first time this project has ever had a local Postgres instance.
- **Found and fixed a real migration-ordering bug via that first real run.** `20260101000017_organizations.sql` failed to apply: it creates a `select` RLS policy referencing `public.organization_members`, but that table isn't created until the *next* migration (`20260101000018`) — a forward reference that `supabase start` caught immediately on a genuinely clean database, exactly the class of bug "verify migrations on a clean database" exists to catch. This had been sitting undetected in a migration already committed to `main` two commits ago. Fixed by moving the policy to `20260101000018` (right after its dependency exists), leaving `20260101000017` to create the table and enable RLS with no policies of its own — consistent with how the *other* deferred-dependency policy (`organizations_update_manager_plus`, needing `has_org_role()`) was already correctly handled in `20260101000021`. Re-running `supabase start` with the fix — result recorded below once it completes (not claimed in advance).
- Corrected the record on commit cadence: the branch already had 10 commits before this instruction arrived (one per completed milestone/fix, `git log` verified) — the earlier report that "nothing has been committed" was inaccurate; continuing the same per-milestone commit discipline going forward regardless.

## 2026-07-30 (continued, 3) — Phase 7 implementation begins: M1-M4 closed or substantially closed

Per Mohammed's "BEGIN PHASE 7" instruction: verified the four production-readiness documents were complete (they were), confirmed the `pre-propertyvault-pivot` backup branch exists, created `propertyvault/phase-7-implementation` from `main` without touching history, and verified `TASKS.md`'s checkboxes against the actual repository before trusting them (found them accurate).

- **Closed R-01 (Critical → Medium)**: implemented the demo-mode auth-bypass fix `SECURITY.md` had only specified — dual-gated (`*_DEMO_MODE` + `ALLOW_DEMO_MODE`/`EXPO_PUBLIC_ALLOW_DEMO_MODE`, both default false), `server-only`-enforced on the web side, EAS-build-profile-gated on mobile (production profile omits the second gate entirely). Verified by actually building the admin app both ways (`pnpm --filter admin build`) — one gate alone produces no demo-mode activation, both together does.
- **Found and fixed** the 4 pre-existing Expo Router typed-route errors as a side effect of re-verifying typecheck (already fixed once before this session; confirmed still fixed).
- **M2**: built `resolvePortalSession()` (`apps/admin/lib/orgSession.ts`) — resolves org memberships + owner identities for the authenticated caller, the API-layer half of two-layer enforcement, deliberately kept separate from platform-admin resolution (independent role systems, per `PERMISSIONS.md`).
- **M3**: wrote `supabase/tests/multi_tenant_isolation.test.sql` — cross-org isolation, role-scoped write denial, platform-admin table isolation, extending the existing pgTAP fixture pattern. Not executed (no Docker in this sandbox, same blocker as the original RLS test) — written and committed per the explicit instruction to write tests even when they can't run here, never to claim false execution.
- **M4**: built `POST /api/v1/organizations` and `POST /api/v1/organizations/invites/accept` (wrapping the `create_organization()`/`accept_organization_invite()` RPCs from the M1 migration) plus a minimal onboarding UI. Found and logged a real gap while wiring this up (TD-14): the live `audit_events` table's schema predates the org-scoped redesign and doesn't match what `DATABASE.md` documents — these two new endpoints don't audit-log yet as a result, tracked rather than silently accepted or forced through against the wrong schema.
- **Verification, every step**: `pnpm typecheck`/`lint`/`format` green across all 7 workspaces throughout; `pnpm test` passes for every workspace except `apps/mobile` (the pre-existing, documented jest-expo/Windows bug — unrelated, unchanged).
- **7 focused commits** on `propertyvault/phase-7-implementation`, each scoped to one milestone/fix, none touching the pre-existing uncommitted files identified at session start (`apps/admin` dashboard pages, `apps/mobile` auth/demo files, `package.json`/`pnpm-lock.yaml`, `reference/`, etc.) — those remain exactly as they were, preserved per instruction.
- Updated `TASKS.md`/`RISK_REGISTER.md`/`TECHNICAL_DEBT_REGISTER.md`/`KNOWN_BUGS.md` to reflect actual current status, not aspirational status.

**Remaining open items in M1-M4** (not closed, stated plainly): the `properties.owner_user_id`→`org_id` contract-phase cutover (explicitly scoped to M5); RLS test _execution_ (blocked on Docker, R-02, the one remaining Critical risk); the Organisation compliance-profile settings screen; the `is_admin()`→`is_platform_admin()` rename (deferred to M19 by design). None of these block continuing to M5.

## 2026-07-30 (continued, 2) — Production Readiness Review (Principal-Architect-level design gate)

Ran the full 22-dimension production-readiness review Mohammed requested, treating the entire architecture as one system rather than 15+ separate documents. This surfaced three areas with **no design at all** prior to this pass — caching strategy, mobile offline/sync support, and backup/disaster-recovery/observability — plus 9 narrower gaps (accounting period locking, two denormalization-consistency rules, platform-metrics scalability, RLS performance at scale, search indexing, cost optimization, a WhatsApp information-disclosure bug, and one undesigned evidenced AI feature). Fixed all 12 at the design level directly in the affected documents (`ARCHITECTURE.md`, `DATABASE.md`, `ACCOUNTING.md`, `SECURITY.md`, `DEPLOYMENT.md`, `MOBILE_ARCHITECTURE_DECISION.md`, `WHATSAPP.md`) rather than just cataloguing them.

Produced the four requested governance documents: `PRODUCTION_READINESS_REPORT.md`, `ARCHITECTURE_DECISION_RECORDS.md` (20 ADRs), `RISK_REGISTER.md` (20 risks, severity-scored), `TECHNICAL_DEBT_REGISTER.md` (13 items, each with a paydown milestone). Final score: **72/100** — full category breakdown and rationale in `PRODUCTION_READINESS_REPORT.md`; the short version is that the paper architecture is unusually rigorous for this stage but the score is honestly capped by zero execution evidence (no tests run, no load test, no backup drill, two Critical risk items specified-but-not-yet-built).

No migrations touched — documentation only, per standing instruction. Next real step per the review's gate decision: close R-01 (demo-mode bypass fix) and R-02 (RLS isolation tests) per their assigned milestones before any real deployment; other implementation work (e.g. continuing the M1 properties cutover) is not blocked on either.

## 2026-07-30 (continued) — Architecture review pass, PRODUCT_SPEC.md, restated milestone order

Per Mohammed's follow-up instruction: held off on further migrations (as explicitly instructed) and instead read all 12 architecture documents in full — including the 7 written by background agents last session, which I hadn't personally re-read line-by-line until now — and ran a structured consistency review (duplicated concepts, missing relationships, conflicting rules, inconsistent naming, security weaknesses, scaling bottlenecks, accounting edge cases, multi-tenancy issues, permission gaps).

- Found and fixed real cross-document gaps: four tables (`verified_phone_numbers`, `whatsapp_conversation_state`, `usage_events`/`usage_snapshots`, `email_suppressions`) that other documents assumed existed but were never actually added to `DATABASE.md`; three enum gaps (`organizations.status` archived, `audit_events.actor_type` ai_assisted, `notification_preferences.category` inspections/security); a real information-disclosure issue in WhatsApp's disambiguation flow (fixed to stop naming property/org before identity is resolved); an `is_admin()`/`is_platform_admin()` naming inconsistency across three documents (both names now consistently caveated as target-vs-current); a permissions-table ambiguity around delete semantics; and four previously-unaddressed accounting edge cases (partial payments, multi-owner rounding, mid-lease amendments, shared expenses), each given a concrete V1 answer rather than left open. Full list in `DECISIONS.md` 2026-07-30.
- Wrote `PRODUCT_SPEC.md` — the single-source-of-truth document Mohammed asked for, indexing every module/role/screen/notification/AI capability/integration against the detailed design docs.
- Rewrote `TASKS.md` (16 milestones → 25, M0-M25) to match Mohammed's restated exact implementation order, and updated `ROADMAP.md` accordingly (previous ordering kept, collapsed, for history).
- No migrations touched this session, per explicit instruction. All changes are documentation.

## 2026-07-30 — PropertyVault Phase 1 architecture + Phase 7 Milestone 1 (multi-tenancy foundation)

Continued autonomously per Mohammed's instruction to proceed through architecture finalization and controlled implementation without pausing for ordinary engineering decisions.

- Wrote the full production architecture document set: `DATABASE.md` (complete multi-tenant ERD — organizations/membership, portfolio, leasing, inspections/maintenance, documents/OCR, communication, AI, full accounting subsystem, audit, secrets handling, RLS strategy), `ARCHITECTURE.md`, `PERMISSIONS.md` (platform vs. org RBAC, owner/tenant scoping), `ACCOUNTING.md` (double-entry, immutability/reversing-entries rule, posting rules per source type, trust accounting, owner statements, tax pack, bank reconciliation), `API_SPEC.md` (full endpoint surface, conventions, cross-cutting enforcement rules), and extended `MOBILE_ARCHITECTURE_DECISION.md` with a reusable-business-logic-vs-UI analysis of the existing Expo app.
- Delegated (parallel background agents, each grounded in the docs above for consistency) rewrites/new docs: `SECURITY.md` (demo-mode bypass fix designed concretely, multi-tenant trust boundaries, encrypted-secrets pattern), `AI_ARCHITECTURE.md` (new — conversational Assistant with staged-changes/confirm-before-apply, separate non-LLM Portfolio Intelligence rules engine), `SUPER_ADMIN.md` (new — full dashboard/directory/actions/billing/support-mode spec, gaps flagged not invented), `WHATSAPP.md` (new — single shared-number architecture, verified-phone resolution algorithm, fixed trigger-list policy), `EMAIL.md` (new — full comprehensive-channel spec, provider abstraction), `TESTING.md` (rewritten — RLS/multi-tenant-isolation tests flagged highest priority, accounting invariant tests, native testing), `DEPLOYMENT.md` (rewritten — web/iOS/Android pipelines, migration/rollback strategy).
- Wrote `TASKS.md`: 16 dependency-ordered implementation milestones from `ROADMAP.md`'s V1 priority order, each with explicit exit criteria.
- **Milestone 0**: created `pre-propertyvault-pivot` branch pointer at the last committed PropVault-era commit (non-destructive — did not touch the working tree or commit anything; committing remains something only Mohammed does explicitly, per standing instruction).
- **Milestone 1 (multi-tenancy foundation) implemented**: new migrations `20260101000016`–`20260101000021` — organization enums, `organizations`, `organization_members`/`organization_invites`, `plans`/`organization_subscriptions`/`subscription_payments`, `support_access_sessions`, and `has_org_role()`/`create_organization()`/`accept_organization_invite()` security-definer functions (mirroring the existing `is_admin()` pattern). Decided and logged (`DECISIONS.md`) to defer the `admin_users`→`platform_admin_users` rename to Milestone 13 rather than do it now, since it's a pure-cosmetic change that would touch live working code (`apps/admin/lib/auth.ts`/`middleware.ts`) for no functional benefit ahead of the Super Admin portal rebuild that opens those files anyway.
- Added `packages/types/src/organization.ts` and extended `packages/types/src/enums.ts` with the new organization-layer enums, mirroring the migration's Postgres types per the codebase's existing convention.
- Found and fixed, as a side effect of running `pnpm typecheck` to verify the above: the previously-undocumented Expo Router typed-route failures flagged in `EXISTING_CODEBASE_AUDIT.md` §8 (4 sites across `upload.tsx`/`processing.tsx`/`review.tsx` using string-interpolated `pathname`s instead of the typed `[id]`-segment + `params` form) — fixed by switching to the typed form. **Verified**: `pnpm typecheck` and `pnpm lint` both pass cleanly across all 7 workspaces, including `apps/mobile`, for the first time this project has been fully green (the jest-expo/Windows _test-runner_ bug in `KNOWN_BUGS.md` is separate and still unresolved — that's `pnpm test`, not `typecheck`/`lint`).
- Migrations are not applied against any live Postgres instance in this session (no local Docker/Supabase instance — same sandbox limitation `KNOWN_BUGS.md`/`DECISIONS.md` already documented for RLS tests); they are reviewed SQL, not yet executed. RLS behavior is `Verified: reviewed against the pattern`, not `Verified: executed`, until they're run against a real instance.

## 2026-07-29 — PropVault → PropertyVault pivot: audit phase

Confirmed with Mohammed: PropertyVault (full multi-tenant landlord/tenant property-management SaaS, modeled on the "PropView" reference product) supersedes PropVault (personal document-vault app for individual owners) as the product direction, decided module-by-module on evidence rather than a wholesale restart.

- Located and inventoried the reference screenshot set: `reference/propview-screenshots/` (138 files). Ran 4 parallel audit passes (one per ~35-image batch) that opened and visually inspected every image — not filename-only classification — and wrote `PROPVIEW_SCREENSHOT_AUDIT.md`: full information architecture (Landlord Console + Tenant Portal sidebars), module grouping, key workflow reconstructions (application→tenant/lease/rent auto-creation, rent-due→invoice pipeline, owner-statement drafting, deposit trust lifecycle, maintenance submission), desktop/mobile mapping, and design-system extraction. Confirmed PropView itself is a single Expo/React-Native-Web app (not a native app) serving both breakpoints from one domain, and is deeply South Africa–specific (POPIA, RHA, SARS tax years, CIPC, Property Practitioners Act FFC) — not a generic template.
- Ran a full codebase audit (read-only; all 15 migrations, RLS policies, auth code on both apps, all shared packages, `pnpm install`/`lint`/`typecheck`/`test`/`build`) — `EXISTING_CODEBASE_AUDIT.md`. Headline finding: the database schema is fundamentally single-tenant (every business table keyed by `owner_user_id → auth.users`, zero organization/landlord/tenant/lease/rent concepts anywhere) — this is a hard blocker requiring a new org/membership layer and near-total table redesign, not additive columns. No accounting/ledger engine exists at all. The demo-mode auth bypass flagged in `SECURITY.md` is confirmed still live and unresolved. Found one previously-undocumented mobile typecheck failure (Expo Router typed routes) distinct from the already-known `jest-expo`/Windows test-runner bug.
- Synthesized both audits into `RETAIN_REFACTOR_REBUILD_MATRIX.md` — module-by-module retain/refactor/rebuild decisions across ~35 modules, plus a proposed (not yet confirmed) V1 exclusion list and five open scope questions (target jurisdiction, V1 scope confirmation, vendor portal need, external WhatsApp/email provider accounts, build-vs-integrate call on the accounting engine).
- Confirmed no native iOS/Android project exists anywhere in the repo (zero `.xcodeproj`/`.xcworkspace`/`build.gradle`/`AndroidManifest.xml` hits); wrote `MOBILE_ARCHITECTURE_DECISION.md` — one native app per platform (Swift/SwiftUI on Xcode; Kotlin/Jetpack Compose on Android Studio/Gradle), role-aware navigation switching Landlord/Tenant portals within a single app rather than four separate store listings, reasoned from the reference product's own single-login dual-portal account model.
- Did not touch any existing code or schema this session — audit and documentation only, per the master prompt's explicit instruction not to begin implementation before the retain/rebuild decision is evidenced and recorded.
- Presented the audit findings and open scope questions to Mohammed; all five resolved (South Africa-specific jurisdiction, Tax Pack + simplified Portfolio Map added into V1, Tasks & Reminders implemented inline rather than as a standalone module, no vendor portal in V1, accounting engine built in-house). Updated `RETAIN_REFACTOR_REBUILD_MATRIX.md`, created `ROADMAP.md` with the confirmed V1 priority order, and logged the decisions in `DECISIONS.md`. Ready to begin Phase 5 (controlled implementation, starting with a backup branch and the multi-tenancy schema) next session.

## 2026-07-21 — Phase 0 + Phase 1 kickoff

- Inspected repository: the working directory `PropValt (Property App)/` was empty; the machine's ambient Git repository was rooted at the home directory (unrelated, accidental) — see DECISIONS.md. Initialised a new, correctly-scoped Git repo in-place and added `origin` = the specified GitHub repo (confirmed empty and reachable via `gh repo view`).
- Verified current package versions via live web search (Expo SDK 56/RN 0.85, Next.js 16.2.7, supabase-js 2.110.7, Zod 4.4.3, react-native-purchases 10.4.0) rather than relying on the assistant's training-data snapshot, since the current date is well past the knowledge cutoff.
- Scaffolded monorepo root: pnpm workspaces, Turborepo, base tsconfig, flat ESLint config, Prettier, `.gitignore`, root `.env.example`.
- Wrote the full Phase 0 documentation set.
- Built shared packages (types, config, validation, utils, ui), Supabase migrations (RLS on every customer table, storage bucket policies, monthly-checklist function), the mobile Expo Router app (auth, onboarding, biometric lock, property CRUD, mock subscription/document-intelligence providers), and the admin Next.js app (login, role-gated dashboard shell, overview/customers/subscriptions/processing/system pages backed by live Supabase counts).
- Verification pass: `pnpm install` (clean, all workspaces resolve), `pnpm format` (61 files auto-fixed, then clean), `pnpm typecheck` (all 7 packages pass after fixing an `ALLOWED_MIME_TYPES` import boundary, admin cookie-handler typing, and a mobile `Property` enum cast), `pnpm test` (packages/utils, packages/validation, packages/config, apps/admin all pass — 32 tests; apps/mobile's `jest-expo` runner crashes on this Windows/Node combination with an upstream tooling bug unrelated to application code, root-caused and documented in KNOWN_BUGS.md rather than left unexplained).
- Rebalanced the payment-match scoring weights after the first test run correctly caught that a supplier/recipient name mismatch alone (e.g. "Municipality" vs "City of Cape Town" — the brief's own example) was knocking an otherwise-fully-matching pair out of the "strong match" band; reduced supplier weight from 15→10 and redistributed to amount/reference (25→30 each) so the brief's worked example lands in the intended 90-100% band.

## 2026-07-22 — Phase 2: demo-ready polish for a client meeting

Scope changed to prioritise a convincing, fully-navigable demo over backend completeness (see DECISIONS.md for the full reasoning). Delivered, all reading through a new demo-mode data layer rather than forking production code:

- **Demo infrastructure**: `EXPO_PUBLIC_DEMO_MODE`/`NEXT_PUBLIC_DEMO_MODE` flags (default ON — see SECURITY.md's new release-blocking warning), an in-memory Zustand-backed mock database for mobile (`apps/mobile/src/demo/`) seeded with 3 realistic properties/documents/bills/payments, and static realistic mock data for admin (`apps/admin/lib/demo/`, 24 customers + revenue/OCR/activity feeds).
- **Mobile**: rebuilt Dashboard (live stats, monthly completion, recent uploads), Property Detail (hero, Property Health card matching the brief's exact example format, quick actions, recent activity), a full upload → AI processing (animated step list) → extraction review (editable cards) → payment matching (confirm/reject against the real `calculateMatchScore`) flow, Monthly Checklist, instant Search, and a fully-populated Settings screen (profile/subscription/storage/biometric/notifications/dark-mode override/about). Added a small animation primitives set (`FadeSlideIn`, `AnimatedProgressBar`, `SuccessCheck`, `PulsingDot`) used throughout for entrance/progress/success motion.
- **Admin**: demo-mode auth bypass (`lib/auth.ts`, `middleware.ts`, `/login`) so the dashboard is reachable with zero Supabase project; polished Overview (MRR/signup trend charts, system health, recent activity), Customers (24 mock accounts), Subscriptions, Processing (OCR job queue with retry/failure states), System (feature flags, integration health) — all hand-rolled SVG/CSS charts, no new charting dependency.
- **Dependency correction**: `expo-doctor` caught that Phase 1's `apps/mobile/package.json` had pinned several `expo-*` packages to pre-SDK-56-unified version numbers (e.g. `expo-constants@~18.0.2` instead of the SDK 56-correct `~56.0.21`) — ran `npx expo install --fix` to realign every Expo package with what SDK 56 actually expects; `expo-doctor` now reports 21/21 checks passing.
- **TypeScript 6 fix**: the corrected `typescript@~6.0.3` in `apps/mobile` stopped auto-including `@types/jest`/`@types/node` globals (a real behavioural difference from TS 5.x, not a config regression) — fixed by declaring `"types": ["jest", "node"]` explicitly in `apps/mobile/tsconfig.json`.
- **Verification**: `pnpm typecheck`/`pnpm lint`/`pnpm format:check` all pass 7/7 packages; 43 unit tests pass (packages/utils, packages/validation, packages/config, apps/admin — apps/mobile's jest-expo suite remains blocked by the pre-existing upstream bug documented in KNOWN_BUGS.md, unrelated to Phase 2); `apps/admin` production build succeeds; `npx expo export --platform web` successfully bundled all 1107 modules (including every new `@/`-aliased import) with zero resolution errors — the strongest available proxy in this sandbox for "the app actually runs," short of a real device/simulator.
