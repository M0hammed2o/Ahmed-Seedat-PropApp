# Native iOS Application — Implementation-Ready Specification

Extends `MOBILE_ARCHITECTURE_DECISION.md` (platform decision, one-app-per-platform reasoning,
native-vs-web scope split §6, native capabilities §7, offline strategy §9 — all unchanged,
referenced not repeated here) with the screen-by-screen, state-management, and platform-compliance
detail that document's §10 explicitly left for later. Written against the real API surface built
through `TASKS.md` M19 — every screen below maps to endpoints that exist and have been
typechecked/tested, not aspirational ones.

**Environment note**: written in a sandbox with no Xcode (requires macOS) and no way to compile,
run, or verify Swift code. This document is the deliverable for that reason — no `.swift` source
is produced here, per Mohammed's explicit instruction. Everything below is specified precisely
enough that implementation in a real Xcode environment should require no redesign, only
translation into code.

Cross-references used throughout: `DESIGN_SYSTEM.md` (tokens, component specs),
`DESIGN_REVIEW.md` §3 (role-specific experience definitions), `API_SPEC.md` (endpoint contracts),
`PERMISSIONS.md` (role/authorization model), `WHATSAPP.md` §2 (the 16-value closed notification
type list).

---

## 1. Scope (restates `MOBILE_ARCHITECTURE_DECISION.md` §6, for this document's own completeness)

One iOS app, Swift + SwiftUI, role-aware navigation switching between **Owner/Landlord** and
**Tenant** portal modes via the same in-session portal switcher PropView evidences. Staff and
Super Admin roles are **web-only** — not part of this app (`MOBILE_ARCHITECTURE_DECISION.md` §6
scopes native apps to owner/landlord + tenant only; `DESIGN_REVIEW.md` §3's Staff/Super-Admin
experiences are `apps/web` surfaces).

In scope: Dashboard/KPIs, Properties (view/light edit), Units (view), Tenants (view), Leases
(view + key actions), Rent status, Payments (log/view, approve EFT claims), Owner Statements
(view), Documents (view/upload), Maintenance (full flow), Approvals, Announcements, Notifications,
Tasks, Settings, AI Assistant (`AI_ARCHITECTURE.md` §1 — conversational, staged-changes-confirm
flow, already API-complete as of M18).

Out of scope (web-only, unchanged from `MOBILE_ARCHITECTURE_DECISION.md` §6): Trial Balance, Tax
Pack, Organisation compliance settings, Team Seats/RBAC, bulk import, Applications & Screening
multi-field review, Portfolio Map authoring, Audit History deep review, Super Admin portal
entirely.

---

## 2. Navigation architecture

**Root**: `TabView` (bottom tab bar, iOS-native — never a custom tab bar; PropView's own bottom
tab pattern on mobile web is confirmed-native-feeling enough to keep, per
`PROPVIEW_SCREENSHOT_AUDIT.md` §1's mobile-web description) with role-conditional tab sets.

```
RootView
├─ AuthCoordinator (unauthenticated)
│   ├─ SignInView
│   ├─ SignUpView
│   └─ PasswordResetView
└─ AuthenticatedRootView (post sign-in, portal-aware)
    ├─ PortalSwitcher (toolbar menu, top-level — not a tab; matches PropView's account-dropdown
    │   placement, PROPVIEW_SCREENSHOT_AUDIT.md §1 "GLOBAL")
    ├─ OwnerTabView (5 tabs, shown when active portal = owner/landlord)
    │   ├─ Tab 1: Dashboard  → NavigationStack
    │   ├─ Tab 2: Portfolio  → NavigationStack (Properties, Units, Leases, Tenants)
    │   ├─ Tab 3: Operations → NavigationStack (Maintenance, Approvals, Inspections)
    │   ├─ Tab 4: Finance    → NavigationStack (Rent Due, Payments, Owner Statements, Documents)
    │   └─ Tab 5: More       → NavigationStack (Announcements, Notifications, Tasks, AI Assistant, Settings)
    └─ TenantTabView (4 tabs, shown when active portal = tenant)
        ├─ Tab 1: Home       → NavigationStack (dashboard-equivalent KPIs)
        ├─ Tab 2: My Tenancy → NavigationStack (Lease, Payments, Documents)
        ├─ Tab 3: Requests   → NavigationStack (Maintenance, Vendors read-only, Meter Reading)
        └─ Tab 4: Account    → NavigationStack (Announcements, Notifications, Profile, Settings)
```

- Each tab owns its own `NavigationStack` with its own path (`NavigationPath` per tab, preserved
  across tab switches — iOS-idiomatic; matches the persistent-state expectation of a native tab
  bar, unlike PropView's web-reload-per-route behavior).
- Portal switch clears the *other* portal's navigation stacks (never leaves stale detail views
  live in the background across a portal switch — data-leakage-by-accident prevention, matching
  `PERMISSIONS.md`'s "never merge role systems" principle applied to UI state).
- AI Assistant is a `.sheet` presentation (bottom-sheet drawer) reachable from a floating action
  button layered above the tab bar on every owner-portal screen — matches PropView's FAB→drawer
  pattern (`AI_ARCHITECTURE.md` §1.1, `DESIGN_REVIEW.md` §2) exactly. Not present in tenant portal
  (Assistant is landlord/owner-only per `AI_ARCHITECTURE.md`'s context-assembly scope, which reads
  org-level data no tenant identity has).

## 3. Screen hierarchy — Owner/Landlord portal

```
Dashboard
  KPI cards (rent overdue count, rent due this week, open maintenance, leases expiring) — reads
    portfolio_insights (M18) directly, not a bespoke dashboard aggregation
  Recent activity feed (audit_events, org-scoped)
  → tap KPI card → deep-links into the relevant tab's filtered list (e.g. rent-overdue KPI →
    Finance tab, Rent Due screen, pre-filtered to overdue)

Portfolio tab
  PropertyListView (list, search, filter by status)
    → PropertyDetailView (KPI summary, unit list, light edit: nickname/address only —
      GET/PATCH /api/v1/properties/:id)
      → UnitDetailView (read-only: status, current lease link)
      → LeaseListView (filtered to this property)
  TenantListView (read-only directory, filter Active/Expired/Pending)
    → TenantDetailView (read-only: contact info, current lease, payment history summary)
  LeaseListView (all leases, filter by status)
    → LeaseDetailView (read + key actions: view rent schedule, view deposit status;
      approve_application()-driven leases show their source application read-only)

Operations tab
  MaintenanceBoardView (KPI counts + segmented control: To Do/In Progress/Pending Approval/Completed
    — DESIGN_SYSTEM.md "Forms" segmented-control spec, not a picker)
    → MaintenanceTicketDetailView (photos, status change, assign vendor — full flow both
      directions per MOBILE_ARCHITECTURE_DECISION.md §6's explicit native-app priority)
      → NewMaintenanceTicketView reused from tenant-submission flow where the owner is creating
        one directly (same form, different submitted_by)
  ApprovalsListView (maintenance approvals + application decisions needing sign-off)
  InspectionListView (read + initiate; full inspection-item capture is a stretch goal, view-first
    for V1 native scope — matches the master prompt's "oversight, approvals, visibility" framing
    for what native apps prioritize over full data-entry parity with web)

Finance tab
  RentDueView (rent_schedules board, PropView's auto-updating-on-confirmed-payment KPI card reused)
  PaymentsView (log EFT/cash payment claim → POST /api/v1/bank-transactions or the confirm-match
    flow; approve a tenant-submitted EFT claim)
  OwnerStatementsListView (view only — generation stays web-only per M14 part 3's own still-open
    status; this screen renders whatever exists in owner_statements, never drafts one)
  DocumentsListView (view/upload — PHPickerViewController for photo/PDF picks, camera capture via
    AVFoundation for a receipt/document photo)

More tab
  AnnouncementsListView (read + acknowledge)
  NotificationsListView (reads `notifications`, M15)
  TasksListView (generic task tracker — evidenced in PropView per
    PROPVIEW_SCREENSHOT_AUDIT.md §1 "Tasks & Reminders"; no backing schema exists yet in
    DATABASE.md — flag as an open schema gap if confirmed in scope, do not build against a table
    that doesn't exist)
  SettingsView (profile, appearance System/Light/Dark, notification preferences, security,
    account management — mirrors PropView's Settings page structure exactly,
    PROPVIEW_SCREENSHOT_AUDIT.md §1 "WORKSPACE > Settings")
```

## 4. Screen hierarchy — Tenant portal

```
Home
  KPI cards (paid-up status, current balance, open maintenance tickets, unread notices)
  Upcoming events/reminders

My Tenancy tab
  MyLeaseView (read-only, leases/lease_tenants — needs the tenant-self RLS branch flagged in
    DESIGN_REVIEW.md §3 as a still-open schema gap; native UI can be built against the contract
    now, wired once that RLS branch lands)
  PaymentsView (balance hero, due date, "Log a Payment" — external EFT, logged/reminded not
    processed in-app, matching ACCOUNTING.md's bank-reconciliation model exactly)
  DocumentsListView (landlord-shared documents, filterable)

Requests tab
  MaintenanceListView → NewMaintenanceTicketView (summary, description w/ character counter,
    priority segmented control, up to 12 photos incl. camera capture — PropView's exact form
    shape, PROPVIEW_SCREENSHOT_AUDIT.md §1 "REQUESTS > Maintenance") → ActiveRequestsListView
  VendorsListView (read-only, landlord-approved vendors)
  MeterReadingView (optional — only shown if the org doesn't use prepaid meters; schema gap flagged
    in DESIGN_REVIEW.md §3, same treatment as Tasks above)

Account tab
  AnnouncementsListView
  NotificationsListView
  ProfileView (personal info, appearance, notification preferences — 5 category toggles +
    email-copy toggle per PROPVIEW_SCREENSHOT_AUDIT.md §1's tenant Settings mirror, consent
    management, security, account management)
```

## 5. Component mapping — `DESIGN_SYSTEM.md` → SwiftUI

| Design system spec | SwiftUI implementation |
| --- | --- |
| Buttons (primary/secondary/destructive, 3 sizes) | `Button` with a custom `ButtonStyle` per variant (`PrimaryButtonStyle`, `SecondaryButtonStyle`, `DestructiveButtonStyle`), reading colours from a generated `ColorTokens` enum (see §14, shared token format) |
| KPI/stat card | `StatCardView` — `VStack` with a circular `.background(tone.opacity(0.1))` icon badge (SF Symbol), bold `.font(.title2.bold())` number, `.caption` label |
| List-row card | `SwiftUI List` with custom row `View`, leading icon/avatar, `VStack(alignment: .leading)` two-line text, trailing `StatusBadgeView` and/or `chevron.right` |
| Explainer card | `InfoCardView` — `RoundedRectangle` background at `Color(.secondarySystemBackground)`-equivalent token, `.font(.subheadline)` |
| Tables (web `AdminDataTable` equivalent) | Native lists don't need a table primitive — iOS uses `List`/`LazyVStack` row-based layouts throughout, never a literal scrollable grid-table (HIG guidance: tables are a desktop pattern) |
| Segmented control | Native `Picker(selection:) { }.pickerStyle(.segmented)` |
| Empty state | `EmptyStateView` — `ContentUnavailableView` (iOS 17+) with custom icon/title/description, or a custom equivalent for earlier target OS versions |
| Modal | `.sheet(isPresented:)` for confirm/cancel and short tasks; `.fullScreenCover` only for the sign-in flow |
| Alerts/toasts | Inline: a top-of-section `Banner` view. Transient: a custom `.toast()` view modifier (SwiftUI has no built-in toast) auto-dismissing after `motionDuration.slow`-scaled duration |
| Skeleton loading | `.redacted(reason: .placeholder)` modifier on real view hierarchy — never a bespoke shimmer view, since `.redacted` is the HIG-native mechanism |

## 6. HIG compliance

- **Navigation**: `TabView` + `NavigationStack` exclusively — no custom-drawn tab bars or nav
  bars (`MOBILE_ARCHITECTURE_DECISION.md` §2's classification of the existing Expo app explicitly
  rules out anything that isn't a "real" native navigation shell).
- **Typography**: Dynamic Type supported throughout — `DESIGN_SYSTEM.md`'s 6-step type scale maps
  to SwiftUI's `Font` text styles (`display`→`.largeTitle`, `title`→`.title`, `heading`→`.headline`,
  `body`→`.body`, `caption`→`.caption`, `micro`→`.caption2`), never a fixed-point-size `Font`.
- **Icons**: SF Symbols throughout, matched to `packages/ui`'s semantic icon names
  (`statusPresentation.ts`'s `check`/`dot`/`alert-triangle`/`eye`/`spinner`/`flag`/`slash` map to
  `checkmark.circle.fill`/`circle.fill`/`exclamationmark.triangle.fill`/`eye.fill`/
  `arrow.triangle.2.circlepath`/`flag.fill`/`slash.circle.fill`).
- **Gestures**: swipe-to-delete/archive on list rows where the underlying action is
  reversible-or-confirmed (never on Archive — that stays a deliberate tap + confirm per
  `DESIGN_SYSTEM.md`'s destructive-action rule); pull-to-refresh on every list screen.
- **Context menus**: long-press context menu on list rows for secondary actions (matches
  PropView's "chevron reveals more" pattern translated to iOS's native affordance).
- **Safe areas**: respected throughout via SwiftUI's default layout behavior — never a manual
  inset calculation.
- **Haptics**: `UIImpactFeedbackGenerator`/`UINotificationFeedbackGenerator` on confirm/success/
  error states for destructive or financially-significant actions (payment logged, ticket
  submitted, credit issued equivalent) — not decorative, reserved for state-changing confirmations.

## 7. State management

**Architecture**: MVVM with the Observation framework (`@Observable`, iOS 17+ target) — not
Combine-based `ObservableObject`/`@Published`, since `@Observable` is Apple's current-generation
recommendation and this is a greenfield app with no legacy-iOS-version constraint stated anywhere
in the architecture docs.

- Each screen has a `View` + a `@Observable` `ViewModel` owning its data-fetch/mutation state
  (`.loading`/`.loaded(T)`/`.error(String)`/`.empty` — a single `LoadState<T>` enum reused
  everywhere, mirroring the web's per-page loading/error/empty state discipline in
  `DESIGN_SYSTEM.md`).
- **No client-side business logic duplication**: every ViewModel calls the same
  `/api/v1/**` endpoints the web app calls (`API_SPEC.md` §0 — "Native mobile apps consume the
  same API surface as the web app — no mobile-only endpoints"). Validation is UX-only
  (`MOBILE_ARCHITECTURE_DECISION.md` §8), the server response is the source of truth for success/
  failure.
- **Networking layer**: a single `APIClient` actor wrapping `URLSession`, JWT bearer auth header
  injection, and typed `Codable` request/response models generated to mirror
  `packages/types`/`packages/validation`'s shapes field-for-field (manually kept in sync — no
  automatic codegen pipeline specified here, flagged as a build-tooling decision for whoever
  implements this, not decided in this document).
- **Session state**: a single `AuthCoordinator` (`@Observable`, app-wide singleton via
  `@Environment`) holding the current Supabase session, portal mode, and enabled portal list —
  mirrors `PortalSession`/`resolvePortalSession()`'s shape from `apps/admin/lib/orgSession.ts`
  conceptually (same "resolve every membership/identity in one pass" model), re-implemented
  against `supabase-swift`.

## 8. Offline behaviour (iOS specifics for `MOBILE_ARCHITECTURE_DECISION.md` §9)

- Read-through cache: `URLCache` configured with a custom disk cache, or a lightweight
  `Codable`-backed on-disk store per endpoint (implementer's choice at build time) — every list/
  detail screen's ViewModel shows a `"Showing cached data from [relative time]"` banner
  (`DESIGN_SYSTEM.md` Alerts, inline variant) when a fetch fails and cached data exists.
  `MOBILE_ARCHITECTURE_DECISION.md` §9's rule "never silently stale" applies to every such screen.
- Maintenance ticket submission offline queue: a local `SwiftData`/Core Data-backed queue entity
  (`PendingMaintenanceTicket`) written on submit-while-offline, retried via a `BGTaskScheduler`
  background task on reconnect, with photos held as local file references until upload succeeds.
  Queue state surfaces as a persistent banner ("1 request pending upload") on the
  `ActiveRequestsListView` per §9's "never a silent, invisible retry" rule.
- All other writes require connectivity — the relevant `Button` is `.disabled(!networkMonitor.isConnected)`
  with an inline caption explaining why, per §9's explicit V1 boundary.

## 9. Accessibility

- Every interactive element has an explicit `.accessibilityLabel`/`.accessibilityHint` — never
  relying on inferred labels from icon-only buttons (SF Symbol buttons always get an explicit
  label, e.g. `.accessibilityLabel("Archive organization")` not just the symbol name).
- Status is never colour-only in accessibility terms either: `StatusBadgeView` exposes its label
  text to VoiceOver regardless of visual colour, matching `DESIGN_SYSTEM.md`'s colour+icon+label
  rule at the accessibility-tree level, not just the visual level.
- Dynamic Type: every screen tested (once buildable) at the largest accessibility text sizes —
  layouts use `ViewThatFits`/adaptive stacks rather than fixed-width text containers that would
  truncate at large type sizes.
- Contrast: WCAG AA minimum (matches `DESIGN_SYSTEM.md`'s existing target), re-verified once final
  brand colours are chosen — unchanged requirement, now explicitly extended to the native surface.
- VoiceOver navigation order follows visual top-to-bottom, left-to-right reading order on every
  screen; grouped elements (a KPI card's icon+number+label) merge into one VoiceOver stop via
  `.accessibilityElement(children: .combine)` rather than three separate stops.
- Reduce Motion: respected via `@Environment(\.accessibilityReduceMotion)` — animations in §10
  degrade to instant-cut transitions when set.

## 10. Animations

Durations sourced from `packages/ui/src/tokens.ts`'s `motionDuration` (`fast 120ms, base 200ms,
slow 320ms`) via the shared token format (§14) — never a hand-picked SwiftUI default duration.

- Screen transitions: standard `NavigationStack` push/pop (system-provided, not overridden — HIG
  guidance against custom nav transitions).
- Sheet presentations (AI Assistant drawer, confirm modals): system sheet transition, `base`
  duration for any custom content fade-in within the sheet.
- List row insertion/removal (e.g. a maintenance ticket moving between board columns): `.animation(.easeOut(duration: motionDuration.base), value: ...)`.
- Skeleton→content transition: `slow` duration cross-fade, matching `DESIGN_SYSTEM.md`'s
  loading-state shimmer-to-content handoff intent.
- Success/error state changes (a submitted form's confirmation): `fast` duration, paired with the
  haptic feedback from §6.

## 11. Notifications

- **Transport**: `UNUserNotificationCenter` + APNs. Push payload categories map 1:1 to
  `WHATSAPP_NOTIFICATION_TYPES` (`packages/types/src/enums.ts`, `WHATSAPP.md` §2's closed 16-value
  list) — the same fixed trigger list drives both WhatsApp (M17) and native push, so a single
  server-side dispatcher decision ("this event fires `rent_overdue_material`") fans out to
  whichever channels (WhatsApp/push/email) the recipient has enabled, never a separate native-only
  notification taxonomy invented here.
- **Categories → `UNNotificationCategory`**: each of the 16 types gets its own category with
  contextual actions where applicable (e.g. `payment_awaiting_confirmation` → "Approve"/"View"
  actions directly on the notification; `maintenance_approval_urgent` → "Approve"/"Deny").
- **Foreground presentation**: banner + sound for `urgent`-severity-equivalent types
  (`rent_overdue_material`, `maintenance_update_critical`, `account_security_event`), banner-only
  (no sound) for informational ones — severity mapping reuses `PortfolioInsightSeverity`'s
  info/warning/urgent tiers conceptually, not a new scale invented for push.
- **Permission request timing**: never at first launch (HIG anti-pattern) — requested
  contextually, the first time a screen that benefits from it is reached (e.g. right after
  submitting a maintenance ticket: "Get notified when this is updated?").
- **Badge count**: unread `notifications` table count (M15), synced on each foreground/background
  transition and via silent push.

## 12. Deep links

- **Universal Links** (`https://app.propertyvault.example/...`, actual domain TBD — not a decision
  this document makes), matching every web route's path 1:1 where a native screen exists for it:
  `/customers/:orgId`-shaped web-only paths do NOT get a native deep link (Super Admin is
  web-only, §1); `/properties/:id`, `/leases/:id`, `/maintenance-tickets/:id` etc. do.
- **Notification tap → deep link**: every push notification's payload carries a
  `related_entity_type`/`related_entity_id` pair (matching `notifications` table's own columns,
  M15) that the app resolves to the correct in-app screen via a central `DeepLinkRouter`,
  pushing onto the correct tab's `NavigationStack` (switching tabs first if needed) rather than
  presenting a modal detached from normal navigation.
- **Unauthenticated deep link handling**: a deep link opened while signed out is held (stored,
  not discarded) through the sign-in flow and resolved immediately after successful auth —
  never silently dropped.

## 13. Biometric authentication

- `LocalAuthentication` framework — Face ID/Touch ID gate on app foreground-from-background (not
  on every screen transition), configurable in Settings (`PROPVIEW_SCREENSHOT_AUDIT.md` §1
  "Settings > Security" already evidences this as an expected control).
- Session token stored in Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` — never
  synced to iCloud Keychain, since a session token should not silently propagate to a second
  device), matching `MOBILE_ARCHITECTURE_DECISION.md` §7's "Keychain for token storage" decision.
- Biometric failure/unavailable fallback: device passcode (system-provided fallback via
  `LAPolicy.deviceOwnerAuthentication`, not a custom PIN — avoids maintaining a second credential
  system `SECURITY.md` would need to separately govern).
- Biometric lock is a client-side UX gate only — it does not affect API authorization, which
  remains the JWT session's own expiry/refresh cycle, unaffected by whether the app is currently
  biometric-locked.

## 14. Tablet (iPad) behaviour

- `NavigationSplitView` (not `TabView`) on iPad in regular width size class — sidebar (the tab
  list, rendered as a persistent left sidebar) + content column + optional detail column
  (3-column on iPadOS regular-regular, e.g. Portfolio → Property list → Property detail all
  visible simultaneously). This is the same desktop-SaaS "left navigation" shape
  `DESIGN_SYSTEM.md`'s Responsive rules section specifies for the web app — iPad regular width is
  functionally the same information density as a small desktop window, and should feel like one,
  not a stretched phone layout (mirrors the explicit instruction against stretching mobile to
  desktop, applied in reverse: don't shrink desktop patterns to compact-iPhone patterns either,
  use each sizeclass's native idiom).
- Compact width (iPad Split View / Slide Over, or any iPhone) uses the `TabView` hierarchy from
  §2 unchanged.
- Forms (maintenance ticket submission, etc.): full-width on iPhone, constrained to a
  readable max-width column (not edge-to-edge) on iPad regular width — avoids the "one giant
  form stretched across an iPad landscape screen" anti-pattern.
- Keyboard shortcuts (physical keyboard + trackpad support, increasingly expected on iPad):
  `⌘K` search (mirrors PropView's own `Ctrl/⌘-K` global search,
  `PROPVIEW_SCREENSHOT_AUDIT.md` §5), `⌘N` new item in list contexts where creation exists.

## 15. Shared design-token format (cross-platform, referenced by both this document and `NATIVE_ANDROID_SPEC.md`)

`packages/ui/src/tokens.ts` (TypeScript) is not directly consumable by Swift or Kotlin. Per
`MOBILE_ARCHITECTURE_DECISION.md` §8's own flag ("a shared design-token format consumable by both
Swift and Kotlin" — noted as future work), the concrete mechanism specified here: a build-time
JSON export of `tokens.ts`'s values (a small script, not yet written — flagged as a real,
small implementation task for whichever session has both a JS toolchain and reason to touch native
builds), consumed by:

- **iOS**: a generated `Tokens.swift` (enums/structs mirroring `colorLight`/`colorDark`/`spacing`/
  `radii`/`typeScale`/`motionDuration`/`iconSize`/`elevation`) via a small code-gen step (e.g. a
  Swift Package plugin or a pre-build script), never hand-copied values that could drift.
- **Android**: analogous generated Kotlin `object`s (`NATIVE_ANDROID_SPEC.md` §15).

This keeps the token source-of-truth singular (`packages/ui/src/tokens.ts`) exactly as
`DESIGN_SYSTEM.md` already requires for the web/RN surfaces, extended rather than duplicated for
native.
