# Proplyst PWA — User Acceptance Test Checklist

Manual testing guide for using Proplyst as a real customer would. Organized in the order a real
user encounters the product. Check items off as you go; log anything wrong using the issue format
at the bottom of this file.

**Scope:** web/PWA (`https://proplyst.co.za`) only. Not covering `apps/mobile` (Android/iOS).

---

## 1. Authentication

- [ ] Landing page (`/`) loads for a signed-out visitor — no dashboard/login form leaks through
- [ ] Landing page pricing section shows the three real plans (Starter/Professional/Business)
- [ ] "Start free trial" / "Sign in" links go to the right pages
- [ ] Signup (`/register`) — Proplyst logo visible, not a placeholder icon
- [ ] Signup — cannot submit without checking Terms
- [ ] Signup — cannot submit without checking Privacy
- [ ] Signup — both checkboxes link to `/terms` / `/privacy` and open correctly
- [ ] Signup — weak/mismatched password shows a clear error, not a raw provider error
- [ ] Signup — "Continue with Google" is present; **Apple button should NOT appear** (disabled by design until real credentials exist — its absence is correct, not a bug)
- [ ] Google signup — completes a real OAuth round trip (this has never been live-tested — first real signal on whether it works at all)
- [ ] Check-email screen — shows your actual email address
- [ ] Check-email screen — "Resend verification email" works once
- [ ] Check-email screen — clicking resend again immediately shows a cooldown, not a duplicate send
- [ ] Check-email screen — "Wrong email? Back to sign up" returns to the form
- [ ] Check-email screen — "Return to sign in" link works
- [ ] Real confirmation email arrives (check spam too) — uses whatever template is live at test time (see Stage 5 of the report — may still be Supabase's stock template)
- [ ] Clicking the confirmation link signs you in and lands you somewhere sensible (not an error page)
- [ ] Clicking the SAME confirmation link a second time does not show a scary "invalid" error if you're already confirmed (should recover gracefully)
- [ ] Login (`/login`) — email/password works with a real account
- [ ] Login — wrong password shows a generic "invalid email or password" (never reveals which field was wrong)
- [ ] Login — 11 rapid wrong-password attempts trigger a "too many attempts" message
- [ ] Forgot password (`/forgot-password`) — submitting always shows the same "check your inbox" message, whether or not the address is real
- [ ] Password reset email arrives, link works, lets you set a new password
- [ ] Reset password — new password actually works on next login
- [ ] MFA enrollment (Settings → "Add authenticator app") — QR code and manual secret both shown
- [ ] MFA enrollment — a real authenticator app (Google Authenticator, Authy, etc.) scans the code and produces a working 6-digit code
- [ ] MFA enrollment — confirming with a correct code enables it; account shows "enabled"
- [ ] MFA login — after enrolling, sign out and back in: you're stopped at a code-entry screen, NOT let straight through
- [ ] MFA login — a wrong code is rejected with a clear message
- [ ] MFA login — a correct code signs you in fully
- [ ] MFA — navigating away mid-challenge (closing the tab, clicking a bookmark) and coming back does NOT force you to re-enter your password — you should land on the code-entry screen directly
- [ ] Logout — actually clears your session (verify by trying to access a protected page afterward)
- [ ] **Browser back button after logout** — pressing back should not show cached protected-page content
- [ ] Session expiry — leave a tab open and idle past a normal session length (if practical to test); confirm you're asked to sign in again rather than silently broken

## 2. First-Time Onboarding

- [ ] Terms acceptance is recorded — you should never be asked again after your first accept
- [ ] Privacy acceptance is recorded — same
- [ ] "Complete your account" screen appears after first login (email/password users normally skip this since consent+basics were captured at signup — but profile completion still applies)
- [ ] First name field — required, rejects empty
- [ ] Last name field — required, rejects empty
- [ ] Phone number — try a South African local number like `082 123 4567` — should be accepted
- [ ] Phone number — try an obviously invalid value like `123` — should be rejected with a clear message
- [ ] Phone number — try an international number with a `+` prefix — should be accepted
- [ ] After completing your profile once, you should never see this screen again on later logins
- [ ] Organisation creation — create a brand-new org, land on its dashboard afterward (not an error page)
- [ ] Organisation join/invitation — if you have an invite link, accepting it while signed out should ask you to sign in/register first, then return you to the exact invitation (not a generic dashboard)
- [ ] First dashboard arrival looks populated/sensible for a brand-new org (not broken/empty in a confusing way)

## 3. Dashboard

- [ ] KPIs shown match what you'd expect given the data you've entered (not obviously fake numbers)
- [ ] Property totals are correct
- [ ] Rent/payment summary figures make sense
- [ ] Maintenance ticket counts are correct
- [ ] "Recent activity" reflects real actions you took
- [ ] Notification bell shows real notifications, not placeholders
- [ ] Empty state (brand-new org, nothing entered yet) looks intentional, not broken
- [ ] Loading state doesn't hang or flash unstyled content
- [ ] Error state (try disconnecting network briefly) fails gracefully, not a blank white screen

## 4. Properties

- [ ] Add a property — all fields save correctly
- [ ] Edit a property — changes persist after reload
- [ ] Property detail page shows everything you entered
- [ ] Address fields save and display correctly
- [ ] Property map/coordinates — check whether this is real (a real map with your address) or absent
- [ ] Photo upload — actually uploads and displays, not just a preview that vanishes on reload
- [ ] Ownership — assign an owner, confirm it's reflected on the property and the owner's own record
- [ ] Estimated value field — saves and displays
- [ ] Archive/status change — if available, confirm it actually changes the property's state elsewhere (lists, dashboard counts)
- [ ] If you restrict a staff member to specific properties, confirm they genuinely cannot see properties outside that set (not just a hidden-but-reachable-via-URL situation)

## 5. Units

- [ ] Create a unit under a property — saves correctly
- [ ] Edit a unit — changes persist
- [ ] Occupancy status reflects reality (vacant vs occupied) based on actual lease data, not manually toggled independent of leases
- [ ] Unit correctly shows which property it belongs to
- [ ] Rent value saves and is used correctly elsewhere (rent schedules, dashboards)
- [ ] A property with zero units shows a sensible empty state, not an error

## 6. Owners

- [ ] Add an owner — saves correctly
- [ ] Assign ownership percentage — saves and displays
- [ ] Shared ownership (multiple owners on one property) — percentages actually add up correctly and are enforced (try entering >100% total and see what happens)
- [ ] Owner detail page shows their properties and percentages correctly
- [ ] Owner statements — generate one, confirm the numbers are plausible given real rent/expense data
- [ ] Owner permissions — confirm an owner-portal user only sees their own properties, never another owner's

## 7. Tenants

- [ ] Add a tenant — saves correctly
- [ ] Tenant detail page shows all entered info
- [ ] Contact information (email/phone) saves and displays
- [ ] Tenant invitation — generate one, confirm the invite link/code actually works for activation
- [ ] Tenant portal — sign in as the tenant, confirm they see only their own lease/payments/documents
- [ ] Tenant access restrictions — confirm a tenant cannot reach staff-only pages by guessing URLs

## 8. Leases

- [ ] Create a lease — select property and unit correctly
- [ ] Assign a tenant to the lease
- [ ] Rent amount saves correctly
- [ ] Start/end dates save correctly
- [ ] Lease status (active/pending/ended) reflects reality
- [ ] Rent schedule generates correctly from the lease terms (right amounts, right dates)
- [ ] Lease documents — attach a document, confirm it's retrievable later
- [ ] Expiry behavior — what happens as a lease approaches/passes its end date? Confirm it's handled sensibly (status change, notification, etc.) rather than silently ignored

## 9. Accounting

- [ ] Accounting overview page loads with real totals
- [ ] Rent received figures match actual recorded payments
- [ ] Outstanding balances are calculated correctly (not showing paid amounts as still owed, or vice versa)
- [ ] Add an expense — saves and reflects in totals
- [ ] Cash receipts — if you record a cash payment, confirm it's tracked distinctly from bank payments
- [ ] Bank accounts — add/view a bank account
- [ ] Bank transaction reconciliation/matching — upload or view transactions, confirm matching to real payments works as expected (this area has historically been match-suggestion-only, not fully automatic — see Stage 8 report for exact status)
- [ ] Journal entries — if visible to your role, confirm they reflect real postings
- [ ] Owner distributions/statements — confirm figures tie back to real rent/expense data for the period
- [ ] Trial balance — debits and credits should balance for a normal org with full property access; if you've restricted your own access to only some properties, a "not balanced" result may be expected, not a bug (see accounting section of the codebase's own known-issues register)
- [ ] Permission visibility — confirm a role without accounting access genuinely cannot see these pages/numbers

## 10. Documents

- [ ] Upload a document — succeeds and appears in the list
- [ ] Categorize a document — saves correctly
- [ ] Download/open a document — retrieves the actual file, not a broken link
- [ ] Associate a document with a property — confirm it shows up on that property's page
- [ ] Associate a document with a tenant — same
- [ ] Associate a document with a lease — same
- [ ] OCR / auto-extraction — upload a bill/invoice and see what happens. **This is a known area to test carefully** — confirm in the Stage 8 report below whether OCR is REAL, MOCK, or PARTIAL before you spend time expecting real extraction
- [ ] Extraction review screen — if OCR ran, confirm the review/edit step lets you correct fields before saving
- [ ] Failed-processing state — if you upload something OCR can't handle, confirm you get a clear error, not a silent hang
- [ ] Permissions — confirm a restricted role can't see documents outside their scope

## 11. Maintenance

- [ ] Create a maintenance ticket — saves correctly
- [ ] Assign it to a property/unit
- [ ] Move it through status stages (open → in progress → resolved, or whatever this app uses) and confirm each transition sticks
- [ ] Add a cost — saves and reflects in accounting if linked
- [ ] Attach a photo/document — retrievable afterward
- [ ] Tenant visibility — confirm a tenant can see the status of maintenance they reported, and cannot see tickets for other units

## 12. Inspections

- [ ] Create an inspection
- [ ] Checklist items — fill them in, confirm they save
- [ ] Associate with the correct property/unit
- [ ] Add evidence/media (photos)
- [ ] Mark complete — status updates correctly
- [ ] History — confirm past inspections remain viewable and correctly attributed

## 13. Meter Readings

- [ ] Confirm whether this feature exists in the UI at all before testing further (check Stage 8 report)
- [ ] If present: add a reading, confirm it saves
- [ ] Reading history — past readings remain visible and correctly ordered
- [ ] Correct unit association
- [ ] Evidence photo — if supported, confirm upload works

## 14. Reports

- [ ] Generate/open each available report
- [ ] Apply filters — confirm results actually change, not just the UI
- [ ] Export (if available) — confirm the downloaded file has correct, real data
- [ ] Totals in the report match what you see elsewhere in the app (dashboard, accounting)
- [ ] Permission restrictions — a restricted role sees only what they should

## 15. Notifications

- [ ] Notification list loads with real entries
- [ ] Read/unread state toggles correctly and persists
- [ ] Clicking a notification takes you to the relevant page (not a dead link)
- [ ] Notification preferences — toggling a channel off actually stops those notifications (as far as you can verify)

## 16. Settings

- [ ] Profile — display name edits and saves
- [ ] Profile — first/last name edits and saves (this may be a separate flow from initial Complete Your Account — confirm both work)
- [ ] Phone number — editable, validated the same way as onboarding
- [ ] Password change — works, and the new password is required on next login
- [ ] Email change — triggers a real confirmation email to the new address before it takes effect
- [ ] MFA management — can view enrollment status, remove/re-add a factor
- [ ] Linked providers — Google shows as linked if you signed up/linked via Google
- [ ] Appearance/theme toggle — Light/Dark/System all work and persist across reload
- [ ] Notification preference settings — same section as #15, confirm reachable from here too
- [ ] Organisation settings — name/details editable by an authorized role, correctly blocked for others
- [ ] Roles/permissions screen (if present for your role) — accurately reflects who has what access

## 17. PWA / Mobile Browser

Test specifically on a real phone browser AND as an installed PWA (Add to Home Screen):

- [ ] No horizontal scroll/overflow on any page
- [ ] Header renders correctly, nothing clipped
- [ ] Sidebar/navigation drawer opens and closes correctly on a small screen
- [ ] Content respects the bottom safe area (no controls hidden behind the phone's home indicator)
- [ ] On-screen keyboard doesn't cover the field you're typing into
- [ ] Forms are usable — inputs large enough to tap accurately, labels visible
- [ ] Tables — either scroll horizontally within their own container or reflow sensibly, never break the page layout
- [ ] Dialogs/modals fit the screen and can be dismissed
- [ ] File upload works from a phone (camera roll and, if supported, direct camera capture)
- [ ] Map (if present) is usable with touch gestures
- [ ] Scrolling is smooth, no janky/broken scroll areas
- [ ] Phone's native back button/gesture behaves sensibly, doesn't strand you
- [ ] Rotating the phone (portrait/landscape) doesn't break layout
- [ ] Installed PWA launches correctly from the home screen icon
- [ ] Refreshing inside the installed PWA doesn't lose your session
- [ ] Session persists correctly between closing and reopening the installed PWA
- [ ] Dashboard and core flows are fully usable from the installed PWA, not just the browser tab

## 18. Super Admin

**First, as an ordinary customer:**

- [ ] No Super Admin links appear anywhere in the normal dashboard/navigation
- [ ] Cannot discover the admin area through any visible navigation path
- [ ] Guessing `/platform-admin/overview` (or similar) redirects you away silently — no "forbidden" page, no hint the admin area exists

**Then, with your authorized platform-admin account:**

- [ ] Login enforces MFA before granting access (should not be optional for this role)
- [ ] Overview page loads with real platform-wide figures
- [ ] Customer directory — real list of organisations, not fabricated
- [ ] Subscriptions — real billing/subscription state per org
- [ ] Processing — real OCR/document-processing job queue (confirm against Stage 8's REAL/MOCK finding before trusting these numbers)
- [ ] System page — real health/integration status, not hardcoded
- [ ] Support/read-only access — enter support mode on a real customer org, confirm it's clearly marked read-only and doesn't let you silently make changes

---

# Issue Log Format

Use this exact format for every issue you find. Copy the block per issue.

```
ID:
Area:
Page/URL:
Device:
User role:
What I tried:
Expected:
Actual:
Severity:
Screenshot:
Reproducible:
Notes:
```

**Field guidance:**

- **ID** — a simple running number (UAT-001, UAT-002, ...)
- **Area** — which checklist section (e.g. "Accounting", "PWA/Mobile")
- **Page/URL** — the exact path, e.g. `/properties/[id]`
- **Device** — e.g. "Desktop Chrome", "iPhone 14 Safari", "Installed PWA — Android"
- **User role** — which account/role you were signed in as
- **Reproducible** — Yes / No / Sometimes (and if sometimes, what you noticed about when it happens)

## Severity definitions

| Severity    | Meaning                                                                                                                                              | Example                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **BLOCKER** | Prevents you from completing a core workflow at all, or causes data loss/corruption. Testing of that area cannot continue.                           | Cannot create a property; a saved lease disappears; payment data is lost                               |
| **HIGH**    | A real feature is broken or gives wrong results, but you can work around it or continue testing elsewhere. Wrong data shown is always at least HIGH. | Owner statement totals are mathematically wrong; MFA can be bypassed; a permission boundary leaks data |
| **MEDIUM**  | Something works but not as intended — confusing, inconsistent, or a secondary function fails while the primary one works.                            | Notification preferences don't actually stop notifications; a filter on a report doesn't apply         |
| **LOW**     | Minor functional issue with no real impact on completing tasks.                                                                                      | A button label is misleading but does the right thing; a field allows an odd-but-harmless value        |
| **POLISH**  | Purely cosmetic — spacing, wording, alignment, stale branding text. No functional impact.                                                            | Leftover "PropertyVault" wording; slightly misaligned card on mobile                                   |

**Rule of thumb:** if in doubt between two severities, pick the higher one — it's cheaper to downgrade something later than to have missed a real blocker.
