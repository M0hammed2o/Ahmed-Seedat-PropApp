# Proplyst V1 — UAT Test Plan

**Written: final pre-UAT engineering pass (WORKLOG.md this date).** This is the one deterministic
plan for Mohammed's post-deployment UAT: exact test-data setup, exact end-to-end sequence, and
every manual/physical/external item that cannot be verified from this environment. Nothing here
was executed against production — see the final report for what was verified locally, in this
environment, before deployment.

## 1. Test organisation setup (create fresh, after deployment — do NOT reuse real customer data)

Create exactly one clean UAT organisation, clearly labelled as test data throughout:

| Entity | Value |
| --- | --- |
| Organisation | **Proplyst UAT Property Management** |
| Property | **Example Apartments** (a real, valid South African address for OCR/Google Maps testing) |
| Units | **Unit 1**, **Unit 2** |
| Owner | **UAT Test Owner** (a real email/phone Mohammed controls, so owner-portal and WhatsApp/email delivery can actually be checked) |
| Tenant | **UAT Test Tenant** (a real email/phone Mohammed controls) |
| Lease | One-year lease, Unit 1, realistic rent (e.g. R9,500/month), start date = today |
| Rent | The lease's own rent amount above — let the rent-schedule job generate real `rent_schedules` rows, don't hand-insert them |
| Maintenance | One **normal**-priority ticket (e.g. "Squeaky door hinge"), one **urgent**-priority ticket (e.g. "No hot water") |
| Documents | One real **lease** PDF, one real **bill/invoice** PDF, one real **levy statement** PDF, one real **receipt** image/PDF — see §3 (OCR checklist) for what each one can actually test |

**Why owner/tenant need real, Mohammed-controlled contact details**: email delivery (Part 15) and
WhatsApp outbound (Part 21) can only be verified against a real inbox/phone — a fake
`test@example.com` address proves nothing.

## 2. OCR UAT checklist (Part 3) — exactly what each document type can prove

Live-audited this pass, not assumed. Do not expect more than what's listed here — the gaps below
are real and disclosed, not oversights to work around silently.

| Document type | Upload | Real OCR runs | Correction step before saving | Notes |
| --- | --- | --- | --- | --- |
| **Bill/invoice** | Documents module, `documentType: bill` | Yes (Google Document AI, once configured — see §4) | **No** — read-only field display + a "Confirm reviewed" button only; there is no way to edit an extracted value before confirming | Upload a real municipal bill or utility invoice; check the extracted supplier/amount/due date look right, but know you cannot correct a wrong value in the UI today |
| **Receipt** | Documents module, `documentType: receipt` | **No — blocked outright** (`extraction_not_supported`) | N/A | Do not expect the OCR panel to even appear for a receipt upload — this is by design (never invent support for a document type the backend does not understand), not a bug to report |
| **Levy statement** | Property page → Levy Statements panel | Yes (Google Document AI text OCR + a heuristic line-item parser) | **Yes** — a real editable line-item table, "Save corrections", "Mark reviewed" | The one document type with a genuine correction workflow. If extraction fails, a warning banner with a Retry button now appears (fixed this pass — previously failed silently) |
| **Lease agreement** | **No upload UI exists** — the backend route works if called directly, but nothing in the product actually calls it | N/A from the UI | N/A | Do not attempt to test lease OCR from the UI — there is nothing to click. This is a known, disclosed gap, not something to hunt for |

**What to actually check per document, in order**: (1) upload succeeds and the file appears in the
document list; (2) for bill/levy, trigger extraction and confirm the extracted fields are
plausible against the real document (Mohammed reads the source PDF and compares by eye — Part 21);
(3) for levy specifically, deliberately edit a line item and save, confirm the correction persists;
(4) confirm a bill/levy over 25MB or in an unsupported format (anything other than
PDF/JPEG/PNG/HEIC) is rejected with a clear error, not a silent failure.

## 3. Google Document AI production check (Part 2) — do this FIRST, before any OCR testing

1. In the deployed environment's variable configuration, confirm **only** `GOOGLE_CLOUD_PROJECT_ID` /
   `GOOGLE_CLOUD_LOCATION` / `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` / `GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON`
   are set — and that none of `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_TEXTRACT_REGION` /
   `AWS_REGION` are present, even as stale leftovers. **AWS Textract silently takes precedence over
   Google Document AI whenever both are configured** (an existing, deliberately-unchanged
   precedence order, documented in `DOCUMENT_INTELLIGENCE.md`) — if any AWS var is present, Google
   will never actually run despite looking configured.
2. Sign in as `super_admin`, go to **System** (`/platform-admin/system`) → "Document intelligence
   provider" — it now shows the real provider identity (`google-document-ai`), not a hardcoded
   value (fixed this pass). Confirm it says `google-document-ai`, not `aws-textract` or `mock`.
3. Upload one real bill and check `provider_name` was recorded correctly (visible on the
   `/platform-admin/processing` page) — this was a real gap for lease uploads specifically
   (fixed this pass to match the other two extraction routes).

## 4. Portfolio Intelligence check (Part 4/5)

`portfolio_insights` is now actually populated by the daily-jobs sweep (previously built but never
invoked — a real, disclosed gap closed this pass). To see it working:

1. Manually trigger the daily-jobs endpoint once after deployment (`POST /api/v1/system/daily-jobs`
   with a valid `CRON_JOB_SECRET`, or sign in as `super_admin` and call it), or wait for the next
   scheduled Render Cron Job run.
2. With the UAT org's overdue rent schedule from §1 in place, sign in as the UAT owner and check
   the web dashboard (`/dashboard`) — a "Portfolio insights" panel should show a real, grounded
   `rent_overdue` insight with a severity pill, a "View rent due" link, and a working Dismiss
   button.
3. On Android, sign in as the same owner and check the Dashboard tab — the same real insight now
   appears (previously a static "not yet built" placeholder).

## 5. AI Assistant check (Parts 6–14)

**Read-only in this release — there is no write/confirm capability to test.** Do not expect the
assistant to record a payment, change a lease, or send a message; if it appears to offer to, that
is a bug, not the intended experience.

1. Web, owner side: sign in as the UAT owner, open the chat bubble (bottom-right of any dashboard
   page), ask: *"What's overdue?"*, *"Which leases expire soon?"*, *"What is my occupancy?"*,
   *"What should I pay attention to today?"* — each answer should cite the real UAT data you
   created (real amounts, real tenant name), never an invented number.
2. Web, tenant side: sign in as the UAT tenant, open the same chat bubble in the tenant portal,
   ask: *"How much do I owe?"*, *"When is my next rent due?"*, *"What is the status of my
   maintenance request?"* — again, only real data for that specific tenant, never another
   tenant's or another org's.
3. Confirm a tenant asking about billing/subscription management gets no such option — the
   assistant has no tool for that, by design.
4. Android: not built this pass (web/PWA is sufficient for V1, per this pass's own scope — not a
   gap to report).

## 6. Email check (Part 15/16)

1. Before sending anything real, use the new **Email preview** page
   (`/platform-admin/email-preview`, platform-admin only) to visually check: tenant invitation,
   rent invoice, payment confirmation, maintenance update, subscription communication. Confirm
   Proplyst branding, no leftover "PropertyVault"/"PropVault" text, no `localhost` links.
2. Send one real tenant invitation to the UAT tenant's real inbox — check both desktop and phone
   Gmail rendering, confirm the activation link is a real `proplyst.co.za` URL (not localhost —
   fixed this pass for both tenant and owner invitation emails).
3. Trigger one real payment confirmation and one real maintenance update to the UAT tenant, same
   visual check.
4. Note: rent reminder/overdue and monthly owner summary are **WhatsApp-only** in this release —
   do not expect an email for those specifically; that's a deliberate channel choice (time-
   sensitive → WhatsApp), not a gap.

## 7. WhatsApp check (Part 21 — external, cannot be verified from this environment)

All 8 dispatchable templates are Meta-approved and structure-verified in code, but **no real
outbound WhatsApp send has been performed against the current candidate build**. After deployment:

1. Confirm the newest code is actually deployed (check the deployed commit hash against this
   pass's own final commit).
2. Trigger one real outbound send (e.g. a tenant invitation via WhatsApp delivery channel, or a
   rent reminder) to Mohammed's own WhatsApp number.
3. Confirm in Meta's own WhatsApp Manager / Business Platform dashboard: **sent** status, then
   **delivered**, then (once opened) **read**.
4. The real inbound webhook was already production-verified in an earlier pass — no re-check
   needed unless the webhook URL/verify token changed.

## 8. Daily jobs (Part 18) — the exact job order Mohammed's Render Cron Job now runs

`POST /api/v1/system/daily-jobs`, one Render Cron Job (`proplyst-daily-jobs`), sequential, each
independently caught (one job's failure never blocks the others):

1. **subscriptions** — trial/overdue transitions, scheduled downgrade application.
2. **rentSchedules** — generates upcoming rent_schedules rows.
3. **compliance** — property-compliance reminder sweep.
4. **paymentAndLeaseReminders** — rent payment reminder / overdue notice / lease expiry reminder (WhatsApp).
5. **ownerMonthlySummary** — monthly owner digest (WhatsApp).
6. **portfolioIntelligence** — Portfolio Intelligence reconciliation (new this pass) — always runs
   last so it reflects the day's already-settled state from jobs 1–5.

No new Render Cron Job was created — job 6 was added to the existing one.

## 9. Full end-to-end UAT sequence

### Owner journey
1. Create/log in to the Proplyst UAT owner account.
2. Create the **Proplyst UAT Property Management** organisation.
3. Add **Example Apartments**, then **Unit 1** and **Unit 2**.
4. Confirm owner/property access is scoped correctly (the UAT owner only sees their own org).
5. Create the **UAT Test Tenant** record.
6. Send the tenant a real invitation (email — see §6).
7. Create the one-year lease on Unit 1 (see §1).
8. Confirm a rent schedule is generated (immediately, or after the next daily-jobs run).
9. Upload the four sample documents (§2) — lease, bill, levy statement, receipt.
10. Run Google Document AI extraction on the bill and levy statement (§3); correct a levy line item.
11. Have the UAT tenant report a payment (tenant journey step 8) and confirm/reject it as owner.
12. Create the normal + urgent maintenance tickets; move one through its status lifecycle.
13. Post one notice/announcement, confirm it reaches the tenant portal.
14. Wait for (or trigger) the monthly owner summary — confirm it arrives via WhatsApp with real numbers.
15. Trigger a daily-jobs run and confirm Portfolio Intelligence insights appear on the dashboard (§4).
16. Ask the AI Assistant 3–4 real questions (§5) and confirm grounded, correct answers.
17. Check notification preferences — toggle a category off, confirm the next matching event is not sent.
18. View billing/subscription/invoice display for the UAT org (Proplyst's own SaaS billing, not landlord accounting).

### Tenant journey
1. Accept the invitation email, activate the account.
2. Sign in on web.
3. Sign in on Android (§10 — install the candidate build first).
4. Confirm the tenancy/lease/unit shown match what the owner set up.
5. Check the rent balance is correct (matches the generated rent_schedules).
6. Report a payment (EFT or cash), attach a proof-of-payment document.
7. Confirm the report shows "Awaiting confirmation" until the owner acts on it (§9 owner step 11).
8. See the confirmation/rejection reflected once the owner acts.
9. Submit a maintenance request with a photo.
10. View documents (lease, any tenant-visible uploads).
11. View the notice posted in owner step 13.
12. Check notification settings.
13. Ask the AI Assistant 2–3 real questions (§5) on web.

### Communication cross-check
Run through §6 (email) and §7 (WhatsApp) for at least the tenant invitation and one payment-related
event, confirming in-app/email/WhatsApp each fire appropriately and not redundantly for the same
low-value event (Part 17 — see the final report's channel-consistency section for what was
already verified in code).

### Android
1. Install the candidate APK/AAB on a **physical device** (§10 — this cannot be skipped by an
   emulator; release-signing behaviour specifically needs real hardware).
2. Log in, confirm session persists across app restarts and survives a token refresh.
3. Run through the tenant flows above.
4. Run through the owner flows above, including the new **Manage subscription** entry point
   (Dashboard top bar, principal-only) and the new Portfolio Intelligence feed (§4).
5. Test uploads (maintenance photo, payment proof).
6. Tap a `proplyst.co.za` link from outside the app (e.g. an email) and confirm App Links opens
   the native app, not a browser.
7. Test airplane-mode / no-connectivity behaviour on at least one screen.
8. Log out, confirm the session is genuinely cleared.

## 10. Physical / external items — cannot be performed from this environment, listed for Mohammed

**Android**
- Release signing: generate/confirm the real release keystore, obtain its SHA-256 fingerprint
  (`keytool -list -v -keystore <path>`, or Play Console → App signing).
- Update `/.well-known/assetlinks.json`'s production config with that real fingerprint.
- Physical-device install and test (§9 Android section above) — an emulator cannot substitute for
  this, particularly for release-signing/minification behaviour.
- Google Play internal/closed testing track setup, once the above is done.
- **Google Play billing policy**: Proplyst Android provides property-management functionality;
  subscription purchase/management happens on the web only (no Google Play Billing). Whether this
  requires anything beyond what's built is a policy question Google Play's own current terms must
  answer — review this via Play Console's own policy checker before submission. Not resolved by
  guessing in this pass.

**WhatsApp**
- Confirm the newest code is deployed.
- Perform one real authorised outbound test send (§7) and confirm sent/delivered/read status in
  Meta's own dashboard.

**Google Document AI**
- Upload real representative documents (§2/§3) and manually compare the extracted fields against
  the source document — this pass could not do this (no real Google Cloud project/service account
  exists in the development environment).

**Email**
- Send real representative messages to Mohammed's own inbox (§6) and inspect on both desktop Gmail
  and a phone client — HTML rendering across real clients cannot be verified from this environment.

**PayFast**
- Remains externally blocked until a real PayFast merchant account exists (unchanged from prior
  passes) — no real payment was or should be attempted.
