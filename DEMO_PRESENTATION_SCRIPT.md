# Demo Presentation Script

A 10-15 minute walkthrough of PropertyVault's PWA in Demo Mode. Follow `DEMO_RUN_GUIDE.md` first
to get the app running at `http://localhost:3090/dashboard` before starting this script.

Everything in this script runs against **fixture data** (Demo Mode) — nothing here calls a real
external service, sends a real email/WhatsApp message, or charges anything. Say so plainly if
asked; it's a strength of the walkthrough, not a caveat to hide.

---

## 1. Introduction (~1 min)

**Open:** `http://localhost:3090/dashboard`

**Say:** "This is PropertyVault — a multi-tenant property management platform for South African
landlords, letting agents, and their tenants. One login, role-aware navigation: the same account
type can manage a whole portfolio, individual tenants can see their own lease and payments, and
platform staff have a separate Super Admin view. What you're looking at right now is running
entirely on my laptop, in a mode built specifically for demonstrations — the blue 'Demo mode' badge
top-left is always visible so nobody mistakes fixture data for a live customer's real information."

**Business problem:** Landlords and letting agents currently run portfolios across spreadsheets,
WhatsApp, email, and paper files — nothing ties a property, its tenants, its leases, its
maintenance history, and its accounting together in one auditable place.

**Demo Mode / production note:** Everything on this page is fixture data seeded specifically for
this walkthrough — no real Supabase project is involved.

---

## 2. Owner Dashboard (~1 min)

**Open:** already on `/dashboard`

**Click:** point out (no need to click) the four KPI cards — Rent Collected, Outstanding Rent,
Occupancy Rate, Cash Left This Month — and the Rent Collected vs Expenses chart further down.

**Say:** "Every number here is computed from the same ledger you'll see in the Accounting section
later — nothing on this dashboard is a separate, hand-maintained figure. In production this
updates in real time as payments are recorded and expenses logged."

**Business problem:** A landlord's first question every morning is "how is my portfolio doing right
now" — this answers it in one screen instead of reconciling three spreadsheets.

**Demo Mode:** Fixture numbers (4 properties, 12 units, R84,500 collected). **Production:** live
figures computed from the org's real ledger.

---

## 3. Properties and Units (~1.5 min)

**Open:** click **Properties** in the sidebar → click into **Sea Point Apartment** (Property Detail)
→ back, then click **Units** in the sidebar.

**Say:** "Each property can hold multiple units — this one's a single apartment, but a larger
building would show every unit with its own tenant, lease, and rent status. Properties and units
are the foundation everything else attaches to: leases, tenants, maintenance tickets, and
accounting all reference back to a specific property."

**Business problem:** Portfolios of any real size need a structured property → unit → lease
hierarchy, not a flat list of addresses.

**Demo Mode:** 4 fixture properties, 12 fixture units. **Production:** unchanged — this is a fully
live feature already, not partial.

---

## 4. Tenants and Leases (~1.5 min)

**Open:** click **Tenants** in the sidebar → click into **Naledi Khumalo** (Tenant Detail).

**Say:** "This is a tenant's full record — contact details, status, and (in production) their lease
and payment history. What I want to show next is new work from this week: how a landlord actually
gets a tenant *into* the system with portal access, without that tenant ever having to re-type
information staff already captured."

**Business problem:** Landlords already have the tenant's name, ID, lease terms, and deposit
on file before the tenant ever logs into anything — a good system must never make them re-enter
that.

**Demo Mode:** Naledi Khumalo is a fixture tenant. **Production:** unchanged, fully live.

---

## 5. Tenant invitation and activation (~2.5 min — the newest feature)

**Open:** still on the Naledi Khumalo tenant detail page — the **"Portal invitation"** panel below
the profile card.

**Click:**
1. Leave delivery set to **Email**, tick **"Also generate a short activation code"**.
2. Click **Send invitation**.
3. Point out the result: a one-time activation link, a short code (`DEMO1234`), the masked
   destination (`n***@example.com`), and an expiry date.
4. Click **Revoke** to show that a landlord can cancel an invitation before it's used.

**Say:** "This is what happens after a landlord adds a new tenant: instead of the tenant creating
an account from scratch and re-entering their lease details, the landlord generates a secure,
single-use invitation — either a link, a short code for reading aloud over the phone, or both. The
token you see here is real cryptographic output shape — in production it's a 64-character random
token, hashed before it's ever stored, so even someone with database access can't recover it. The
short code alone is never enough to activate — it always has to be paired with the tenant's email
or phone on file, and it locks out after five wrong attempts."

Then **open a new tab** to `http://localhost:3090/activate` to show the tenant's side.

**Say:** "This is the landing page a tenant sees when they open that link or type in that code —
sign in or create an account, then they're linked straight to the lease record the landlord already
built. No property, unit, lease, or payment information is shown until that identity check passes."

**Business problem:** the single biggest tenant-onboarding friction point — asking someone to
re-enter data a landlord already has — solved with a security model good enough for real financial
and personal data (hashed tokens, lockouts, no information disclosure on a failed attempt).

**Demo Mode:** the send/revoke actions you just clicked are a realistic, fully interactive
simulation — no live database write happens, so it's safe to click through repeatedly. The
`/activate` landing page itself talks to a real (local) authentication check, so it always shows
the sign-in/create-account choice rather than a completed activation — that's expected, not a
bug. **Production:** the full flow is real end-to-end already — verified this week against a live
local Supabase instance, including a genuine password-reset and email round trip.

---

## 6. Documents and OCR (~1.5 min)

**Open:** click **Documents** in the sidebar.

**Say:** "Landlords upload leases, invoices, proof-of-payment, compliance documents here. The
system already supports OCR-assisted extraction — pull key fields (amounts, dates, tenant names)
automatically from an uploaded document, then a human always reviews and confirms before anything
is treated as final. No auto-apply without a person signing off."

**Business problem:** manual re-typing of every invoice/lease amount is slow and error-prone; full
automation without review is a compliance risk. This is the middle ground.

**Demo Mode / production:** document upload and OCR review are live features; the actual OCR
extraction currently runs against a mock provider (no real OCR vendor has been selected yet — a
cost/accuracy decision, not an engineering gap) — worth saying explicitly if asked.

---

## 7. Maintenance and Inspections (~1 min)

**Open:** click **Maintenance**, then **Inspections**.

**Say:** "Maintenance tickets move through a defined workflow — To Do, In Progress, Pending
Approval, Completed — enforced by the system, not just a suggestion. Inspections matter
particularly for deposit handling: a move-out inspection has to be either signed by both parties or
have a refusal logged before a deposit can be released — that's a hard rule in the database, not
just the UI."

**Business problem:** deposit disputes are one of the most common landlord-tenant conflict points
in South Africa; requiring a real inspection record before releasing a deposit protects both sides.

**Demo Mode / production:** both fully live features.

---

## 8. Accounting and reports (~2 min)

**Open:** click **Rent Due**, then **Bank Transactions**, then **Owner Statements**, then
**Tax Pack**.

**Say:** "Everything financial in PropertyVault posts through a real double-entry ledger — the same
kind of system real accounting software uses, not a simple running total. Rent Due shows what's
owed; Bank Transactions is where a landlord matches an actual bank deposit to an invoice; Owner
Statements roll everything up per property owner; and Tax Pack summarises a full South African tax
year — income, expenses, net — ready to hand to an accountant."

Click **Download CSV** on the Tax Pack page to show it's intentionally disabled in Demo Mode
(hover to show the tooltip: "CSV export requires a live session").

**Say:** "That button being disabled here, with an explanation rather than pretending to work, is
deliberate — Demo Mode never generates a real file download tied to fictitious data."

**Business problem:** landlords currently reconcile rent and bank statements manually and often
prepare tax summaries from scratch every year; this automates both from the same source ledger.

**Demo Mode:** realistic fixture figures, CSV export disabled on purpose. **Production:** fully
live, real double-entry ledger, real CSV export.

---

## 9. Notifications through Email and WhatsApp architecture (~1 min)

**Open:** click **Notifications**, then **Announcements**.

**Say:** "PropertyVault sends real product events over email and WhatsApp — invoice issued,
maintenance updates, owner statements ready, and — as of this week — tenant portal invitations.
Both channels are built against a provider abstraction, so switching to a real email or WhatsApp
vendor later is a configuration change, not a rewrite. Right now both run against a mock provider
in this environment — no real message has ever been sent — because no vendor account has been
provisioned yet. That's a deliberate, disclosed gap, not an oversight."

**Business problem:** tenants and owners expect timely notification of rent due, maintenance
status, and payments — without a landlord manually messaging everyone.

**Demo Mode:** identical to production in this respect — both currently use a mock provider
everywhere, demo or not. **Production:** requires a real email/WhatsApp vendor account before any
message actually sends.

---

## 10. Tenant Portal (~1.5 min)

**Open:** navigate to `http://localhost:3090/my-lease` directly (a separate portal, different
navigation from the Owner/Staff side).

**Click through:** My Lease → My Payments → My Maintenance → Notices.

**Say:** "This is what a tenant sees once they're activated — their own lease terms, payment
history, the ability to submit a maintenance request and see its status, and any notices the
landlord has posted. Deliberately scoped down: no access to other tenants' data, no owner
financials, nothing beyond their own lease."

**Business problem:** tenants currently have no self-service way to check what they owe, submit a
maintenance issue, or find their lease document — everything goes through a phone call or WhatsApp
message to the landlord.

**Demo Mode:** fixture lease (Oakwood Apartments, Unit 4B). **Production:** fully live feature.

---

## 11. Super Admin (~1.5 min)

**Open:** navigate to `http://localhost:3090/overview`, then **Customers** → click into any
customer row, then **Subscriptions**, then **System**.

**Say:** "This is the platform operator's view — us, not a landlord customer. Overview shows
platform-wide health; Customers lists every organisation using PropertyVault with the ability to
drill into one; Subscriptions tracks billing state; System shows infrastructure health and feature
flags."

**Say (controls caution):** "A few things on this screen are worth calling out as **mock-only** —
in this Demo Mode view specifically, this simplified customer detail page doesn't show the richer
usage/audit-log/support-session panels that exist in the live version, and nothing here should be
clicked expecting a real suspend/archive/billing action to happen — those write paths exist and are
tested, but this walkthrough isn't the place to exercise them against real state."

**Business problem:** running PropertyVault as a SaaS product requires the operator (us) to see
platform health and manage customer accounts without touching any individual landlord's private
data unnecessarily.

**Demo Mode:** simplified, read-only fixture views. **Production:** full detail pages with usage
metering, audit log, and time-boxed, audited support-session access to a customer's own data when
they need help.

---

## 12. Closing summary (~1 min)

**Say:** "To summarise what you've seen: a full property-to-tenant-to-lease data model, real
double-entry accounting, a maintenance and inspection workflow with hard business rules, and — as
of this week — a complete, secure account-creation and tenant-activation system so both landlords
and tenants can actually get into the product without a manual account-creation step behind the
scenes. What's still ahead before a real pilot: connecting a real email/WhatsApp vendor, Google and
Apple sign-in need a real developer account on each platform (the code is done and tested, just
waiting on those credentials), and choosing a hosting platform for the first real deployment. None
of that changes the architecture you've seen tonight — it's configuration and vendor selection, not
new engineering."

**Stop here.** Do not continue into unscripted exploration unless specifically asked — every screen
in this script was verified tonight; screens outside it were not all individually re-checked this
session.
