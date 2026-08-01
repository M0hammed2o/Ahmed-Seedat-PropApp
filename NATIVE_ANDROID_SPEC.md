# Native Android Application — Implementation-Ready Specification

Extends `MOBILE_ARCHITECTURE_DECISION.md` (platform decision §5, native-vs-web scope split §6,
native capabilities §7, offline strategy §9 — all unchanged, referenced not repeated here) with
the screen-by-screen, state-management, and platform-compliance detail that document's §10
explicitly left for later. Mirrors `NATIVE_IOS_SPEC.md`'s structure and scope exactly (same
screens, same API surface, same design tokens) — divergences below are only where Android's own
platform idiom (Material 3, Compose, Android system services) genuinely differs from iOS's, not
because the product differs by platform.

**Environment note**: written in a sandbox with no confirmed Android SDK/Gradle/Android Studio
toolchain, so no Kotlin source can be compiled or run here either. This document is the
deliverable for that reason — no `.kt` source is produced, per Mohammed's explicit instruction.

Cross-references: `NATIVE_IOS_SPEC.md` (parallel spec, read together for the full picture),
`DESIGN_SYSTEM.md`, `DESIGN_REVIEW.md` §3, `API_SPEC.md`, `PERMISSIONS.md`, `WHATSAPP.md` §2.

---

## 1. Scope

Identical to `NATIVE_IOS_SPEC.md` §1 — one Android app, Kotlin + Jetpack Compose, role-aware
Owner/Landlord ↔ Tenant portal switching, Staff/Super-Admin web-only. Same in-scope/out-of-scope
module list; not repeated here to avoid the two documents drifting on product scope while
legitimately diverging on platform implementation.

## 2. Navigation architecture

**Root**: Navigation Compose (`NavHost`) with a bottom `NavigationBar` (Material 3 component,
Android's tab-bar equivalent) for the same 5 owner-tabs / 4 tenant-tabs structure as
`NATIVE_IOS_SPEC.md` §2:

```
RootNavHost
├─ AuthGraph (unauthenticated)
│   ├─ SignInScreen
│   ├─ SignUpScreen
│   └─ PasswordResetScreen
└─ AuthenticatedGraph (portal-aware)
    ├─ PortalSwitcher (top-app-bar dropdown menu — Material 3 `DropdownMenu` off the avatar,
    │   mirrors PropView's account-dropdown placement)
    ├─ OwnerNavGraph (5 bottom-nav destinations: Dashboard, Portfolio, Operations, Finance, More)
    └─ TenantNavGraph (4 bottom-nav destinations: Home, My Tenancy, Requests, Account)
```

- Each bottom-nav destination is itself a nested `NavHost` (a Compose "nested navigation graph"),
  preserving its own back stack independently per destination — the direct Compose Navigation
  equivalent of iOS's per-tab `NavigationStack`, same behavioral goal (switching tabs doesn't
  reset the other tab's drill-down state).
  - Except: a portal switch clears both graphs' back stacks entirely (same data-leakage-avoidance
    rule as `NATIVE_IOS_SPEC.md` §2).
- AI Assistant: a Material 3 `ModalBottomSheet` reached via a `FloatingActionButton` layered above
  the bottom nav bar, owner-portal-only — same reasoning as iOS.

## 3. Screen hierarchy — Owner/Landlord and Tenant portals

**Identical screen list and grouping to `NATIVE_IOS_SPEC.md` §3/§4** — restated here only where
the Android composable naming differs from the SwiftUI view naming, for implementer clarity:

| Concept | iOS | Android |
| --- | --- | --- |
| Screen | `View` (e.g. `PropertyDetailView`) | `Screen` composable (e.g. `PropertyDetailScreen`) |
| List | `List` | `LazyColumn` |
| Board/kanban (Maintenance) | `Picker(.segmented)` + filtered `List` | `TabRow` (Material 3) + filtered `LazyColumn`, or `LazyRow` of `LazyColumn`s for a true multi-column board on tablet (see §14) |
| Detail | `NavigationLink` push | `navController.navigate(route)` |

Every screen name, grouping, and data source (which endpoint each screen reads/writes) is
identical to `NATIVE_IOS_SPEC.md` §3/§4 — including the same two flagged open schema gaps (Tasks &
Reminders, Meter Reading — no backing `DATABASE.md` table yet, do not build against a
nonexistent schema) and the same tenant-self-RLS-branch dependency for `MyLeaseView`/lease reads.

## 4. Component mapping — `DESIGN_SYSTEM.md` → Jetpack Compose / Material 3

| Design system spec | Compose implementation |
| --- | --- |
| Buttons (primary/secondary/destructive, 3 sizes) | `Button` (primary, `ButtonDefaults.buttonColors`), `OutlinedButton` (secondary), `Button` with `ButtonDefaults.buttonColors(containerColor = errorContainer)` (destructive) — Material 3's own filled/outlined/text button taxonomy maps directly onto the 3-variant spec, no custom `ButtonStyle` needed the way iOS requires |
| KPI/stat card | `Card` (Material 3 `ElevatedCard` for `low` elevation) containing a circular `Surface` icon badge (`tone.copy(alpha = 0.1f)` background) + `MaterialTheme.typography.headlineSmall` number + `labelMedium` label |
| List-row card | `ListItem` (Material 3 component — built-in leading/trailing icon slots, two-line text, exactly matches the spec's anatomy natively) |
| Explainer card | `Card` with `CardDefaults.cardColors(containerColor = surfaceVariant)`, `bodyMedium` text |
| Tables | Not used — same reasoning as iOS, `LazyColumn` row-based lists throughout |
| Segmented control | Material 3 `SingleChoiceSegmentedButtonRow` |
| Empty state | Custom `EmptyStateComposable` (`Icon` in a tinted `Box`, `titleMedium` headline, `bodySmall` description, optional `Button`) — no Material 3 built-in, matches the same custom-component need as iOS's pre-17 fallback |
| Modal | `AlertDialog` (Material 3) for confirm/cancel; `ModalBottomSheet` for short focused tasks (mirrors the AI Assistant drawer) |
| Alerts/toasts | Inline: a `Card`/`Surface` banner at the top of the affected section. Transient: Compose `SnackbarHost`/`Snackbar` — Android's native toast-equivalent mechanism, used exactly where `NATIVE_IOS_SPEC.md` specifies a custom `.toast()` modifier (Android has this natively, iOS doesn't) |
| Skeleton loading | `Modifier.placeholder()` (via a small shimmer modifier, or Compose's `AnimatedVisibility`-driven shimmer `Brush`) over real layout shape — never a spinner for known-shape content, same rule as iOS |

## 5. Material Design 3 compliance

- **Navigation**: `NavigationBar` (bottom, ≤5 destinations — exactly the owner portal's 5-tab
  count, at M3's own recommended maximum) for compact width; `NavigationRail` for medium width;
  `NavigationDrawer` (permanent) for expanded width — M3's official three-tier adaptive navigation
  pattern, directly reused rather than inventing a custom breakpoint scheme (see §14).
- **Typography**: `DESIGN_SYSTEM.md`'s 6-step scale maps to M3's type scale —
  `display`→`displaySmall`, `title`→`headlineMedium`, `heading`→`titleLarge`, `body`→`bodyLarge`,
  `caption`→`bodySmall`, `micro`→`labelSmall`. Respects system font-scale settings throughout
  (Compose's `sp` unit is scale-aware by default — never hardcode `dp` for text).
- **Colour**: M3 dynamic colour (Material You, Android 12+) is **not** adopted — PropertyVault's
  own accent (`packages/ui`'s `#2F5D50`) is a deliberate brand choice
  (`DESIGN_SYSTEM.md` "Direction"), and letting it be overridden by the user's wallpaper-derived
  system palette would defeat that. A static M3 `ColorScheme` generated from `packages/ui/src/tokens.ts`
  (§15) is used on every Android version, dynamic colour explicitly disabled.
- **Icons**: Material Symbols (outlined style, matching the restrained/calm direction over M3's
  default filled style) mapped from the same `statusPresentation.ts` semantic names as iOS §6.
- **Elevation**: M3's tonal-elevation model (surface tint, not just shadow) maps onto
  `DESIGN_SYSTEM.md`'s `low/medium/high` levels — `low`→1dp tonal elevation, `medium`→3dp,
  `high`→6dp (M3's own scale), same usage rules (one meaning per level) as the web/iOS spec.
- **Ripple/state layers**: every interactive element gets M3's standard state-layer treatment
  (press/hover/focus opacity overlays) — native Compose behavior via `Modifier.clickable`, not
  suppressed or customized away.
- **Gestures**: swipe-to-dismiss on list rows for reversible actions (`SwipeToDismissBox`), same
  archive-excluded rule as iOS §6. Pull-to-refresh via `PullToRefreshBox` (M3).

## 6. State management

**Architecture**: MVVM with `ViewModel` (Android Architecture Components) + `StateFlow` — the
direct Android-idiomatic equivalent of iOS's `@Observable` ViewModel pattern in §7 of the iOS
spec; same `LoadState<T>` sealed-class equivalent (`sealed interface LoadState<out T> { object Loading; data class Loaded<T>(val data: T); data class Error(val message: String); object Empty }`)
reused across every screen, mirroring the shared discipline `NATIVE_IOS_SPEC.md` §7 establishes.

- Same "no client-side business logic duplication" rule — every ViewModel calls the identical
  `/api/v1/**` endpoints (`API_SPEC.md` §0), validation is UX-only.
- **Networking layer**: Retrofit + OkHttp (or Ktor client — implementer's choice, not decided
  here) with a JWT bearer-auth `Interceptor`, typed `kotlinx.serialization` request/response
  models mirroring `packages/types`/`packages/validation` field-for-field, same manual-sync
  caveat as iOS §7.
- **Session state**: a single `AuthRepository` (exposed as `StateFlow<AuthState>` via Hilt/Koin
  DI — implementer's choice of DI framework, not decided here) holding the current Supabase
  session, portal mode, and enabled portal list — same conceptual mirror of
  `resolvePortalSession()` as iOS.
- **Dependency injection**: not prescribed to a specific framework in this document (Hilt is the
  Android-ecosystem default and a reasonable choice, but this is an implementation detail, not an
  architecture decision this spec needs to lock in).

## 7. Offline behaviour (Android specifics for `MOBILE_ARCHITECTURE_DECISION.md` §9)

- Read-through cache: Room database (a single `CachedResponse` entity keyed by endpoint+params, or
  per-entity cached tables — implementer's choice) or `DataStore` for simpler key-value cases.
  Same "Showing cached data from [time]" banner rule as iOS, same set of covered screens
  (Dashboard/Properties/Leases/Documents views).
- Maintenance ticket offline queue: a Room-backed `PendingMaintenanceTicket` entity, retried via
  `WorkManager` (`MOBILE_ARCHITECTURE_DECISION.md` §7's already-specified mechanism) with a
  unique periodic or expedited one-time work request on connectivity regain
  (`NetworkType.CONNECTED` constraint). Same persistent "1 request pending upload" banner rule.
- All other writes require connectivity — same disabled-button-with-inline-reason UX as iOS,
  `WorkManager`'s `NetworkType` constraint is not used to silently queue these (explicit V1
  boundary, unchanged from `MOBILE_ARCHITECTURE_DECISION.md` §9).

## 8. Accessibility

- `Modifier.semantics { contentDescription = ... }` on every interactive/icon-only element — same
  "never rely on inferred labels" rule as iOS.
- TalkBack (Android's VoiceOver-equivalent) reading order follows visual layout order; grouped
  KPI-card content merges via `Modifier.semantics(mergeDescendants = true)`, the direct Compose
  equivalent of iOS's `.accessibilityElement(children: .combine)`.
- Font scale: respects system font-scale setting via `sp` units throughout (never `dp` for text,
  restated from §5) — tested at the largest accessibility font-scale setting once buildable.
- Contrast: WCAG AA minimum, same target and same re-verification requirement as iOS/web.
- `Modifier.clearAndSetSemantics` used to collapse decorative icons that shouldn't get their own
  TalkBack stop (e.g. a status badge's icon, when the badge's text already carries the full label).
- Reduce Motion: respects the system "Remove animations" accessibility setting via
  `LocalInspectionMode`/`Settings.Global.ANIMATOR_DURATION_SCALE` awareness — animations in §9
  degrade to instant cuts.

## 9. Animations

Same duration tokens as iOS (`fast 120ms, base 200ms, slow 320ms`, sourced from
`packages/ui/src/tokens.ts` via §15's shared format).

- Navigation transitions: Compose Navigation's default shared-axis/fade-through transitions (M3
  motion spec) — not overridden with custom transitions, same "don't fight the platform default"
  principle as iOS §10.
- Bottom sheet presentation (AI Assistant, confirm dialogs): Compose's default `ModalBottomSheet`
  slide-up, `base` duration for internal content fades.
- List item insertion/removal (maintenance board column moves): `animateItemPlacement()` modifier
  on `LazyColumn` items, `base` duration.
- Skeleton→content: `slow` duration crossfade via `AnimatedContent`.
- Success/error feedback: `fast` duration, paired with haptic feedback (`HapticFeedbackType.Confirm`/
  `.Reject` via `LocalHapticFeedback`) on the same state-changing confirmations as iOS §6.

## 10. Notifications

- **Transport**: Firebase Cloud Messaging (or an equivalent push provider — FCM is the
  Android-ecosystem default, `MOBILE_ARCHITECTURE_DECISION.md` §7 already names it). Same 16-value
  `WHATSAPP_NOTIFICATION_TYPES` category mapping as iOS §11 — one server-side dispatch decision,
  multiple channel fan-out, no Android-only notification taxonomy invented here.
- **Notification channels** (Android's required grouping mechanism, no iOS equivalent): one
  `NotificationChannel` per severity tier (urgent/warning/info, reusing `PortfolioInsightSeverity`'s
  tiers conceptually as iOS does), each with its own importance level
  (`IMPORTANCE_HIGH`/`DEFAULT`/`LOW`) — urgent-tier types get heads-up notification behavior,
  informational ones don't interrupt.
- **Actions**: `NotificationCompat.Action`s on applicable categories, same
  approve/view examples as iOS §11.
- **Permission request** (Android 13+ `POST_NOTIFICATIONS` runtime permission): same
  contextual-timing rule as iOS — never at first launch, requested the first time a screen that
  benefits from it is reached.
- **Badge count**: Android's notification-dot/badge mechanism is launcher-dependent (no universal
  numeric badge API the way iOS has); where the launcher supports it, synced the same way as iOS
  (unread `notifications` count, foreground/background transition + silent push trigger).

## 11. Deep links

- **App Links** (`https://app.propertyvault.example/...`, same domain-TBD caveat as iOS), verified
  via Digital Asset Links (`assetlinks.json`) — Android's App Links require this server-side file
  for auto-verification, a real implementation prerequisite worth flagging now even though domain
  selection isn't decided here.
- Same path-to-screen mapping as iOS §12 (native screens only, Super Admin excluded).
- Same notification-tap deep-link resolution via `related_entity_type`/`related_entity_id`,
  routed through a central `DeepLinkHandler` that navigates the correct nested `NavHost`
  destination, switching bottom-nav tabs first if needed.
- Same unauthenticated-deep-link-held-through-sign-in behavior as iOS.

## 12. Biometric authentication

- `BiometricPrompt` (AndroidX Biometric library) — fingerprint/face unlock gate on app
  foreground-from-background, configurable in Settings, same UX trigger point as iOS §13.
- Session token stored via `EncryptedSharedPreferences` or `DataStore` with a Keystore-backed
  encryption key (`MOBILE_ARCHITECTURE_DECISION.md` §7's already-specified mechanism) — the
  direct Android equivalent of iOS's Keychain, same "device-only, never synced" property (Android
  Keystore keys are hardware-backed and non-exportable by design, achieving the same guarantee
  Keychain's `ThisDeviceOnly` flag gives iOS).
- Fallback: device PIN/pattern/password via `BiometricPrompt`'s own
  `setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)` — same "use the system
  fallback, don't build a custom PIN" rule as iOS.
- Same client-side-only scope — biometric lock never substitutes for or extends the JWT session's
  own expiry/refresh cycle.

## 13. Tablet / foldable behaviour

- **Adaptive navigation via M3's three-tier pattern** (§5): `NavigationBar` (compact width, phone)
  → `NavigationRail` (medium width, small tablet/unfolded inner-display) → permanent
  `NavigationDrawer` (expanded width, large tablet/landscape) — driven by
  `WindowSizeClass` (AndroidX `material3-window-size-class`), Android's own official adaptive
  breakpoint API, not a bespoke scheme.
- List-detail: `ListDetailPaneScaffold` (Material 3 adaptive library) on medium/expanded width —
  the direct Compose equivalent of iOS's `NavigationSplitView`, same simultaneous list+detail
  visibility goal, same "feels like the platform's own idiom, not a stretched phone layout" rule.
- Foldables: `WindowSizeClass` combined with `FoldingFeature` awareness (Jetpack WindowManager) —
  a maintenance-ticket form or the AI Assistant sheet should not visually straddle a fold's hinge;
  content reflows to one pane when a hinge bisects the content area.
- Forms: same max-width-constrained-column rule on expanded width as iOS §14 (never edge-to-edge
  on a tablet).
- Keyboard/mouse support (Chromebook, tablet with a keyboard case — a real Android form factor
  unlike iPad's more uniform hardware story): standard Compose focus-navigation and hover-state
  support, no custom keyboard-shortcut scheme specified here beyond what Compose provides by
  default — lower priority than the equivalent iOS ⌘K/⌘N shortcuts given Android's more varied
  and less keyboard-centric large-screen usage pattern.

## 14. Shared design-token format

Identical mechanism to `NATIVE_IOS_SPEC.md` §15: a build-time JSON export of
`packages/ui/src/tokens.ts`, consumed here as generated Kotlin `object`s (a `Tokens.kt` mirroring
`colorLight`/`colorDark`/`spacing`/`radii`/`typeScale`/`motionDuration`/`iconSize`/`elevation`,
plus a generated M3 `ColorScheme` per §5's "no dynamic colour" decision) via a Gradle code-gen
task or pre-build script — same singular source-of-truth requirement, same "not yet written, real
small implementation task" status as the iOS side.
