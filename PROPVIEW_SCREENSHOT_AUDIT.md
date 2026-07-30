# PropView Screenshot Audit

**Source**: `reference/propview-screenshots/` — 138 files (`IMG_7956` through `IMG_8094`; `IMG_8000` is missing from the sequence, not an error in this audit). All 138 were opened and visually inspected via four parallel agent passes (batches of ~35 images each); none were classified from filename alone. Full per-image evidence is preserved in the Appendix.

**What PropView is, mechanically**: a single Expo (React Native for Web) application served from one domain, `propview.expo.app`. The same codebase renders a bottom-tab-bar layout in narrow (phone) viewports and a persistent-left-sidebar layout in wide (desktop) viewports. **This is a responsive website, not a native app** — confirmed by standard Safari/Chrome browser chrome in every phone screenshot (address bar, tab/share/bookmark icons), no native tab-bar styling or safe-area/home-indicator treatment, and identical routes/content reachable at the same URLs on both form factors. Per the master prompt's instruction not to assume phone-viewport screenshots are native: **they are not** — none of the 138 screenshots show a native iOS or Android app.

Test account throughout: "Ahmed Seedat" (vector422@gmail.com), a single login holding both a **Landlord** and a **Tenant** portal identity, switchable via a "Switch Portal" control. The account is fresh/empty (0 properties, 0 leases), so nearly every list view is captured in its empty state — the primary evidence is **navigation structure, empty-state copy, form fields, and workflow descriptions**, not populated table data. Currency renders as ZAR ("R"); the product is explicitly grounded in South African regulation (POPIA, RHA, SARS, CIPC, Property Practitioners Act Fidelity Fund Certificate) — this is a South Africa–targeted product, not a generic template.

---

## 1. Full information architecture (reconstructed)

### Landlord Console

```
OVERVIEW
  Dashboard          — hero greeting, setup checklist, Key Numbers KPIs, money in/out chart, recent work feed
  Insights           — "Portfolio Intelligence": rules-based, data-grounded alerts (rent overdue, leases expiring, etc.), explicit anti-hallucination disclaimer
  Reports            — 4 report cards: Income vs Expense Trend, Occupancy by Property, Tenant Payment Status, Maintenance by Status

PORTFOLIO
  Properties         — list + "More Property Tools": Units & Spaces, Listings Studio, Valuations, Neighbourhood Insights, Tours & Staging
  Units              — AI-assisted setup ("describe a complex, it creates every unit")
  Portfolio Map      — portfolio-wide KPIs + interactive map entry point + filterable property list
  Owners             — owner records (Individual/Company/Trust), "Active mandates"
  Valuations         — manually recorded valuation history per property (no automated AVM)

LEASING
  Leases             — create / upload-PDF-and-parse / spreadsheet bulk-import; "More Lease Tools": Applications & Screening, Inspections, Trust & Deposits, Invoices & Receipts
  Tenants             — tenant directory (Active/Expired/Pending)
  Applications        — POPIA-consent-gated screening pipeline (Submitted → Screening → Decided); approval auto-creates tenant + lease + rent schedule in one step
  Listings (Studio)  — listing → enquiry → viewing → application funnel; public listing page
  Enquiries (Leads)  — pipeline (New/Contacted/Viewing/Applied)
  Articles           — landlord-run content/blog CMS tied to a public page (marketing/SEO tool)
  Sales & Auctions   — property-for-sale/auction module, distinct from rental leasing ("private-treaty sale")
  Virtual Tours      — room-by-room tour/staging builder

OPERATIONS
  Maintenance (Board) — KPIs (Open/In Progress/Completed/Overdue) + kanban tabs (To Do/In Progress/Pending Approval/Completed) + Vendors & Approvals + Vendor Bills
  Inspections        — move-in/move-out room-by-room photographed inspections, dual e-signature or logged tenant refusal; gates deposit release
  Tasks & Reminders  — generic task tracker (Pending/In Progress/Overdue/Completed)
  Vendors            — contractor directory (trade category, rating), external/unregistered vendor support
  Announcements       — tenant notices with read-receipt/acknowledgement tracking, auto push+in-app notify on publish

FINANCE
  Rent Due            — calculated from lease; card auto-updates on confirmed payment, EFT/cash requires manual match/approve
  Invoices (& receipts) — drafted from Rent Due; PDF + email delivery, logged to audit history
  Expenses (Ledger)  — manual entry or AI-parsed from uploaded vendor invoice PDF
  Rental Deposits (Trust & Deposits) — interest-bearing trust ledger per RHA rules, separate from operating money; release gated on completed move-out inspection
  Match Bank Payments (Bank Reconciliation) — separate business vs. trust bank accounts, matched to rent/expense records
  Owner Statements    — monthly, auto-drafted from ledger (rent in, costs out, owner's share); payout marked paid only when matched to an outgoing bank line
  Vendor Invoices (Vendor Bills) — vendor-submitted bills for approval → payout (Submitted/Approved/Paid/Rejected)
  Trial Balance        — real double-entry ledger with a "Balanced" check; separate Business/Trust/Deposits views
  Tax Pack (SARS)     — SA tax-year (1 Mar–28 Feb) gross income/deductible expenses/net result, per-property and by-category, PDF export, explicit "not tax advice" disclaimer

WORKSPACE
  Documents (Vault)   — AI-parsed uploads (lease/invoice/statement), pending review/updated/expired/archived states
  Workspaces          — org-membership switcher ("you belong to one workspace... anyone who invites you to theirs will appear here")
  Organisation        — company/compliance profile: Owner-managed vs. Agency type, CIPC reg no., VAT no., SARS tax no., POPIA Information Officer, Invoice Prefix, Deposit Interest %, Fidelity Fund Certificate (number/issued/expires); Team Seats with 5-tier RBAC invite (principal/manager/agent/accountant/viewer)
  Neighbourhood        — reusable area-note snippets (Schools/Transport/Safety/Amenities/Market/General) for listings
  Audit History (Log) — date-grouped, user/action/detail-tagged event log ("Signed in", "auth" tag, etc.)
  Settings             — personal profile, Billing & Payment (plan badge "Agency"), Appearance (System/Light/Dark), Currency (ZAR default), Notifications, Security & Privacy, Account Management (Export Data / Deactivate / Sign Out)

SYSTEM (seen in mobile "More" menu, partially distinct desktop pages)
  Analytics, Collections, Messages, Notifications, Legal

GLOBAL
  Account dropdown: Profile, Settings, Workspace Settings, Usage & Plan, Help, Switch Portal, Manage Portals, Log out
  AI Assistant: floating sparkle FAB → conversational chat drawer, stages changes for confirmation before saving (distinct from the rules-based Insights feed)
```

### Tenant Portal (strict subset, role-scoped)

```
OVERVIEW
  Home                — greeting, onboarding nudge (0/5 steps), KPIs (Paid up / Current Balance / Maintenance Tickets / Unread Notices), "Connected Tenancy Workflows" links, Recent Activity, Upcoming Events & Reminders

MY TENANCY
  My Lease             — read-only; "your landlord creates your lease — it will appear here"
  Payments             — balance hero + due date, "Log a Payment" (payments are external EFT, logged/reminded in-app — not processed in-app), Payment Reminders toggle, Rent Dues, Payment History
  Documents             — landlord-shared documents, filterable

FIND A HOME
  Find a home          — search (keyword, area, budget, size, pet-friendly) across the landlord's published Listings

REQUESTS
  Maintenance           — submit form (summary, description w/ 2000-char count + quick-fill suggestion chips, priority Low/Med/High/Urgent, up to 12 photos incl. camera capture) → Active Requests list
  Vendors                — read-only list of landlord-approved vendors "safe to contact directly"
  Meter Reading          — submit water/electricity readings (skipped if landlord uses prepaid meters)

UPDATES
  Announcements          — landlord notices ("Building notices")
  Notifications           — same empty-state pattern as landlord side

ACCOUNT
  Profile & Notices      — Personal Info, Appearance, Notification Preferences (5 category toggles + email-copy toggle), Consent Management (Privacy Policy/ToS/manage consent), Security, Account Management — structurally a near-exact mirror of the landlord Settings page
```

---

## 2. Module grouping table (§5.3)

| Module                                        | Screenshots          |      Landlord      |                Tenant                 | Notes                                                                                 |
| --------------------------------------------- | -------------------- | :----------------: | :-----------------------------------: | ------------------------------------------------------------------------------------- |
| Authentication                                | 7956                 |         ✓          |              ✓ (shared)               | Email/password, Google OAuth, email sign-in code                                      |
| Onboarding (Get Started)                      | 7957–7961, 8064–8066 |         ✓          |          ✓ (5-step variant)           | 7-step landlord checklist vs. 5-step tenant checklist                                 |
| Dashboard                                     | 7957–7961, 7986–7989 |         ✓          |                   —                   |                                                                                       |
| Insights (Portfolio Intelligence)             | 7990                 |         ✓          |                   —                   | Rules-based, not conversational                                                       |
| Reports                                       | 7991–7995            |         ✓          |                   —                   |                                                                                       |
| Properties                                    | 7963–7964, 7996–7997 |         ✓          |                   —                   |                                                                                       |
| Units                                         | 7998–7999            |         ✓          |                   —                   | AI-assisted bulk unit generation                                                      |
| Portfolio Map                                 | 8001–8003            |         ✓          |                   —                   | Map UI itself not captured, only entry point                                          |
| Owners                                        | 8004–8005            |         ✓          |                   —                   | Individual/Company/Trust; "mandates"                                                  |
| Valuations                                    | 8006–8007            |         ✓          |                   —                   | Manual entry only                                                                     |
| Leases                                        | 7965–7966, 8008–8009 |         ✓          |        ✓ (My Lease, read-only)        | 8077                                                                                  |
| Tenants                                       | 8010–8011            |         ✓          |          n/a (is the tenant)          |                                                                                       |
| Applications & Screening                      | 8012–8013            |         ✓          |                   —                   | POPIA-consent-gated                                                                   |
| Listings Studio                               | 7964, 8014–8016      |         ✓          |            ✓ (Find a home)            | 8081–8082                                                                             |
| Enquiries/Leads                               | 8017–8018            |         ✓          |                   —                   |                                                                                       |
| Articles                                      | 8019–8020            |         ✓          |                   —                   | Marketing CMS, public page                                                            |
| Sales & Auctions                              | 8021                 |         ✓          |                   —                   | Out of pure rental-PM scope                                                           |
| Virtual Tours                                 | 8022                 |         ✓          |                   —                   |                                                                                       |
| Maintenance                                   | 7967–7968, 8023–8024 |     ✓ (Board)      |              ✓ (submit)               | 7980–7982, 8083–8085                                                                  |
| Inspections                                   | 8025–8026            |         ✓          |            — (referenced)             | Gates deposit release                                                                 |
| Tasks & Reminders                             | 8027                 |         ✓          |                   —                   |                                                                                       |
| Vendors                                       | 8028–8029            | ✓ (full directory) |      ✓ (read-only approved list)      | 8086                                                                                  |
| Announcements                                 | 8030–8031            |         ✓          |               ✓ (read)                | 7968, 8088                                                                            |
| Rent Due                                      | 8032–8033            |         ✓          | (surfaces as "Rent Dues" in Payments) |                                                                                       |
| Invoices & Receipts                           | 7966, 8034–8035      |         ✓          |           ✓ (view charges)            |                                                                                       |
| Expenses                                      | 8036–8037            |         ✓          |                   —                   |                                                                                       |
| Rental Deposits / Trust                       | 7966, 8038–8039      |         ✓          |                   —                   | RHA interest accrual                                                                  |
| Match Bank Payments                           | 8040                 |         ✓          |                   —                   |                                                                                       |
| Owner Statements                              | 7971, 8041–8043      |         ✓          |                   —                   |                                                                                       |
| Vendor Invoices/Bills                         | 8044                 |         ✓          |                   —                   | Vendor submission portal implied, not shown                                           |
| Trial Balance                                 | 8045–8046            |         ✓          |                   —                   | Double-entry, Business/Trust/Deposits                                                 |
| Tax Pack (SARS)                               | 8047–8050            |         ✓          |                   —                   |                                                                                       |
| Documents                                     | 7971, 8051–8052      |     ✓ (Vault)      |               ✓ (view)                | 8080                                                                                  |
| Workspaces                                    | 8053                 |         ✓          |                   —                   | Org-membership switch                                                                 |
| Organisation                                  | 8054–8056            |         ✓          |                   —                   | Compliance profile + RBAC team seats                                                  |
| Neighbourhood                                 | 7964, 8057–8058      |         ✓          |                   —                   |                                                                                       |
| Audit History                                 | 8059                 |         ✓          |                   —                   |                                                                                       |
| Settings                                      | 8060–8063            |         ✓          |         ✓ (Profile & Notices)         | 8090–8094                                                                             |
| Notifications                                 | 8067–8072            |         ✓          |                   ✓                   |                                                                                       |
| Payments (tenant)                             | 7978–7979            |        n/a         |                   ✓                   | 8078–8079                                                                             |
| Meter Reading                                 | 7984                 |        n/a         |                   ✓                   | 8087                                                                                  |
| Portal switcher                               | 7969, 7983           |         ✓          |                   ✓                   | 8073                                                                                  |
| AI Assistant (chat)                           | 7962                 |         ✓          |     (not captured, likely shared)     | Confirm-before-save                                                                   |
| Analytics/Collections/Messages/Legal (System) | 7972                 |         ✓          |                   —                   | Not detailed in any other screenshot — **document as uncertain, do not assume scope** |

---

## 3. Key workflow reconstructions (§5.4)

**Tenant application → tenant/lease/rent creation** (8012–8013): Capture a walk-in or paper application with the applicant's POPIA consent → run an affordability/credit screen (requires separate applicant consent) → Approve creates the tenant, lease, **and** rent schedule as one atomic step; Decline requires a recorded reason. This is the single most automation-heavy workflow found.

**Rent Due → Invoices pipeline** (8032–8035): PropView calculates what's owed from the active lease. Card payments auto-confirm via a payment provider webhook; EFT/cash requires the landlord to check the bank and either approve a payment claim or match a bank statement line. "Open Rent Due" prepares the month's charges, which then become draft Invoices.

**Owner Statement drafting** (8041–8043): Pick a month → draft a statement for every owner with ledger activity (owners who already have one for that month are skipped) → statement = rent in − costs out × owner's share → a payout is only marked "Paid" after an outgoing bank line is matched to it via bank reconciliation.

**Deposit trust lifecycle** (8038–8039, 8026): Deposit held in a trust-class ledger, separate from operating money, accruing interest per Rental Housing Act rules. Release is explicitly gated — "no deduction without findings on a completed move-out inspection." Inspection itself requires both landlord and tenant sign-off, or an explicitly logged tenant refusal, before it can complete.

**Tenant maintenance-ticket submission** (7980–7982 mobile, 8083–8085 desktop — same flow, fully captured both platforms): Issue Summary + Detailed Description (2000-char, with quick-fill suggestion chips like "It started this week.") → Priority (Low/Medium/High/Urgent, Medium default) → up to 12 photos (gallery or camera, first photo = cover) → Submit → appears on landlord's Maintenance Board in "To Do".

**Portal switch** (7969, 7983, 8073): one login can hold multiple portal identities (Landlord, Tenant — confirmed; a Vendor/Staff portal is plausible but not evidenced). Switching is via a global dropdown, not a re-login. Each portal has its own scoped bottom-tab/sidebar set.

---

## 4. Desktop-to-mobile mapping (§5.5)

There is **no separate mobile experience** — mobile and desktop are two responsive layouts of the same web app at the same URLs:

- **Desktop (wide viewport)**: persistent left sidebar grouped under uppercase section labels, breadcrumb trail ("Landlord Console > Properties"), KPI cards reflow to 2–4 columns, feature-row lists reflow wider.
- **Mobile (narrow viewport, still a website in Safari, not native)**: bottom tab bar (Dashboard/Properties/Leases/Maintenance + "More" overflow for everything else), KPI cards stack to 1 column, same "More tools" feature-row pattern used to surface secondary modules.
- Every module observed on desktop was also reachable on mobile via the "More" menu — there is no module that is desktop-only or mobile-only in the reference product itself. (This does **not** mean PropertyVault's _native_ apps should carry every module — see the separate mobile-architecture decision; PropView's own "mobile" surface is a website, not a native-app scoping precedent.)

For PropertyVault's actual native iOS/Android apps (owner/landlord + tenant only, per the master prompt), the desktop-only depth to explicitly **not** carry over 1:1 includes: Trial Balance, Tax Pack, Organisation compliance settings, Team Seats/RBAC management, Articles CMS, Sales & Auctions, bulk property/lease import, Portfolio Map authoring — these are configuration/back-office/accounting workflows PropView itself only ever showed inside the wide-sidebar "Landlord Console" and are natural web-first, matching the master prompt's own guidance (§10.1) not to reproduce complex desktop accounting screens on a phone.

---

## 5. Design-system extraction (§5.6)

- **Layout**: persistent grouped sidebar (desktop) / bottom-tab + "More" overflow (mobile), consistent breadcrumb ("[Portal] > [Page]"), top bar with global search (⌘/Ctrl-K), theme toggle, notification bell, avatar.
- **Empty states** (the single most consistent pattern across all 138 screenshots): circular soft-pastel icon badge → bold "No X yet" headline → one-line gray explanatory subtext → solid blue pill CTA prefixed "+". Warm, conversational copy throughout ("it takes a minute").
- **KPI/stat cards**: icon (top-left, color-coded by metric type) + large bold number/currency + label + muted subtext, often with a trailing chevron. 1-column (phone) → 2–4 column (desktop) reflow.
- **Filter pills**: rounded pill-tab row directly under KPIs on nearly every list page; active pill solid blue, others plain text.
- **"How It Works" / explainer cards**: light-gray card with 2–3 sentences of plain-language process explanation, appended to many modules' empty states — an onboarding-by-default pattern, not a one-time tour only.
- **"More Tools" / feature-row lists**: icon + bold title + gray one-line description + chevron, used to disclose secondary features nested under a primary module (Properties, Leases, Maintenance).
- **Forms**: standard fields, character counters, quick-suggestion chips for common free-text answers, segmented-button groups for short enums (e.g., Priority) rather than dropdowns.
- **Color**: solid blue for primary actions/active states; soft pastel circular icon backgrounds; destructive actions are solid dark-red/maroon, always paired with a warning caption, always placed near Sign Out.
- **Theme**: both light and dark supported (mobile observed dark by default, desktop observed light with a toggle); System/Light/Dark segmented control in Settings.
- **Currency/locale**: ZAR default; South African regulatory language baked into copy, not just a locale switch (POPIA, RHA, SARS, CIPC, PPA/FFC).
- **AI surfaces**: two distinct types — (1) conversational Assistant (FAB → chat drawer, stages changes, requires confirmation before save), (2) rules-based "Portfolio Intelligence" insights feed with an explicit anti-hallucination disclaimer ("nothing is estimated or made up"). Smaller AI-assist touches recur inline: natural-language bulk unit generation, lease/invoice/document PDF auto-parsing, maintenance-form quick-fill chips.
- **Do not copy**: PropView's actual logo/wordmark, exact color hex values, or copy text verbatim — the patterns above (empty-state formula, KPI card anatomy, filter-pill styling, explainer-card placement) are the reusable UX lessons; PropertyVault's visual identity must be original.

---

## 6. Uncertain / not fully evidenced (flag, don't implement blind)

- **System section** (Analytics, Collections, Messages, Legal) — named once (mobile "More" menu, IMG_7972) and never opened; scope unknown.
- **Vendor-side submission portal** — Vendor Bills implies vendors submit invoices somewhere, but no vendor-facing login/portal was captured.
- **Interactive Portfolio Map** — only its entry-point card was captured, not the map itself.
- **Populated (non-empty) table layouts** — because the demo account is empty everywhere, actual table column sets for Tenants, Leases, Owners, Vendor Bills, etc. in a populated state were not observed; only KPI/empty-state copy is confirmed.
- **"2 enabled" badge** near the portal switcher (IMG_8073) — meaning not confirmed (possibly 2FA/notification channels, possibly portal count).
- **Sidebar "WORKSPACE" vs. plain "LANDLORD CONSOLE" grouping inconsistency** — Owner Statements/Vendor Invoices/Trial Balance/Tax Pack appear under an unlabeled continuation in some captures (IMG_8061–8067) and under an explicit "WORKSPACE" header in others (IMG_8072) — treated here as one Finance-adjacent group; the exact section boundary is a best-effort read, not a confirmed spec.

---

## Appendix: full per-image inventory

_(All 138 entries, exactly as recorded by the four audit passes. Preserved verbatim for evidence traceability.)_

### Batch 1 (IMG_7956–IMG_7990)

Files IMG_7956–IMG_7985 (.PNG) are phone screenshots of Safari (iOS) at `propview.expo.app` (Safari browser chrome visible throughout — confirms mobile web, not native). Files IMG_7986–IMG_7990 (.JPG) are phone-camera photos of a physical HP laptop showing the desktop web experience in Chrome. Same account (Ahmed Seedat), workspace empty (0 properties), dark theme on mobile, light theme on desktop.

#### IMG_7956.PNG

- Device: Phone, mobile web (Safari chrome, propview.expo.app). Not native — standard Safari toolbar present.
- User type: Unknown (pre-auth) — sign-in screen
- Module: Auth
- Title: "Welcome back"
- Nav: none
- Actions: "Sign in with email", "Continue with Google", "Email me a sign-in code", "Sign up", "Support", "Forgot password?"
- Fields: Email (prefilled), Password (masked)
- Metrics/Table/Filters/Status: none
- UI patterns: Dark rounded card on black background, PropView logo, "OR USE" divider, Google social button
- Related: precedes IMG_7957
- Uncertainty: unclear if "Email me a sign-in code" is magic-link or OTP

#### IMG_7957.PNG

- Device: Phone, mobile web
- User type: Owner/landlord ("Good afternoon, Ahmed")
- Module: Dashboard
- Title: "PropView · Good afternoon, Ahmed"
- Nav: Bottom tabs: Dashboard, Properties, Leases, Maintenance, More; top bar: workspace chevron, bell, avatar
- Actions: Add Property / New Lease / Add Expense / Scan PDF quick tasks; dismiss setup card; AI FAB
- Metrics: "Finish setting up — 0/7 done"
- UI patterns: Gradient header, dark cards, "Nothing urgent right now" empty state, 2x2 common-tasks grid, floating AI FAB
- Related: scroll sequence with 7958–7961

#### IMG_7958.PNG

- Device: Phone, mobile web
- Module: Dashboard — "Key numbers"
- Metrics: "0 Properties", "0% Units occupied", "+R0 Cash left this month", "0 Units available"
- UI patterns: 1-column KPI cards, ZAR currency
- Related: continues 7957→7959

#### IMG_7959.PNG

- Device: Phone, mobile web
- Module: Dashboard — "More tools" / "Money in and out"
- Actions: "More" (tools), "Reports"
- UI patterns: 4-across icon tile grid (Documents, Rent due, Expenses, Tax report, Switch portal, Messages, Tasks); chart card
- Related: continues 7958→7960

#### IMG_7960.PNG

- Device: Phone, mobile web
- Module: Dashboard — Money in/out empty state
- Actions: "+ View rent due"
- UI patterns: "No money activity yet" empty state
- Related: continues 7959→7961

#### IMG_7961.PNG

- Device: Phone, mobile web
- Module: Dashboard — Recent Work
- UI patterns: "No recent work — Changes made by you and your team will appear here" (implies multi-user activity feed)
- Related: end of Dashboard scroll (7957→7961)

#### IMG_7962.PNG

- Device: Phone, mobile web
- Module: Dashboard — AI Assistant drawer
- Actions: prompt chips "How's my portfolio?", "What's overdue?", "Record an expense"; chat input
- UI patterns: bottom-sheet drawer; message: "ask me how things are doing, or tell me what to change and I'll show you any change before it's saved" — confirms conversational, confirm-before-save assistant
- Uncertainty: unclear if it can write autonomously without confirmation

#### IMG_7963.PNG

- Device: Phone, mobile web
- Module: Properties
- Title: "Properties"
- Actions: "+ Add Property", "Add Many Properties at Once"; search + type filter
- UI patterns: empty state (building icon)
- Related: precedes 7964

#### IMG_7964.PNG

- Device: Phone, mobile web
- Module: Properties — "More Property Tools"
- UI patterns: feature-row list: Units & Spaces, Listings Studio, Valuations, Neighbourhood Insights, Tours & Staging
- Related: continues 7963

#### IMG_7965.PNG

- Device: Phone, mobile web
- Module: Leases
- Actions: "+ Add New Lease"; search
- UI patterns: empty state — "Create a lease, upload a signed lease PDF and let PropView read it, or bring your whole book across from a spreadsheet" (AI PDF parsing + bulk import)
- Related: precedes 7966

#### IMG_7966.PNG

- Device: Phone, mobile web
- Module: Leases — "More Lease Tools"
- UI patterns: feature rows: Applications & Screening, Inspections, Trust & Deposits, Invoices & Receipts
- Related: continues 7965

#### IMG_7967.PNG

- Device: Phone, mobile web
- Module: Maintenance — "Maintenance Board"
- Metrics: "0 Open Tickets", "0 In Progress", "0 Completed", "0 Overdue"
- UI patterns: 2x2 KPI grid; "Service Operations": Vendors & Approvals, Vendor Bills
- Related: precedes 7968

#### IMG_7968.PNG

- Device: Phone, mobile web
- Module: Maintenance — ticket board tabs
- Filters: To Do(0)/In Progress(0)/Pending Approval(0)/Completed(0) — 4-stage kanban with approval gate
- UI patterns: "More Tools": News & Announcements (read-receipts implied), Portfolio Intelligence
- Related: continues 7967

#### IMG_7969.PNG

- Device: Phone, mobile web
- Module: More (navigation hub)
- Status: "Landlord active · 2 enabled" (portal switcher)
- UI patterns: profile card ("Landlord · Tenant" role badges), "Switch Portal" section, icon-tile grid: Overview (Insights, Reports), Portfolio (Units, Portfolio Map, Owners, Valuations), Leasing (partial)
- Related: master IA index, spans 7969–7972
- Uncertainty: this single menu enumerates nearly the entire product

#### IMG_7970.PNG

- Device: Phone, mobile web
- Module: More — Leasing/Operations
- UI patterns: Leasing (Tenants, Applications, Listings, Enquiries, Articles, Sales & Auctions, Virtual Tours); Operations (Inspections, Tasks, Vendors, Announcements); Finance starting (Rent Due, Invoices, Expenses, Rental Deposits)
- Related: continues 7969→7971
- Uncertainty: "Sales & Auctions"/"Articles" unexpected for pure rental PM — implies sales/marketplace content too

#### IMG_7971.PNG

- Device: Phone, mobile web
- Module: More — Finance/Workspace
- UI patterns: Finance continued (Rent Due, Invoices, Expenses, Rental Deposits, Match Bank Payments, Owner Statements, Vendor Invoices, Trial Balance, Tax Pack); Workspace (Documents, Workspaces, Organisation, Neighbourhood, Audit History, Settings)
- Related: continues 7970→7972
- Uncertainty: "Match Bank Payments"/"Trial Balance"/"Tax Pack" imply full accounting module

#### IMG_7972.PNG

- Device: Phone, mobile web
- Module: More — System + Sign out
- Actions: "Sign Out"
- UI patterns: Workspace repeat; System: Analytics, Collections, Messages, Notifications, Legal; footer "© 2026 PropView"
- Related: end of More-menu scroll (7969→7972)
- Uncertainty: "Collections" purpose unclear (possibly rent-arrears workflow)

#### IMG_7973.PNG

- Device: Phone, mobile web
- User type: Tenant (portal switched, same account)
- Module: Tenant Dashboard/Home
- Nav: bottom tabs switch to Home, My Lease, Payments, Maintenance, More
- Metrics: "Paid up", "R0 Current Balance", "0 Maintenance Tickets", "0 Unread Notices" (all positive/green)
- UI patterns: "Finish setting up — 0/5 done" (fewer steps than landlord's 7)
- Related: confirms same web app serves both portals via toggle; precedes 7974

#### IMG_7974.PNG

- Device: Phone, mobile web
- Module: Tenant Dashboard — "Connected Tenancy Workflows"
- UI patterns: feature rows: lease/deposit/inspection evidence, rent/receipts/statements, maintenance/approved vendors, building notices (with acknowledgement requirement)
- Related: continues 7973→7975

#### IMG_7975.PNG / IMG_7976.PNG

- Device: Phone, mobile web
- Module: Tenant Dashboard — Recent Activity / Upcoming Events
- UI patterns: "No activity yet"; "Nothing scheduled" empty states
- Uncertainty: 7976 is a near-duplicate of 7975 (accidental re-shot)

#### IMG_7977.PNG

- Device: Phone, mobile web
- Module: My Lease (tenant)
- UI patterns: empty state — "No active lease found — Your landlord creates your lease — it will appear here" (tenant cannot self-create)
- Related: mirrors landlord empty Leases (7965)

#### IMG_7978.PNG

- Device: Phone, mobile web
- Module: Payments (tenant) — "Balance & Payments"
- Metrics: "Current Balance R0.00 — Due 29 Jul 2026"; "Next Payment R0"; "Paid This Month R0"
- Actions: "Log a Payment"; Payment Reminders toggle (Active)
- UI patterns: manual EFT-based logging, not in-app processing
- Related: precedes 7979

#### IMG_7979.PNG

- Device: Phone, mobile web
- Module: Payments (tenant)
- UI patterns: "Rent Dues" empty ("appear after your landlord creates an active lease"); "Payment History" heading
- Related: continues 7978

#### IMG_7980.PNG

- Device: Phone, mobile web
- Module: Maintenance (tenant) — "Submit New Issue"
- Fields: Issue Summary, Detailed Description (0/2000, suggestion chips), Priority (Low/Med[default]/High/Urgent), Photos (Add/Camera)
- Related: continues to 7981, 7982

#### IMG_7981.PNG

- Device: Phone, mobile web
- Module: Maintenance (tenant) form, scrolled
- Actions: "Submit Request"
- UI patterns: "first photo used as cover, add up to 12"
- Related: continues 7980→7982

#### IMG_7982.PNG

- Device: Phone, mobile web
- Module: Maintenance (tenant) — Active Requests
- UI patterns: empty state "No active requests"
- Related: completes maintenance submission flow (7980→7982)

#### IMG_7983.PNG

- Device: Phone, mobile web
- Module: More (tenant) — Account & Switch Portal
- Status: "2 enabled", "Active" (Tenant), orange warning "Waiting for a landlord invite to show lease data"
- Related: mirrors landlord Switch Portal (7969); precedes 7984
- Uncertainty: odd that Ahmed is both landlord and tenant yet lease data isn't linked — suggests portals are independent even under one login

#### IMG_7984.PNG

- Device: Phone, mobile web
- Module: More (tenant) — feature tiles
- UI patterns: Get Started, Approved Vendors, Submit Meter Reading, Messages, Invoices, Documents, Announcements, Notifications, Profile & Notices
- Related: continues 7983→7985

#### IMG_7985.PNG

- Device: Phone, mobile web
- Module: More (tenant) — bottom of menu
- Actions: "Sign Out"
- UI patterns: tenant's More menu is a strict subset of landlord's (no Finance/portfolio tools); footer "© 2026 PropView"
- Related: end of tenant More scroll (7983→7985)

#### IMG_7986.JPG

- Device: Desktop/laptop web (camera photo, Chrome, propview.expo.app/dashboard)
- Module: Dashboard
- Nav: persistent left sidebar "LANDLORD CONSOLE" — OVERVIEW (Dashboard active, Insights, Reports), PORTFOLIO (Properties, Units, Portfolio Map, Owners, Valuations), LEASING (Leases…); top bar: breadcrumb, Search (Ctrl K), theme toggle, bell
- Metrics: "Rent this month: R0"
- UI patterns: light theme (vs. mobile dark) — confirms theme switching; wider 4-column common-tasks grid
- Related: desktop equivalent of 7957–7961; continues to 7987

#### IMG_7987.JPG

- Device: Desktop/laptop web
- Module: Dashboard — Key numbers
- Metrics: "0 Properties", "0% Units occupied", "+R0 Cash left this month", "0 Units available"
- UI patterns: 3-column KPI grid; "More tools" 7-icon row
- Related: continues 7986→7988

#### IMG_7988.JPG / IMG_7989.JPG

- Device: Desktop/laptop web
- Module: Dashboard — Money in/out, Recent work
- UI patterns: matches mobile 7959–7961 content, wider layout
- Related: completes desktop Dashboard scroll (7986→7989)

#### IMG_7990.JPG

- Device: Desktop/laptop web (propview.expo.app/intelligence)
- Module: Insights / Portfolio Intelligence
- Status: "All clear" (sparkle-star icon)
- UI patterns: "Helpful pointers... explained in plain language... worked out from your own live data... Nothing is estimated or made up" — rules-based, data-grounded, explicit anti-hallucination disclaimer
- Related: reached via sidebar Insights link

**Batch 1 recurring patterns**: single Expo/RN-Web codebase serving both breakpoints; dark mobile / light desktop theming; consistent empty-state formula (icon badge + headline + subtext + CTA); KPI card anatomy (icon, number, label, subtext, chevron); "More tools" feature-row disclosure pattern; two distinct AI surfaces (conversational Assistant vs. rules-based Portfolio Intelligence); role-scoped portal switching (Landlord full menu vs. Tenant strict subset); form patterns (char counters, suggestion chips, segmented-button enums).

### Batch 2 (IMG_7991–IMG_8026)

All 35 are camera photos of the same HP laptop (Chrome, propview.expo.app, glare/crack artifacts throughout), same account, all data at zero/empty state. Sidebar confirmed via scroll continuity: OVERVIEW (Dashboard, Insights, Reports) → PORTFOLIO (Properties, Units, Portfolio Map, Owners, Valuations) → LEASING (Leases, Tenants, Applications, Listings, Enquiries, Articles, Sales & Auctions, Virtual Tours) → OPERATIONS (Maintenance, Inspections).

#### IMG_7991–7995.JPG — Reports & Analytics

- Module: Reports; breadcrumb "Landlord Console > Reports"
- Metrics: "R0 Revenue (12mo)", "R0 Monthly Expenses", "0% Occupancy Rate", "0 Open Maintenance"
- UI patterns: 4 report cards scrolled top→bottom, each with matching empty state + CTA: Income vs. Expense Trend ("+ Open Rent Dues"), Occupancy by Property ("+ Add Property"), Tenant Payment Status ("+ Add Tenant"), Maintenance by Status (no CTA, informational)
- Uncertainty: "R" currency + later POPIA references confirm South Africa market

#### IMG_7996–7997.JPG — Properties

- Module: Properties; breadcrumb "Landlord Console > Properties"
- Fields: Search properties, Property type dropdown (All)
- UI patterns: empty state "Add your first property — Name, address and rent — it takes a minute"; "Add Many Properties at Once" bulk import; "More Property Tools": Units & Spaces, Listings Studio, Valuations, Neighbourhood Insights, Tours & Staging

#### IMG_7998–7999.JPG — Units (near-duplicates)

- Module: Units; breadcrumb "Landlord Console > Units"
- Metrics: "0 Units", "0 Occupied", "0 Vacant"
- UI patterns: "Set up your first property — Let the assistant do it: describe a complex and it creates every unit for you" + "+ Set up with Assistant" CTA — AI-assisted unit generation

#### IMG_8001–8003.JPG — Portfolio Map

- Module: Portfolio Map; breadcrumb "Landlord Console > Portfolio Map"
- Metrics: 6 KPIs — Total Properties, Total Units, Occupancy Rate, Vacant Units, Rent Collected (30d), Upcoming Leases (60d)
- Filters: property-type pills — All, House, Apartment/Flat, Townhouse, Duplex, Complex, Room/Cottage, Commercial
- UI patterns: "Property Locations" card = entry point only ("Open Portfolio Map"), actual map not rendered in captures; "All Properties" list empty state

#### IMG_8004–8005.JPG — Owners

- Module: Owners; breadcrumb "Landlord Console > Owners"
- Metrics: "0 Owners", "0 Active mandates"
- Filters: All, Individual, Company, Trust
- UI patterns: "Add your first owner — Record who owns each property — individuals, companies or trusts — and link management mandates"
- Uncertainty: "Active mandates" = formal SA property-management management-agreement term; console may also serve managing agents administering multiple owners

#### IMG_8006–8007.JPG — Valuations

- Module: Valuations; breadcrumb "Landlord Console > Valuations"
- Metrics: "0 Properties Valued", "R0 Portfolio Estimate", "R0 Avg. Est. Rent"
- UI patterns: "Valuations are a running history you record by hand... nothing is overwritten" — manual entry only, no automated AVM

#### IMG_8008–8009.JPG — Leases

- Module: Leases; breadcrumb "Landlord Console > Leases"
- UI patterns: "Create a lease, upload a signed lease PDF and let PropView read it, or bring your whole book across from a spreadsheet"; "More Lease Tools": Applications & Screening, Inspections, Trust & Deposits ("what it has earned" = interest-bearing), Invoices & Receipts

#### IMG_8010–8011.JPG — Tenants

- Module: Tenants; breadcrumb "Landlord Console > Tenants" — "Tenant Directory"
- Metrics: "0 Total Tenants", "0 Active Leases", "0 Expired Leases", "0 Pending Apps"
- Filters: All, Active, Expired, Pending
- UI patterns: "Add your first tenant, or upload a signed lease and let PropView create the records"
- Note: this screenshot reveals the full LEASING sidebar group for the first time

#### IMG_8012–8013.JPG — Applications & Screening

- Module: Applications; breadcrumb "Landlord Console > Applications"
- Metrics: "0 Awaiting review", "0 In screening (Consent-gated)", "0 Approved (this month)"
- Filters: Submitted, Screening, Decided, All
- UI patterns: "Capture the application with the applicant's POPIA consent, run the affordability screen once they also agree to the credit check, then approve to create the tenant, lease and rent schedule in one step — or decline with a recorded reason"
- Note: confirms SA-market compliance (POPIA) and the approve→auto-create-tenant/lease/rent-schedule automation

#### IMG_8014–8016.JPG — Listings Studio

- Module: Listings; breadcrumb "Landlord Console > Listings" — "Listings Studio"
- Metrics: "0 Published", "0 Drafts", "0 Total Views", "0 New Leads"
- Filters: All, Draft, Published, "Let & Archived"
- UI patterns: "Enquiries & Leads" and "Upcoming Viewings" sub-sections; full funnel described: "Build a listing from a property, publish it public, then work the enquiries that come back — mark them contacted, book a viewing, and move the winner into an application"

#### IMG_8017–8018.JPG — Enquiries

- Module: Enquiries (route `/leads` — internal naming inconsistency vs. sidebar label "Enquiries"); breadcrumb "Landlord Console > Enquiries"
- Metrics: "0 Waiting on you", "0 In progress"
- Filters: New, Contacted, Viewing, Applied, All

#### IMG_8019–8020.JPG — Articles

- Module: Articles; breadcrumb "Landlord Console > Articles" — "Insights & articles"
- Actions: "+ Write an article", "See the public page"
- Filters: All, Draft, Published, Archived
- UI patterns: landlord-run content/blog CMS tied to a public-facing page — marketing/SEO tool bundled into the console

#### IMG_8021.JPG — Sales & Auctions

- Module: Sales & Auctions; breadcrumb "Landlord Console > Sales & Auctions"
- UI patterns: "List a property for private-treaty sale or put it up for auction, and track every offer to purchase in one place" — extends beyond rental PM into sales brokerage; "private-treaty sale" is SA/AU real-estate terminology

#### IMG_8022.JPG — Virtual Tours

- Module: Virtual Tours; breadcrumb "Landlord Console > Virtual Tours" — "Tours & Staging"
- UI patterns: "Tours are built room by room for a property" — structured per-room tour builder

#### IMG_8023–8024.JPG — Maintenance Board

- Module: Maintenance; breadcrumb "Landlord Console > Maintenance"
- Metrics: "0 Open Tickets", "0 In Progress", "0 Completed", "0 Overdue"
- Filters: To Do(0), In Progress(0), Pending Approval(0), Completed(0)
- UI patterns: "Service Operations": Vendors & Approvals, Vendor Bills; "More Tools": News & Announcements ("see who has read them"), Portfolio Intelligence

#### IMG_8025–8026.JPG — Inspections

- Module: Inspections; breadcrumb "Landlord Console > Inspections"
- Metrics: "0 Scheduled", "0 In progress", "0 Awaiting sig"
- Filters: Scheduled, In progress, Awaiting sig, Completed, All
- UI patterns: "Book the inspection, then walk it room by room — rate each item, add photos as evidence and flag defects. Both you and the tenant sign it off (or the tenant's refusal is recorded), and only then can it complete"

**Batch 2 recurring patterns**: persistent sidebar with uppercase section labels; breadcrumb "Landlord Console > [Section]"; KPI card row (2–6 cards) on every list-type module; consistent "No X yet" + CTA empty states with warm conversational copy; filter pills (active = solid blue); "How It Works" explainer cards (Valuations, Applications, Listings, Inspections); "More Tools" sub-menu rows (Properties, Leases, Maintenance); ZAR currency + explicit POPIA/private-treaty-sale references confirming South African market; AI-assisted features recur as a pattern (natural-language unit setup, lease PDF parsing, Portfolio Intelligence) rather than a single dedicated AI section.

### Batch 3 (IMG_8027–IMG_8060)

Continuous walkthrough of OPERATIONS → FINANCE → WORKSPACE sidebar groups, same laptop/account. Nearly all views empty (demo account) — evidence value is navigation structure, empty-state copy, and page chrome. Logged in as Ahmed Seedat, role "Principal."

#### IMG_8027.JPG — Tasks & Reminders

- Breadcrumb "Landlord Console > Tasks"; filters: All, Pending, In Progress, Overdue, Completed
- UI patterns: "No tasks yet — Track inspections, renewals and follow-ups in one place"

#### IMG_8028–8029.JPG — Vendors

- Breadcrumb "Landlord Console > Vendors"
- Fields: Search name/trade/suburb/area; trade-category pills: All, Plumbing, Electrical, Air Conditioning, Cleaning, Garden Services, Pest Control, Painting, Roofing, Security, General Maintenance, Other
- UI patterns: vendor cards (name, trade badge, star rating); "+ Add a vendor outside PropView" (external/unregistered vendor support); seeded demo vendor names visible (e.g. "Mohamed Sidiyot", "Rashaad Bhamjee")

#### IMG_8030–8031.JPG — Announcements

- Breadcrumb "Landlord Console > Announcements" — "News & Announcements"
- Metrics: "0 Active Notices", "0 Awaiting Acknowledgement"
- Filters: All, Active, Needs Ack, Expired
- UI patterns: "Publishing notifies every targeted tenant automatically, and expiring a notice takes it down without deleting the record or its read receipts"

#### IMG_8032–8033.JPG — Rent Due

- Breadcrumb "Landlord Console > Rent Due" — "Rent Dues"
- Actions: "Recalculate rent due", "Match bank payments"
- Metrics: "R0 Outstanding", "0 Overdue", "0 Paid", "0 All records"
- UI patterns: "Card payments update automatically after the payment provider confirms them. For EFT or cash, first check your bank, then approve the payment claim or match the bank statement line"; "Add an active lease and rent will be tracked here automatically"

#### IMG_8034–8035.JPG — Invoices

- Breadcrumb "Landlord Console > Invoices" — "Invoices and receipts"
- Metrics: "0 Drafts", "R0 Outstanding"
- Filters: All, Draft, Issued, Paid
- UI patterns: "Download any invoice as a PDF. After you issue it, you can email the PDF to the tenant address saved in PropView. Each email is recorded for your audit history"; "PropView makes draft invoices from your rent and other charges. Open Rent Due to prepare this month's charges" — explicit Rent Due → Invoices pipeline

#### IMG_8036–8037.JPG — Expenses

- Breadcrumb "Landlord Console > Expenses" — "Expense Ledger"
- Metrics: "R0 Total Expenses", "R0 This Month", "0 Pending", "0 Imported"
- Filters: All, Recorded, Pending, Reimbursed, Void
- UI patterns: "Add one manually, or upload an invoice and let PropView fill in the details" — AI/OCR invoice parsing

#### IMG_8038–8039.JPG — Rental Deposits / Trust

- Breadcrumb "Landlord Console > Rental Deposits" — "Trust & Deposits"
- Metrics: "R0 Held in trust", "R0 Interest accrued (RHA rules)"
- UI patterns: "Deposits live in a trust-class ledger, separate from operating money. Interest accrues on the schedule set for your organisation, and release is gated: no deduction without findings on a completed move-out inspection" — RHA = SA Rental Housing Act

#### IMG_8040.JPG — Match Bank Payments

- Breadcrumb "Landlord Console > Match Bank Payments" — "Bank Reconciliation"
- UI patterns: "Your bank accounts show up here once your money records are set up... Business and trust accounts are kept separate" — confirms separate business/trust bank account architecture

#### IMG_8041–8043.JPG — Owner Statements

- Breadcrumb "Landlord Console > Owner Statements"
- Fields: month picker pills (May/Jun/Jul 2026)
- Metrics: "0 This Period", "R0 Net Due", "R0 Paid Out"
- Filters: All, Draft, Issued, Paid
- UI patterns: "Pick a month and draft a statement for every owner with ledger activity. Owners who already have one for that month are skipped"; "A payout is only marked paid after an outgoing bank line matches the amount" — reveals ownership-share payout logic tied to bank reconciliation
- Note: system date visible as 2026/07/29, consistent with session date

#### IMG_8044.JPG — Vendor Invoices (Vendor Bills)

- Breadcrumb "Landlord Console > Vendor Invoices" — "Vendor Bills"
- Metrics: "0 Awaiting review", "R0 Approved, unpaid"
- Filters: All, Submitted, Approved, Paid, Rejected
- UI patterns: "Invoices vendors submit against jobs land here for approval, then payout" — implies a vendor-facing submission mechanism not itself captured
- Note: this screenshot also reveals full WORKSPACE nav for the first time: Documents, Workspaces, Organisation, Neighbourhood, Audit History, Settings

#### IMG_8045–8046.JPG — Trial Balance

- Breadcrumb "Landlord Console > Trial Balance"
- Metrics: "R0 Total debits", "R0 Total credits"
- Filters: All, Business, Trust, Deposits
- Status: "Balanced" (green badge) — "Every entry in your ledger has an equal and opposite side" — real double-entry bookkeeping confirmed
- UI patterns: "Once rent is invoiced, paid or expensed, every movement appears here as a debit and a matching credit"

#### IMG_8047–8050.JPG — Tax Pack (SARS)

- Breadcrumb "Landlord Console > Tax Pack"
- Metrics: "R0 Gross Rental Income", "R0 Deductible Expenses", "R0 Net Rental Result"
- Filters: tax-year tabs — 2027 (active), 2026, 2025; "SA tax years run 1 March to end February"
- UI patterns: "Per Property" and "Expenses By Category" breakdowns; "Export Tax Pack (PDF)"; disclaimer: "Income shown is payments actually received in the period... Bond interest, wear-and-tear and other allowances are not tracked here. This is not tax advice — confirm treatment with SARS or a registered tax practitioner before filing"

#### IMG_8051–8052.JPG — Documents (Vault)

- Breadcrumb "Landlord Console > Documents" — "Documents Vault"
- Metrics: "0 Pending Review", "0 Updated This Week", "0 Expired", "0 Archived"
- UI patterns: "Upload a lease, invoice or statement — PropView reads it and files the details for you" — AI/OCR parsing confirmed across the app, not just Expenses/Leases

#### IMG_8053.JPG — Workspaces

- Breadcrumb "Landlord Console > Workspaces"
- Status: "Principal" role badge, "Current" tag
- UI patterns: "You belong to one workspace. Anyone who invites you to theirs will appear here, and you can move between them without signing out" — this is an org-membership switcher, distinct from Landlord/Tenant portal switching; links to Organisation settings

#### IMG_8054–8056.JPG — Organisation

- Breadcrumb "Landlord Console > Organisation"
- Fields: Organisation Name, Trading Name, Type (Owner-managed / Agency toggle), CIPC Reg No., VAT No., SARS Tax No., POPIA Information Officer, Invoice Prefix, Deposit Interest % (RHA), Fidelity Fund Certificate (FFC Number/Issued/Expires — required for agencies handling trust money under the Property Practitioners Act)
- Team Seats: "Create & Share Invite" — Email + Role selector (manager/agent[default]/accountant/viewer); existing seat: Ahmed Seedat, "principal" badge, joined 21 Jul 2026
- UI patterns: "Managers run everything · agents handle day-to-day operations · accountants see money · viewers are read-only" — explicit 5-tier RBAC (principal + manager/agent/accountant/viewer)

#### IMG_8057–8058.JPG — Neighbourhood

- Breadcrumb "Landlord Console > Neighbourhood" — "Neighbourhood Insights"
- Metrics: "0 Area Notes", "— Top Category"
- Filters: All, Schools, Transport, Safety, Amenities, Market, General
- UI patterns: "Area notes are reusable snippets... that you can drop straight into a listing advert"

#### IMG_8059.JPG — Audit History

- Breadcrumb "Landlord Console > Audit History" — "Audit Log"
- Actions: "Export Data"
- Fields: Search action/detail/user
- UI patterns: date-grouped log ("21 Jul 2026"), entry: avatar, "Signed in", tag "auth", "Password sign-in", email + timestamp
- Uncertainty: avatar shown as "V" not "AS"/"A" seen elsewhere — possibly a different actor or rendering artifact

#### IMG_8060.JPG — Settings (personal profile)

- Breadcrumb "Landlord Console > Settings"
- Fields: Full Name, Email, Phone Number, Physical Address
- Note: distinct from the Organisation settings form (8054) — personal profile vs. org profile are separate pages

**Batch 3 recurring patterns**: near-universally empty-state list views with the standard icon+headline+subtext+CTA formula; 2–4 card stat grids on every Finance/Operations module; filter-pill rows; "How It Works" explainer cards (Announcements, Rental Deposits, Owner Statements, Documents, Neighbourhood); deep, explicit South African regulatory grounding as a product-level differentiator (RHA deposit interest, SARS tax-year reporting + disclaimer, POPIA Information Officer, CIPC registration, PPA Fidelity Fund Certificate, VAT number); explicit 5-tier RBAC (principal/manager/agent/accountant/viewer); real double-entry bookkeeping with Business/Trust/Deposits ledger separation; recurring AI/automation copy (document reading, auto-draft invoices/statements, auto-notify on publish).

### Batch 4 (IMG_8061–IMG_8094)

Continuous walkthrough finishing the landlord Settings/onboarding/notifications pages, then the full Tenant Portal. Same account/laptop; several images (8068–8072) are the same session rotated 90° while the photographer scrolled the sidebar.

#### IMG_8061–8063.JPG — Settings (landlord)

- Breadcrumb "Landlord Console > Settings"
- Actions: Manage Plan, Payment Methods, Open Security Centre, Change Password, Export My Data, Deactivate Account (destructive, red), Sign Out
- Fields: Appearance (System/Light/Dark), Currency (ZAR — South African Rand)
- Status: "Agency" plan badge
- UI patterns: section cards (Billing & Payment, Appearance, Currency, Notifications, Security & Privacy, Account Management); destructive action styled full-width dark-red with warning caption, always near Sign Out

#### IMG_8064–8066.JPG — Get Started (onboarding)

- Breadcrumb "Landlord Console > Get Started"
- Metrics: "0 of 7 steps done"
- UI patterns: 7-step checklist — Add first property, Generate units for a complex, Add a tenant, Create a lease, Invite tenant to app, Approve a vendor, Upload a document (AI-read) — ending "Go to dashboard"

#### IMG_8067.JPG — Notifications (landlord)

- Breadcrumb "Landlord Console > Notifications"
- UI patterns: "No notifications yet — You are all caught up"; header "Portfolio Updates — Maintenance, payment, lease, and account updates are collected here"

#### IMG_8068–8072.JPG — Full sidebar nav capture (rotated 90°)

- Confirms complete landlord sidebar taxonomy in one continuous scroll: OVERVIEW (Dashboard, Insights, Reports) → PORTFOLIO (Properties, Units, Portfolio Map, Owners, Valuations) → LEASING (Leases, Tenants, Applications, Listings, Enquiries, Articles, Sales & Auctions, Virtual Tours) → OPERATIONS (Maintenance, Inspections, Tasks, Vendors, Announcements) → FINANCE (Rent Due, Invoices, Expenses, Rental Deposits, Match Bank Payments) → [Owner Statements, Vendor Invoices, Trial Balance, Tax Pack] → WORKSPACE (Documents, Workspaces, Organisation, Neighbourhood, Audit History, Settings)
- Uncertainty: the Owner Statements/Vendor Invoices/Trial Balance/Tax Pack group appears under a plain continuation in some captures and under an explicit "WORKSPACE" label in this one — exact section-header boundary is a best-effort read, not confirmed

#### IMG_8073.JPG — Account dropdown / Switch Portal (rotated)

- UI patterns: dropdown items: Profile, Settings, Workspace Settings, Usage & Plan, Help; "Switch Portal": Landlord ("Manage properties, tenants, leases, maintenance and documents" — Active) / Tenant ("View your lease, payments, documents and maintenance requests" — "Waiting for a landlord invite to show lease data"); Manage Portals, Log out
- Note: this is the mechanism bridging Landlord Console → Tenant Portal
- Uncertainty: "2 enabled" label meaning unclear

#### IMG_8074–8076.JPG — Tenant Portal Home

- Breadcrumb "Tenant Portal > Home"; sidebar: OVERVIEW (Home), MY TENANCY (My Lease, Payments, Documents), FIND A HOME (Find a home), REQUESTS (Maintenance, Vendors, Meter Reading), UPDATES (Announcements, Notifications), ACCOUNT (Profile & Notices)
- Metrics: "Paid up" (Next Rent Due —), "R0 Current Balance", "0 Maintenance Tickets", "0 Unread Notices"
- UI patterns: "Finish setting up — 0/5 done"; "Connected Tenancy Workflows" links (lease/deposit/inspection evidence, rent/receipts/statements, maintenance/approved vendors, building notices); Recent Activity + Upcoming Events (both empty)

#### IMG_8077.JPG — My Lease (tenant)

- Breadcrumb "Tenant Portal > My Lease"
- UI patterns: "No active lease found — Your landlord creates your lease — it will appear here"

#### IMG_8078–8079.JPG — Payments (tenant)

- Breadcrumb "Tenant Portal > Payments" — "Balance & Payments"
- Metrics: "Current Balance R0,00 (Due 29 Jul 2026)", "Next Payment R0", "Paid This Month R0"
- Actions: "Log a Payment", Payment Reminders toggle (Active), "Manage Payment Methods"
- UI patterns: "Payments are made by EFT and logged here" — confirms payments are not processed in-app

#### IMG_8080.JPG — Documents (tenant)

- Breadcrumb "Tenant Portal > Documents"
- UI patterns: "No documents yet — Your lease and any documents your landlord shares with you appear here"

#### IMG_8081–8082.JPG — Find a home

- Breadcrumb "Tenant Portal > Find a home"
- Fields: keyword search, Area/Budget/Size dropdowns, Pet friendly toggle
- UI patterns: "Nothing matches yet — New homes are listed here as landlords publish them" — surfaces the landlord's own published Listings

#### IMG_8083–8085.JPG — Maintenance (tenant)

- Breadcrumb "Tenant Portal > Maintenance" — "Submit New Issue"
- Fields: Issue Summary, Detailed Description (0/2000, suggestion chips: "It started this week.", "It gets worse when it rains.", etc.), Priority (Low/Med[default]/High/Urgent), Photos (Add/Camera, cover + up to 12)
- UI patterns: "Active Requests" empty after submit

#### IMG_8086.JPG — Vendors (tenant, read-only)

- Breadcrumb "Tenant Portal > Vendors"
- UI patterns: "Vendors your landlord has approved for your property — safe to contact directly. For anything else, log a maintenance request"; "No approved vendors yet"

#### IMG_8087.JPG — Meter Reading

- Breadcrumb "Tenant Portal > Meter Reading" — "Submit Reading"
- UI patterns: "No meters to submit — Your landlord hasn't set up a meter you can read. Prepaid meters don't need submissions"

#### IMG_8088.JPG — Announcements (tenant)

- Breadcrumb "Tenant Portal > Announcements" — "Building notices"
- UI patterns: "No notices right now — Notices your landlord posts for your building will appear here"

#### IMG_8089.JPG — Notifications (tenant)

- Breadcrumb "Tenant Portal > Notifications"
- UI patterns: matches landlord Notifications pattern exactly; header "Tenant Updates"

#### IMG_8090–8094.JPG — Profile & Notices (tenant settings)

- Breadcrumb "Tenant Portal > Profile & Notices"
- Fields: Full Name, Email, Phone, Address; Appearance (System/Light/Dark); Notification Preferences — Rent Reminders, Maintenance Updates, Lease Updates, Important Announcements, Promotional Offers (all toggleable) + "Email Me Too"
- Actions: View Document (Privacy Policy, Terms of Service), Manage My Consent & Data Rights, Open Security Centre, Change Password, Export My Data, Deactivate Account (destructive), Sign Out
- Note: this page is structurally a near-exact mirror of the landlord Settings page (8061–8063) — confirms one shared settings-page template reused across both portals

**Batch 4 recurring patterns**: consistent empty-state formula app-wide; breadcrumb "[Portal] > [Page]" on every page; sidebar grouped under uppercase small-caps section labels, different taxonomies per portal (landlord: Overview/Portfolio/Leasing/Operations/Finance/Workspace; tenant: Overview/My Tenancy/Find a Home/Requests/Updates/Account); section-card composition on settings/detail pages; solid-blue primary buttons with small leading icons; destructive actions always dark-red, always paired with a warning caption, always near Sign Out; standard toggle switches; ZAR default currency; light AI-assist touches (maintenance-form suggestion chips, "PropView reads it" document parsing) layered onto otherwise standard CRUD forms; consistent top bar (search, theme toggle, bell, avatar) on every page.
