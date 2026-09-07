# Public Black-Box UAT Report

**Target (public internet):** `https://proplyst.co.za`
**Date:** 2026-09-06
**Method:** Real Chromium browser (Playwright 1.62.1) driven against the public deployment from the
internet. No localhost, no Docker, no local Supabase. The browser is the source of truth.
**Harness:** `apps/admin/scripts/uat-public-blackbox.mjs` (refuses to run against a local or non-HTTPS target)
**Result:** 54/54 automated perimeter checks passed. **The authenticated journey was never executed — see Blockers.**

---

## 1. Public URL — corrected

The mandate supplied a placeholder (`<INSERT ACTUAL PROPLYST PUBLIC APP URL>`) and offered
`https://app.proplyst.co.za` as an example. That example is wrong.

| Candidate | Result |
| --- | --- |
| `https://proplyst.co.za` | **200 — this is the live application** |
| `https://www.proplyst.co.za` | 301 (redirect) |
| `https://app.proplyst.co.za` | Does not resolve (DNS failure) |

All testing below used `https://proplyst.co.za`.

---

## 2. BLOCKERS — why the bulk of this mandate could not be executed

The mandate's core (sections 4–19: create a property, units, tenants, leases, then reconcile
dashboards, finances, budgets, expenses, utilities, rent, maintenance, documents, reports) requires
an authenticated session. None was achievable. These are hard, verified blockers, not omissions.

### B1 — No UAT credentials exist (`Verified`)

Section 3 requires credentials "supplied through secure local environment variables or an approved
secret mechanism." No such values exist. Checked and found absent: `UAT_EMAIL`, `UAT_PASSWORD`,
`UAT_OWNER_EMAIL`, `UAT_OWNER_PASSWORD`, `PROPLYST_UAT_EMAIL`, `PROPLYST_UAT_PASSWORD`,
`UAT_STAFF_EMAIL`, `UAT_TENANT_EMAIL`, `E2E_EMAIL`, `E2E_PASSWORD` — in the shell environment and in
`apps/admin/.env.local`. The mandate separately forbids using personal production administrator
credentials, so no substitute was available.

### B2 — Self-service signup cannot reach property creation (`Verified`, from source)

Creating the UAT organisation "through the normal public application flow" is blocked by two
independent server-side gates in `supabase/migrations/20260101000117_commercial_setup_rls_enforcement.sql`:

1. `create_organization()` raises `owner_subscription_required: an active Proplyst owner
   subscription is required to create your own portfolio.` unless `may_create_portfolio()` passes.
2. Every organisation it does create is inserted with `commercial_setup_required = true`, and
   `create_property()` refuses while `commercial_setup_completed_at is null`.

The public landing page states the commercial terms plainly: *"30-day free trial. Payment method
required. No charge today."* So reaching section 5 (create a property) requires completing payment-method
setup against the **production** gateway.

### B3 — Payment mode on production is unknown, and transacting was not authorised

`PAYFAST_MODE=sandbox` is the value in the **local** env file; it says nothing about the deployed
configuration, which is not visible from here. Section 27 requires sandbox/test mode and "do not
incur real charges." With production's mode unverified and no authorisation to transact, payment
setup was not attempted.

### B4 — Creating the UAT organisation writes to production

`https://proplyst.co.za` is backed by the production Supabase project (confirmed by the OAuth
redirect chain in §5). Registering "Proplyst UAT Portfolio" through the public flow necessarily
writes production auth and organisation rows. Every prior instruction in this engagement states
*"Do NOT modify production Supabase data."* Not attempted without explicit resolution of that conflict.

**Consequence:** sections 4–19, 20 (authenticated navigation matrix), 22 (refresh-after-save),
23 (staff persona), 24 (tenant persona), and the authenticated half of 25 (cross-org security) are
**NOT EXECUTED**. They are not passes and not failures — they were never reachable.

---

## 3. What WAS tested — unauthenticated public perimeter

Read-only throughout. No records created, no forms persisted, no messages or emails sent.
One deliberately-invalid login attempt was made, addressed to a reserved `.invalid` domain
(RFC 2606) that cannot route mail to any real person.

### 3.1 Public pages (12/12)

`/`, `/login`, `/register`, `/forgot-password` — all HTTP 200, **zero console errors**, **zero failed
subresource requests**.

### 3.2 Unauthenticated access control (16/16) — no data exposure

| Route | Result |
| --- | --- |
| `/dashboard`, `/properties`, `/tenants`, `/leases`, `/maintenance`, `/documents`, `/reports`, `/settings`, `/budget`, `/notifications` | Redirected to `/login` |
| `/overview`, `/payments`, `/expenses`, `/utilities`, `/admin`, `/organizations` | HTTP 404 (not routable at these paths) |

No route served portfolio data to an anonymous visitor.

### 3.3 Direct API access, unauthenticated (10/10) — the highest-value security check

Tested by direct HTTP request, not UI navigation, per the mandate.

| Endpoint | Status |
| --- | --- |
| `/api/v1/properties`, `/api/v1/tenants`, `/api/v1/leases`, `/api/v1/organizations`, `/api/v1/documents`, `/api/v1/expenses`, `/api/v1/notifications` | **401** |
| `/api/v1/maintenance`, `/api/v1/reports/portfolio`, `/api/v1/payments` | 404 (no route at that path) |

Every response body was additionally scanned for record-shaped fields (`id`, `org_id`, `tenant_id`,
`nickname`, `address_line1`, `amount`). **No unauthenticated endpoint returned any record data.**

### 3.4 Transport and security headers (3/3)

- `strict-transport-security: max-age=63072000; includeSubDomains; preload`
- Clickjacking defence present
- `x-content-type-options: nosniff`

### 3.5 Login error handling (3/3)

Invalid credentials → stays on `/login`, shows **"Invalid email or password."** The message
correctly does **not** disclose whether the account exists. The only console error was the expected
`401` from the auth endpoint, which is the correct response to bad credentials.

### 3.6 OAuth — physically exercised, not assumed (2/2)

The mandate forbids claiming OAuth works unless physically exercised. Each button was clicked and
the redirect chain followed to the provider's own domain. Sign-in was **not** completed and no
account was authenticated.

- **Google** → `302` → `accounts.google.com/o/oauth2/v2/auth` with a real client ID → Google sign-in screen. Handshake accepted.
- **Apple** → `302` → `radqoboichldiucydrgy.supabase.co/auth/v1/authorize?provider=apple` → `appleid.apple.com/auth/authorize?client_id=co.za.proplyst.web`. Handshake accepted.

Both providers are genuinely configured in production. **This corrects `ENVIRONMENT.md`**, which
records Google and Apple sign-in as `enabled = false` until credentials are set — stale with respect
to the deployed environment.

### 3.7 Responsive (4/4)

`/login` at 1440, 1280, 1024 and 768 px — no horizontal page overflow at any width.

### 3.8 Light and dark mode (4/4)

The app uses Tailwind `darkMode: 'class'` via `next-themes`, so emulating `prefers-color-scheme`
tests the wrong mechanism. The real persisted-theme switch was exercised instead:

| Theme | `.dark` class | Background | Text |
| --- | --- | --- | --- |
| Light | absent | `rgb(249,250,251)` | `rgb(17,24,38)` |
| Dark | present | `rgb(11,15,22)` | `rgb(241,244,247)` |

The two themes render distinctly and both are legible. A first-time visitor whose OS prefers dark is
served **light** — correct, matching the recorded `defaultTheme="light"` decision in `app/layout.tsx`.

---

## 4. Defects found

### D1 — Logo renders as a dark box on light surfaces (Severity: Low / cosmetic)

**Where:** landing-page header and footer, `/login`, `/register` card.
**Observed:** the logo appears as a small black rectangle on the white card and light header.
**Cause:** `apps/admin/branding/proplyst-logo.png` is an **opaque dark-ground raster** (555×319,
navy/black background with a white-and-blue mark), rendered by
`components/branding/ProplystLogo.tsx` directly onto light surfaces. In dark mode it blends
correctly, which is why the defect is light-mode only.
**Impact:** first impression on the public landing and sign-in screens looks unpolished.
**Status:** **documented, not fixed.** A correct fix needs either a transparent-background asset or a
light-mode logo variant — a branding asset decision, and the engagement is under V1 feature freeze
with the approved design direction explicitly out of scope for unilateral change.

### D2 — Marketing mockup shows a non-resolving domain (Severity: Low / cosmetic)

The landing-page product illustration shows browser chrome reading `app.proplyst.co.za/dashboard`.
That hostname does not resolve (§1). A customer who types it reaches nothing.
**Status:** documented, not fixed.

---

## 5. Investigated and dismissed — not defects

Recorded so these are not re-reported later as bugs.

- **Large blank band on the landing page.** A full-page screenshot showed ~520 px of empty white
  between the hero and pricing. Investigated: the section exists, is visible, 653 px tall, and its
  inner content wrappers sit at `opacity: 0` awaiting scroll reveal. Scrolling the page as a real
  visitor moved every wrapper `0 → 1`, and an in-view screenshot shows the "Everything a property
  business actually runs on" six-card grid rendering correctly. **Artifact of `fullPage`
  screenshotting, which never fires IntersectionObserver. Not a bug.**
- **Dark mode appeared identical to light.** Caused by emulating `prefers-color-scheme` against a
  class-based theme implementation. Retested via the real mechanism — dark mode works (§3.8). **Not a bug.**
- **Console error during failed login.** The `401` is the correct response to invalid credentials;
  Chromium logs a console error for any failed fetch. **Not a bug** — the harness check was corrected.

---

## 6. External side-effect safety

- No WhatsApp message sent. No email sent. No payment initiated. No charge incurred.
- No account registered, no organisation created, no production record written or modified.
- The single login attempt used `uat-blackbox-nonexistent@example.invalid` — a reserved TLD that
  cannot deliver mail to a real person.
- OAuth flows were followed only to the provider consent screen and abandoned; no authentication completed.

---

## 7. Verdict

### PUBLIC WEB UAT: **FAIL (not executed)**

Not a verdict about product quality. The perimeter that could be tested passed 54/54 with a
genuinely strong security posture. But the mandate's substance — the owner journey from signup
through properties, leases, finances and reports — was never exercised, because no credentials
exist (B1) and self-service signup cannot reach property creation without production payment setup
(B2–B4). A PASS cannot be issued for work that did not run.

### PILOT CUSTOMER WEB EXPERIENCE: **NOT READY**

Two independent reasons:

1. The authenticated experience a pilot customer would actually live in has not been tested against
   the public deployment at all.
2. The preceding external-communications release gate closed at **FAIL** — WhatsApp and email both
   still fall back to mock providers in the absence of Meta and Resend credentials, so no real
   message or email has been shown to reach a recipient.

---

## 8. What is needed to complete this pass

1. **UAT credentials** for an existing account on `https://proplyst.co.za`, supplied via environment
   variables (never pasted into chat, files, or logs). Owner, staff, and tenant personas are needed
   for sections 23–24.
2. **A provisioned "Proplyst UAT Portfolio" organisation** with its subscription and commercial setup
   already completed — or explicit authorisation to complete payment setup on production, with the
   deployed `PAYFAST_MODE` confirmed as sandbox first.
3. **Explicit authorisation** that writing UAT data to the production Supabase project is acceptable,
   since it conflicts with every prior standing instruction in this engagement.
4. **Deployment permission**, separately, if any defect found in the authenticated journey is to be
   fixed and re-verified against the public app — the mandate correctly forbids marking a browser
   test passed against undeployed local code.

---

## 9. Second pass, 2026-09-06 — authorised UAT provisioning attempt: BLOCKED BY TOOL PERMISSION

Authorisation was granted to create a dedicated "Proplyst UAT Portfolio" organisation with
production-backed records, synthetic personas, real WhatsApp sends to the UAT number, and a full
authenticated black-box sweep. **The pass could not start.**

Every remaining section depends on programmatic access to the production Supabase project — to read
the deployed provider configuration, to provision the UAT organisation through an approved admin
path, and to create the three personas. The agent's own permission layer (the Claude Code auto-mode
classifier) **denied execution of any script that connects to production with the service-role key**,
via both the Bash and PowerShell tools:

> `Permission for this action was denied by the Claude Code auto mode classifier.`

This is a tooling guardrail, not a product defect and not a missing credential. It is correct
behaviour by default — the gate exists precisely to stop an agent running arbitrary code against a
production database. It simply has to be lifted deliberately for this authorised pass to proceed.

**Consequently NOT executed:** §1 (create UAT organisation), §2 (determine deployed PayFast mode),
§3 (personas), §4 (owner sweep), §5 (staff persona), §6 (tenant persona), §7 (UAT data),
§8–§12 (WhatsApp outbound, provider check, scenarios, delivery verification, inbound), §13 (email),
§14 (error monitoring of authenticated screens).

Prepared and ready to run the moment access is granted: `apps/admin/scripts/uat-public-recon.mjs`
— strictly read-only, prints no secret values, and establishes the three facts §2/§9/§13 require
(which organisations exist so no real customer org is touched; whether the deployed WhatsApp
provider is real, inferred from whether stored `provider_message_id` values are Meta `wamid.*` ids
or mock UUIDs; and the same for stored email rows).

### Why the deployed PayFast mode still cannot be asserted

`PAYFAST_MODE=sandbox` in `apps/admin/.env.local` is the **local** value and says nothing about
Render's runtime environment, which is not visible from this session (a standing gap throughout
this engagement). The reliable, charge-free way to determine it is to generate a checkout through
the deployed app and read the form's target host — `sandbox.payfast.co.za` versus
`www.payfast.co.za`. Generating a checkout URL incurs no charge. That requires an authenticated
session, so it is blocked with everything else. **No payment method was submitted and no charge was
incurred.**

## 10. Cosmetic fixes — prepared locally, NOT deployed

Both defects from §4 are fixed in the working tree. Neither is deployed; the public site still shows
the old behaviour.

### D1 — logo on light surfaces (`components/branding/ProplystLogo.tsx`)

The brief asked to "use the existing transparent Proplyst logo asset if available." **No transparent
asset exists** — `branding/proplyst-logo.png` is the only logo in the repository.

More importantly, manufacturing one would make things worse, and this is worth recording so it is
not attempted later. Sampling the PNG directly: it has an alpha channel, but the entire background
is opaque and effectively uniform near-black (the whole border ring falls between `rgb(0,0,0)` and
`rgb(1,7,22)`), **and the "Proplyst" wordmark itself is white**. Keying the dark ground out would
leave white lettering invisible on every light-mode card — strictly worse than the black box. A
genuine light-mode fix needs a dark-lettered logo variant from whoever owns the brand assets.

Applied instead, without redesigning the brand: `rounded-md` on the image, so the asset's own dark
ground reads as a deliberate logo tile rather than a hard-edged black rectangle. Sizing stays
entirely caller-controlled, so no layout shifts. One component change covers all 14 call sites.

### D2 — marketing mockup domain (`components/marketing/ProductPreview.tsx`)

`app.proplyst.co.za/dashboard` → `proplyst.co.za/dashboard`. The dead subdomain was **not** created.

### Verification of both

ESLint clean, `tsc --noEmit` clean, `npm run build` succeeds, and the marketing component suite
passes 7/7. Not deployed, not committed, not pushed.

## 11. Third pass, 2026-09-06 — authenticated UAT executed against the public deployment

Authorisation was granted to provision a production-backed UAT organisation. This pass ran the
authenticated owner journey, cross-account security testing, and a full navigation sweep against
`https://proplyst.co.za` in a real Chromium.

### 11.1 Provisioning (§1–§3)

| Item | Value |
| --- | --- |
| Organisation | **Proplyst UAT Portfolio** |
| Org id | `6b4d43a8-2bac-4ac9-ab9e-883c0303d3a7` |
| Owner / staff / tenant | three synthetic identities on the reserved `.invalid` TLD |

Path taken, deliberately the narrowest existing mechanism and **no SQL bypass**:

1. `auth.admin.createUser({ email_confirm: true })` — the supported admin identity API. Pre-confirming
   avoids needing a mailbox and sends no email to anyone.
2. `signInWithPassword()` as the UAT owner, then `create_organization()` over RPC **with that real
   user JWT** — the same path a real customer takes. (It is SECURITY DEFINER and raises without
   `auth.uid()`, so a service-role connection genuinely cannot call it.)
3. `activate_trial_after_payment(org_id)` with the service-role key — the purpose-built RPC that is
   `revoke all ... from public, authenticated, anon`, idempotent, and touches only this org's own
   commercial-gate columns. It is what every pgTAP fixture uses after `create_organization()`.

No RLS weakened, no global commercial rule changed, no real organisation or subscription touched.
Organisation count went 10 → 11; the ten pre-existing orgs were read for identification only.

### 11.2 PayFast deployed mode (§2) — **LIVE, not sandbox**

Determined with **zero charge** by generating a real checkout through the deployed app and reading
where it went, then abandoning it without entering any payment detail.

- Observed: the browser ended on `https://payment.payfast.io/eng/process/payment/…`, with
  `comms.payfast.io` sockets. `sandbox.payfast.co.za` never appeared anywhere in the chain.
- Code mapping, [`lib/providers/payfast.ts:83`]: `live → https://www.payfast.co.za`,
  `sandbox → https://sandbox.payfast.co.za`. `payment.payfast.io` is where the live host forwards.

**Conclusion: the deployed PayFast is in LIVE mode.** Per the brief, no payment method was
submitted and none will be. Evidence that nothing was charged, read back from the UAT org:
`subscription_payments` = 1 row **status `pending`**, `payment_methods` = **0**,
`billing_events` = **0** (PayFast never sent an ITN). **PAYMENT CHARGES INCURRED: NO.**

> This is a safety finding in its own right: any UAT that completes a checkout on this deployment
> would create a **real** charge on a real card.

### 11.3 THE HEADLINE DEFECT — production code is 7 migrations ahead of its database

`supabase migration list --linked` shows production applied through **20260101000162**.
Migrations **163–169 have never been applied** (`remote` empty), yet the deployed application
already ships the routes and UI that query the tables those migrations create.

Confirmed empirically — these six tables are **absent from the production API** (PostgREST
`PGRST205`, verified as the signed-in UAT owner):

| Missing table | Migration | Feature it breaks |
| --- | --- | --- |
| `recurring_property_costs` | 163 | **Rates & taxes, levies** |
| `utility_responsibility_settings` | 163 | **Water / electricity responsibility** |
| `utility_meters`, `utility_readings` | 163 | **Meters — conventional and prepaid** |
| `property_budgets`, `budget_category_lines` | 164 | **Budgets** |

Directly observed consequences on the public site:

- `GET /api/v1/properties/{id}/recurring-costs` → **HTTP 500** `recurring_costs_list_failed`
- `GET /api/v1/properties/{id}/utility-settings` → **HTTP 500** `utility_settings_list_failed`
- 14 such 500s fired during ordinary unit creation, with and without a `unitId` parameter.
- Budget: the page renders, but "Set budget" only links to the property Finances tab and no budget
  can ever be stored.

Migrations 165–168 (payment-report ledger allocation, owner and portfolio financial summaries,
expense category codes) are also unapplied, so §8's cross-surface financial reconciliation cannot
be fully exercised either.

**This affects every real customer organisation, not only UAT.** Classification: **V1 blocker.**
The fix is not a code change — the code is correct and the database is behind — so nothing was
fixed locally here. Applying migrations to production is explicitly out of scope for this pass and
needs its own reviewed, backed-up deployment.

**Blocked by this defect:** §6 (rates & taxes, levies, utility responsibility, meters), §7 (budget,
in full), §9 (utilities), and the cross-surface half of §8.

### 11.4 What DID work — owner journey through the real UI

All created through the deployed UI as a customer would, each with save → refresh → re-read:

| Built | Result |
| --- | --- |
| 3 properties (apartment block, house, commercial) | created, persisted after full reload |
| 7 units | created, persisted (4 Seaside, 1 Hillcrest, 2 Offices) |
| 3 tenants | created "manage internally only" — **no invitation email sent** |
| 3 leases | recorded, then **activated**: Active 3 / Draft 0 |
| Occupancy | **Vacant 4 / Occupied 3** — correctly lease-derived, not a manual flag |
| Rent schedules | **6 generated automatically** on activation |

**Financial reconciliation (§8), independently checked:** R15 000 + R8 500 + R8 500 = **R32 000**
per month; Rent Due shows exactly those six schedules across September and October 2026 at that
total. The arithmetic reconciles.

**Navigation sweep:** 29 owner screens — **28 clean, 0 unexpected 4xx, 0 unexpected 5xx** on
initial load. (The drift 500s surface in sub-flows, not top-level page loads.)

### 11.5 Security (§11–§13) — 42/42

The staff and tenant identities are not members of the UAT organisation, making them exact
negative-control principals. Tested by **direct API id substitution**, not by clicking navigation,
because hidden links are not security.

- 11 API endpoints × 2 personas: property, units, lease-by-id, tenant-by-id, expenses, documents,
  org members, billing → **404 / 403 / scoped-empty 200. Not one byte of UAT org data returned.**
- 10 direct page URLs × 2 personas → never rendered org data.
- **42/42 pass. No cross-account exposure found.**

Honest limit: this proves **cross-account isolation**. It does **not** prove intra-organisation
role restriction, because the staff persona was never made a member of the org — so "what a
property manager may versus may not do inside their own org" remains untested.

### 11.6 Defects found this pass

| # | Severity | Defect |
| --- | --- | --- |
| D3 | **Blocker** | Migration drift 163–169 — rates/levies/utilities/meters/budgets broken in production (§11.3) |
| D4 | **High** | `recurring-costs` and `utility-settings` return HTTP 500 on the live site |
| D5 | Medium | After sign-in the app lands on `/`, which renders a **blank page** for an authenticated user; the real gate chain only starts when navigating to `/dashboard` |
| D6 | Low | `/leases/new` returns HTTP 200 with a "Something went wrong" boundary instead of 404 (no such route; real paths are `/properties/{id}/units/{unitId}/leases/new` and `/tenants/{id}/leases/new`) |
| D7 | Low | Property breadcrumb renders the raw UUID (`792ed2e3 63f5 4e82 B1fc Efd465cf8e9a`) instead of the property name |
| D8 | Low | `/organization/billing` throws minified React error #418 (hydration/text mismatch) |

Per §15/§18 none of these were deployed. D3/D4 need a migration deployment, not a code fix.

### 11.7 WhatsApp (§14–§15) — BLOCKED, and deliberately not attempted

`WHATSAPP_UAT_OVERRIDE_NUMBER` is a **server-side** variable on the deployed host. It cannot be set
from here, and Render's runtime environment is not readable from this session. Without that
override active in the deployed environment, any WhatsApp the production app sends goes to the
**recipient's own stored number**, not to the UAT destination.

The brief is unambiguous — "Never send to any other number" — so no WhatsApp send was triggered.
This is a safety decision, not a credential finding: the required pre-flight line
`WHATSAPP UAT OVERRIDE: ACTIVE` cannot be truthfully asserted, so the send must not happen.

Provider status is genuinely **undetermined**: `whatsapp_messages` holds **0 rows production-wide**,
so there is no artefact to infer from, and the only way to settle it would be to send — which is
exactly what is barred. Verified: **0 WhatsApp rows for the UAT org**, and **0 tenant records
anywhere carry +27837866021**.

§15 inbound is blocked for the same reason plus one more: the Proplyst WhatsApp sender number is
not knowable from here, so there is no honest instruction to give about what to send or where.

### 11.8 Email (§16)

**Real Resend is configured on the deployed environment** — `email_messages` carries 8 rows, all
with provider message ids and statuses `delivered` / `sent` / `bounced`; a mock provider cannot
produce a `bounced` status. **No email was sent during this pass**: 0 rows for the UAT org, tenants
were created "manage internally only", and no UAT inbox exists that could safely receive one.

### 11.9 UAT data left in production

`Proplyst UAT Portfolio` — 4 properties, 7 units, 3 tenants, 3 active leases, 6 rent schedules.
The 4th property, "UAT Temp Probe", was created while diagnosing post-save navigation and is
surplus to the 3 planned; it is disclosed rather than silently removed, since no cleanup
authorisation was given. No cleanup was performed.

## 12. Fourth pass, 2026-09-07 — PGRST205 root-caused, UAT completed to the reachable limit

### 12.1 PGRST205 ROOT CAUSE — proven, not assumed

The previous pass inferred "missing migrations" from PGRST205 alone. That was challenged and has now
been proven properly, by direct read-only SQL through the Supabase CLI (`supabase db query --linked`).

Hypotheses tested and eliminated:

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| Stale PostgREST schema cache | **Eliminated** | The relations do not exist at all |
| Schema qualification / wrong search_path | **Eliminated** | `information_schema.tables` returns no match in **any** schema |
| Grants / RLS hiding the table | **Eliminated** | A missing relation cannot be a grant problem |
| Table renamed by a later migration | **Eliminated** | No `RENAME` in 164–169; the sole "rename" hit is a comment |
| API querying obsolete relation names | **Eliminated** | Route queries `recurring_property_costs`; migration 163 creates exactly that name |
| Migrations never applied | **CONFIRMED** | See below |

Proven facts:

- Remote migration head is **`20260101000162`**, total **162** rows in `supabase_migrations.schema_migrations`.
- `select table_name from information_schema.tables where table_name similar to '%(recurring|utility|budget|meter)%'`
  returns **only** unrelated catalog rows — none of the expected tables exist anywhere in the database.
- `expenses.category_code` → **0 columns**; `expense_category_code` type → **0**;
  `owner_financial_summary` → **0 functions**; `owner_portfolio_financial_summary` → **0 functions**;
  `payment_reports` allocation columns → **0**.
- `origin/main` (the deployed branch, `e52d695`) **contains** migrations 163–168 **and** the
  `recurring-costs` route file.

**Root cause:** the application was deployed from a branch containing migrations 163–168, but
`supabase db push` was never run against production. PostgREST's PGRST205 is a truthful report of a
relation that genuinely does not exist. **This is deployment-process drift, not a code defect.**

### 12.2 PRODUCTION SCHEMA DRIFT — exact extent

| Migration | Objects never created | Feature broken in production |
| --- | --- | --- |
| 163 | `recurring_property_costs`, `utility_responsibility_settings`, `utility_meters`, `utility_readings` | Rates & taxes, levies, utility responsibility, meters (conventional + prepaid) |
| 164 | `property_budgets`, `budget_category_lines` | **All budgets**, property and portfolio |
| 165 | `payment_reports` allocation columns | Payment-report ledger allocation |
| 166 | `owner_financial_summary()` | Owner financial summary |
| 167 | `owner_portfolio_financial_summary()` | Portfolio financial summary |
| 168 | `expenses.category_code` + enum | **Expense creation** — every attempt 500s |

169 is local-only (not in `origin/main`) and is a separate, unrelated fix.

### 12.3 LOCAL REMEDIATION PREPARED

There is **nothing to author**: migrations 163–168 already exist, are already in the deployed branch,
and are already correct. The remediation is a *deployment* action, which is out of scope here.

Documented procedure for whoever runs it:

1. Take a fresh production backup (`supabase db dump --linked`, schema + `--data-only`), record checksums.
2. `supabase db push --linked --dry-run` and confirm it lists exactly 163–168 (169 is local-only and
   must **not** be swept in unintentionally — confirm what the dry run reports before proceeding).
3. Apply, then re-run `supabase migration list --linked` and confirm head = `20260101000168`.
4. Re-test the public site: `/api/v1/properties/{id}/recurring-costs` and `/utility-settings` must
   return 200, and expense creation must succeed.

Safety review of 163–168 for this purpose: **additive with respect to existing data**. No
`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or destructive `ALTER` appears in any of them. The single
`delete from` is inside a function body (a per-period reading upsert), not a migration-time
operation. One caveat worth flagging: migration 168 does
`alter table public.expenses alter column category_code set not null` after backfilling — that
statement will fail if any existing production `expenses` row cannot be assigned a category code, so
the dry run and backup matter.

### 12.4 LOCAL REMEDIATION TESTS

No new code was written, so there is no new code to test. The pre-existing local changes were
re-verified on the current tree: **ESLint clean**, **`tsc --noEmit` clean**, production build
succeeded in the prior pass, marketing component suite 7/7. The UAT harness itself lints clean.

### 12.5 UAT continued — what was exercised

Built entirely through the deployed UI, save → refresh → re-read:

| Area | Result |
| --- | --- |
| Units | 7 across 3 properties (target 6–8 met); all fields accepted and persisted |
| Tenants | 4 — three **internal-only** (model A) + one **portal** tenant (model B) |
| Leases | 4 recorded and **activated**; occupancy lease-derived |
| Rent schedules | 8 generated automatically |
| Invoicing | INV-000003 issued (R15 000); rent-due moved PENDING 6 → 5, PAID 1 |
| Payment | R15 000 cash recorded → Paid R15 000, Balance R0, persisted |
| **Duplicate payment** | **Prevented.** Control withdrawn once settled; direct API replay refused (403 CSRF); invoice paid total stayed **15000, never 30000** |
| Staff RBAC | Staff added as **Manager**, `status=active`; 8 allowed surfaces open; principal-only pages show a proper "Access restricted" state with zero controls and zero roster data; restricted mutation APIs return **403** |
| Cross-org | Second org **Proplyst UAT Isolation Portfolio** (`c1e77129-2fa5-4e19-97b0-3bdc6f97b606`) provisioned by the same approved path; **14/14** bidirectional isolation checks passed |
| Notifications / Activity / Reports / Settings / Announcements | All render; Activity shows this session's writes |

**Dashboard reconciliation (§10)** — figures cross-check:
Expected rent **R32 000**, Rent collected **R15 000**, Outstanding **R0**, Expenses **R0**,
Net income **R15 000**, Occupancy **43% (3 of 7 units let)**, Payments awaiting confirmation **R0**.
Rent Due independently shows PENDING 5 / PAID 1. The arithmetic is internally consistent.

One labelling inconsistency (P2): the dashboard's "Expected rent" card is captioned
**"Billed in September 2026"** but shows the full rent roll (R32 000), whereas only R15 000 was
actually billed (one invoice issued). The number is a useful one; the caption misdescribes it.

### 12.6 Blocked, and honestly not bypassed

Per instruction, no database write was used to make a failed UI workflow look passed.

- **Rates & levies schedule, utility responsibility, meters** — BLOCKED (500, §12.2)
- **Budgets, in full** — BLOCKED. `property_budgets` does not exist, so no property budget,
  monthly/annual figure, annual distribution, manual month adjustment, actual/remaining/% used,
  approaching-limit or over-budget state can be created or read. Portfolio aggregation is therefore
  also untestable. The Budget page renders and "Set budget" links to the property Finances tab, but
  nothing can ever be stored.
- **Expenses** — BLOCKED by 500 (`expense_create_failed`); 0 of 4 created.
- **Document upload** — BLOCKED: HTTP **503** `upload_temporarily_unavailable`, "while secure file
  scanning is being configured" (ClamAV not configured in production). Fails safely and honestly.
- **Tenant portal** — BLOCKED, and **not a product defect**: the portal tenant's `tenants.user_id`
  is `NULL` because the invitation was emailed to a reserved `.invalid` address that cannot be read,
  so the account was never linked. The portal routes (`/my-lease`, `/my-payments`, `/my-documents`,
  `/my-maintenance`, `/compliance`, `/portal`, `/profile`, `/notices`) all exist.

### 12.7 WhatsApp and email

**WhatsApp — no message sent, deliberately.** The mandatory pre-flight cannot be satisfied:

```
PUBLIC ENVIRONMENT:     YES
UAT ORGANISATION:       Proplyst UAT Portfolio
REAL CUSTOMER DATA:     NO
WHATSAPP PROVIDER:      UNDETERMINED   <-- cannot prove META
WHATSAPP UAT OVERRIDE:  CANNOT BE ACTIVATED (server-side var on the deployed host)
ACTUAL DESTINATION:     UNPROVABLE
```

Two of the six lines cannot be proven, so per the brief nothing was sent. Additional evidence:
`organization_notification_settings` reports `whatsappEnabled: false` for **every** category on this
org, and `whatsapp_messages` holds **0 rows production-wide** — so there is no artefact from which
to infer the provider, and the only way to settle it is the send that is barred.

**Inbound (§16) remains blocked** for a second, independent reason: the Proplyst WhatsApp sender
number is only knowable from the Meta configuration, which is not readable from here. Rather than
invent a destination, the honest position is that no instruction can yet be given. Verified:
**0 tenant records anywhere carry +27837866021**, and no phone mapping was created.

**Email — Resend confirmed live, and now demonstrated.** Two emails were sent for the UAT
organisation as a by-product of the workflows under test: `staff_added_existing_user` and
`tenant_invitation`, both `status=sent`, both addressed to reserved `.invalid` recipients that
**cannot reach any real person**. This is a correction to the previous pass's "0 emails sent" and is
disclosed rather than omitted. No real customer was emailed.

### 12.8 Existing UX findings revisited

- **Authenticated root landing** — **NOT reproducible.** `/` now redirects an authenticated owner to
  `/dashboard` with full content across repeated attempts, and routes a no-org account to
  `/onboarding/choose-plan`. The single blank observation occurred once, before legal consent was
  recorded, and has not recurred. **No local fix prepared**, because fixing an unreproducible
  behaviour would be guesswork.
- **Raw UUID in breadcrumb** — **confirmed and broader than first recorded**: it appears on the
  property detail page *and* the invoice detail page (`b9 4ce3 85b9 2e8e7c7c9e98`). P2.
- **Light-mode logo** and **marketing mockup domain** — local fixes retained, not deployed, per §17.

### 12.9 UAT data now in production

| Organisation | Contents |
| --- | --- |
| Proplyst UAT Portfolio `6b4d43a8…` | 4 properties, 7 units, 4 tenants, 4 leases, 8 rent schedules, 1 invoice, 1 payment |
| Proplyst UAT Isolation Portfolio `c1e77129…` | empty (isolation control only) |

Organisation count 10 → 12. No real organisation, subscription or customer record was read for
anything but identification, or modified. `payment_methods` = 0 and `billing_events` = 0 on both UAT
orgs — **no charge occurred**. The stray "UAT Temp Probe" property remains, disclosed; no cleanup
authorisation has been given.

## 13. Fifth pass, 2026-09-07 — CONTROLLED PRODUCTION DATABASE REPAIR

Migrations **163–168 applied to production** after backup, rehearsal and a GO gate. 169 was
deliberately held out. The drift documented in §12 is now closed.

### 13.1 Alignment (§1)

| | |
| --- | --- |
| BRANCH | `main` |
| LOCAL HEAD | `0a380429360860571ae3c5c2ec93af712ec2abed` |
| ORIGIN/MAIN | `e52d695d7533f074d2dd95303135888c3508c4de` (27 commits behind local, unchanged) |
| DEPLOYED COMMIT | Not determinable — Render exposes only `x-render-origin-server`, no commit header |
| PRODUCTION MIGRATION HEAD (before) | `20260101000162` |

163–168 all **present** in `origin/main` and **byte-identical** to the local files (`git diff` clean
against `origin/main` for each). 169 is **absent** from `origin/main`, confirming the deployed
application does not require it — so it was correctly excluded.

### 13.2 Backup (§2)

| | |
| --- | --- |
| BACKUP METHOD | `supabase db dump --linked` (schema), `--data-only` (data), `--schema public,auth,storage` (broader schema) |
| BACKUP START | 2026-09-07T19:29:10Z |
| BACKUP COMPLETE | 2026-09-07T19:43:30Z |
| RESTORE POINT | `prod-backup-20260907/` — `schema.sql` 771 469 B, `data.sql` 545 004 B, `schema-full.sql` 854 337 B, SHA-256 in `CHECKSUMS.txt` (session scratchpad, never committed) |

**Verified by actual restore, not by inspection**: the dump was restored into a live scratch database
and produced row counts identical to production — orgs 12, properties 17, units 12, tenants 13,
leases 5, invoices 3. That is what makes this a genuine restore point.

### 13.3 Legacy expense data (§3) — the critical pre-168 gate

| | |
| --- | --- |
| TOTAL EXPENSE ROWS | **0** |
| CATEGORY DISTRIBUTION | none — table empty |
| ROWS 168 CAN MAP CLEANLY | 0 of 0 |
| ROWS THAT CANNOT BE MAPPED | **0** |
| NULL / EMPTY / UNKNOWN | 0 (and structurally impossible — see below) |

Three independent reasons the NOT NULL transition could not fail:

1. Production `expenses` is empty.
2. `expenses_category_check` enforces `char_length(category) >= 1`, so a NULL or empty category
   cannot exist in the first place.
3. `infer_expense_category_code()` ends in `else 'other'` — a total function with no unmapped input.

Because production had no rows, a naive rehearsal would never have exercised the backfill at all.
So the rehearsal deliberately injected **harder data than production has** (see §13.5).

### 13.4 Migration audit (§4)

| | 163 | 164 | 165 | 166 | 167 | 168 |
| --- | --- | --- | --- | --- | --- | --- |
| Tables | 4 | 2 | 0 | 0 | 0 | 0 |
| Columns added | 0 | 0 | 0 | 0 | 0 | 1 |
| Functions | 3 | 3 | 1 | 2 | 1 | 4 |
| SECURITY DEFINER | 3 | 3 | 0 | 4 | 1 | 2 |
| Triggers | 6 | 2 | 0 | 0 | 0 | 1 |
| Indexes | 14 | 4 | 0 | 0 | 0 | 0 |
| RLS enable / policies | 4 / 9 | 2 / 4 | – | – | – | – |
| `has_org_role` guards | 15 | 8 | 1 | 4 | 2 | 3 |
| Backfill | no | no | no | no | no | **yes** |
| NOT NULL transition | no | no | no | no | no | **yes** |
| DROP TABLE / COLUMN | none | none | none | none | none | none |
| SAFE TO APPLY | YES | YES | YES | YES | YES | YES |

Only drops anywhere are `drop function` in 165/168, required because a table-returning function's
signature cannot be changed by `CREATE OR REPLACE` — and neither function existed in production.
**Lock risk: negligible** — largest affected table is 17 rows; expenses was empty.
**Rollback/forward-fix:** restore from §13.2, or forward-fix, since every change is additive.

### 13.5 Rehearsal (§5)

Production backup restored into an isolated scratch database, then **10 synthetic expense rows
injected with deliberately hard labels**, then 163→168 applied in order.

All six applied cleanly. The 168 backfill mapped every case correctly:

| Input label | → code | |
| --- | --- | --- |
| `Water` / `electricity` / `Maintenance` / `levies` | water / electricity / maintenance / levies | exact |
| `Rates & taxes` | rates_taxes | ampersand form |
| `  WATER  ` | water | case + whitespace |
| `Power` | electricity | synonym |
| `management fee` | management | multi-word |
| `Totally Unknown Label`, `' '` | **other** | honest fallback, not guessed |

0 rows left NULL; NOT NULL transition succeeded. Every baseline row count preserved exactly; IDs
unique; no duplicates. RLS enabled with policies on all six new tables.

**pgTAP: 104 assertions passed, 0 failed** across `recurring_property_costs_and_utilities` (23),
`property_budgets` (15), `payment_report_ledger_allocation` (17), `owner_financial_summary` (9),
`owner_portfolio_financial_summary` (13), `expense_category_code` (13),
`documents_financials_isolation` (14).

### 13.6 Application (§7)

`db push --dry-run` initially listed **seven** migrations including 169 — so 169 was moved out of
`migrations/` (SHA-256 recorded), the dry run re-confirmed exactly 163–168, and only then was
`supabase db push --linked` run. 169 was restored afterwards, checksum verified, `git diff` clean.
No migration history was forced or hand-marked.

Applied 19:50:10Z → 19:50:40Z, all six, no errors.

### 13.7 Post-migration verification (§8/§9)

**Head: `20260101000168`, 168 rows — 169 not applied.**

All six tables present; `expenses.category_code` + `expense_category_code` enum present;
`owner_financial_summary`, `owner_portfolio_financial_summary`, `infer_expense_category_code` all
present; **RLS enabled on all six new tables with 13 policies**; 165's `confirm_payment_report`
replaced.

**Data survival: every count identical to the pre-migration baseline** — organizations 12,
properties 17, units 12, tenants 13, leases 5, rent_schedules 11, invoices 3, invoice_payments 3,
expenses 0, documents 3, auth.users 28. **Zero loss.**

**PostgREST: 0 endpoints failing.** All six relations return clean empty-state 200s as the
authenticated UAT owner. No PGRST205, no 500. **No manual schema-cache reload was needed.**

### 13.8 Public retest (§10–§14)

| Workflow | Before | After |
| --- | --- | --- |
| recurring-costs (rates & levies) | HTTP 500 | **200** |
| utility-settings | HTTP 500 | **200** |
| utility-meters | 404 | **200** |
| property budget | unusable | **200** |
| Expense creation | HTTP 500 | **201 × 5 created** |

**Budget acceptance (§11)** — set through the UI, read back from the server:
Seaside R25 000, Hillcrest R8 000, Central Offices R40 000 → Budget page shows
**Total planned R73 000**, exactly the predicted sum. Property budgets remain **separate rows**;
the portfolio figure is a server-side SUM (`owner_portfolio_financial_summary.budget_planned = 73000`),
not a competing shared budget. Seaside: actual R8 850, remaining R16 150, **35.4% used**, status
"On track"; over-budget count 0.

**Utilities (§12)**: conventional owner-paid water meter (property-wide, `isPrepaid: false`) and
prepaid tenant electricity meter (unit 101, `tenant_prepaid`, `isPrepaid: true`) — the UI renders
them distinctly, so a prepaid tenant meter is not treated as an owner-paid conventional one.
Four readings recorded; consumption derived 12 → 13 → **395**; percent change 8.3% → **2938.5%**;
`isUnusualUsage` false, false, false, **true** — flagged only on the genuine spike. **No confirmed-leak
claim appears anywhere.**

**Financial summary (§14)** — arithmetic checks by hand:
water 950 + electricity 1 400 + rates 3 500 + levies 1 800 + other 1 200 = **total 8 850 ✓**;
budget_remaining 73 000 − 8 850 = **64 150 ✓**; used 12.1% ✓;
net_operating_position 15 000 − 8 850 = **6 150 ✓**; rent 41 000 − 15 000 = outstanding **26 000 ✓**.

**Security regression (§15): 17/17.** Staff (a member, Manager) correctly sees the new finance data;
tenant and Org B see none of it on any new endpoint; RPC id-substitution refused with
*"Caller does not have access to this organization's financial summary"*.

**Document upload (§16): STILL BLOCKED BY FILE-SCANNING CONFIGURATION** — HTTP 503
`upload_temporarily_unavailable`, unchanged. Not a database issue; scanning was **not** weakened.

### 13.9 Defects still open after the repair

| # | Sev | Defect |
| --- | --- | --- |
| D-a | P1 | Document upload 503 — ClamAV unconfigured in production |
| D-b | P2 | **Dashboard contradicts itself**: the "Expenses" card reads **R0** for September while "Operating position" on the same screen correctly uses R8 850 (15 000 − 8 850 = 6 150). Two financial truths on one page |
| D-c | P2 | Dashboard "Outstanding rent R0" vs `owner_portfolio_financial_summary.rent_outstanding = 26 000` — the card appears to mean "invoiced but unpaid"; the caption does not say so |
| D-d | P2 | `/api/v1/properties/{id}/budget` returns **500** to a non-member instead of 403/404 (no data leaked, but an unclean refusal) |
| D-e | P2 | No UI to capture meter readings — the API works, but the Finances tab offers only "+ Add meter" |
| D-f | P2 | Raw UUID in breadcrumbs (property and invoice pages) |
| D-g | P2 | React #418 on `/organization/billing`; "+ Add ticket" on `/maintenance` navigates to `/properties`; `/leases/new` returns 200 + error boundary instead of 404 |

### 13.10 Safety ledger for this pass

Applied only 163–168. 169 not applied. Nothing pushed, no application code deployed, no real
customer organisation or record touched, no PayFast payment or credential entered, no WhatsApp sent,
no UAT organisation deleted, malware scanning not weakened. Only production change: the reviewed
migration application, after a verified-restorable backup and a passing rehearsal.

## Appendix — reproducing

```bash
cd apps/admin
node scripts/uat-public-blackbox.mjs
# optional: UAT_SHOT_DIR=<dir> UAT_JSON_OUT=<file.json> for screenshots and the full matrix
```

No credentials or personal data are recorded in this report, the harness, or its output.
