# Handoff: Proplyst Mobile — direction 1b "Navy Deck" + Authentication & biometric unlock

## Overview
Mobile companion app for Proplyst (property management, South Africa, ZAR). Two personas: **Owner** (portfolio, properties, activity) and **Tenant** (rent, requests, documents). This package contains the approved visual direction (1b Navy Deck) with four core screens, plus the complete authentication and biometric-unlock state set for iOS and Android.

## About the design files
Everything in this bundle is a **design reference built in HTML** (`*.dc.html`). They are prototypes that show intended look and behaviour — not production code. The task is to **recreate these screens in the target codebase**: SwiftUI for iOS, Jetpack Compose for Android, using each platform's native components and the existing Proplyst backend/auth. Do not ship the HTML.

Open any `.dc.html` in a browser to see it. `Proplyst Auth States.dc.html` and `Proplyst Mobile Directions.dc.html` are overview canvases (they load the screen files inside phone frames). The individual screens are the source of truth; read their inline styles for exact values.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and copy are final. Recreate 1:1 with native components. Platform differences are intentional and listed below.

## Files
- `B-Login.dc.html` — Login (superseded by B-Auth; kept for reference)
- `B-OwnerHome.dc.html` — Owner Home
- `B-Properties.dc.html` — Properties list
- `B-TenantHome.dc.html` — Tenant Home
- `B-Auth.dc.html` — complete auth state machine (19 states, platform-aware). Props: `platform` ios|android, `biometric` faceid|touchid, `bioAvailability` available|unavailable|notEnrolled, `screen` (state id).
- `Proplyst Auth States.dc.html` — spec canvas: flow rules, implementation hooks, tappable phone, all states in frames
- `Proplyst Mobile Directions.dc.html` — design-system summary + the three explored directions (1a/1c are not approved)
- `assets/` — logo mark, wordmark, full logo, property photos (cropped from the web app)
- `frames/` — phone bezel components used only for presentation; ignore

## Design tokens
Colors
- Primary blue `#1B6BF2` · pressed/deep `#0B3FA8` · light blue on navy `#5EA2FF` · blue tint `#E8F0FE`
- Navy (dark surfaces, headers) `#0B1220` · Navy text `#0F1B2D`
- Canvas `#F3F5F9` · Surface `#FFFFFF` · Border `#E5E9F0` · Divider `#EEF1F5`
- Text primary `#0F1B2D` · secondary `#5B6B7F` · tertiary `#98A2B3` · on-navy secondary `#8FA3C2` · on-navy tertiary `#B7C6E0`
- Success `#16A34A` (bg `#DCFCE7`, text `#15803D`) · Warning `#D97706`/`#B45309` (bg `#FEF3C7`) · Critical `#DC2626`/`#B91C1C` (bg `#FEE2E2`/`#FEF2F2`, border `#FECACA`) · Network amber bg `#FFF7ED`, border `#FED7AA`, text `#9A3412`
- Navy header glow: radial gradient `rgba(27,107,242,.4) → 0`, 340px circle, top-right, offset (-140, -100)

Typography — Plus Jakarta Sans (iOS may fall back to SF Pro, Android to Roboto for body). Weights 400/500/600/700/800.
- Display money 44/800, letter-spacing −1.4 · Screen title 26–28/800, −0.5 · Section 17/700 · Card title 15–18/600–700 · Body 14–15/400 · Caption 12–13/400–600 · Micro label 10–11/600–700 uppercase, +0.5 tracking

Shape & spacing (4-pt grid)
- Page gutter 20 · Vertical rhythm 12 / 16 / 24
- Radii: inputs & buttons 14 · cards 16–18 · hero/photo cards 20 · sheets 28 (top corners) · pills 999
- Cards on canvas: white, no border, shadow `0 1px 2px rgba(15,27,45,.04)`; floating card over navy: `0 8px 24px rgba(11,18,32,.10)`
- Hit targets ≥ 44 pt. Primary button 54 h, secondary 50 h.

## Screens

### Owner Home (`B-OwnerHome`)
- Navy header (`#0B1220`) with glow; logo mark 26 h + "Proplyst" 16/700 (the "lyst" in `#5EA2FF`); bell (40 circle, 1px `rgba(255,255,255,.14)` border, unread dot `#5EA2FF`) and avatar (40 circle `#1B6BF2`, initials 13/700). Header padding-bottom 64.
- Greeting 14 `#8FA3C2`; "Collected in September" 13; amount 44/800; progress bar 6 h `rgba(255,255,255,.14)` track, `#5EA2FF` fill, % 13/700; billed / outstanding line 13 (outstanding in `#FDBA74`).
- KPI strip: white card overlapping header by −44, radius 18, 4 columns divided by 1px `#EEF1F5`; value 20/800, label 11 `#5B6B7F`.
- Needs attention: section title 17/700 + count pill (navy, 12/700). Rows: white card radius 16, 4×36 severity bar (Critical `#DC2626`, High `#D97706`, Medium `#1B6BF2`), title 15/600, context 13, severity label 11/700 uppercase in same colour.
- Recent activity: white card, rows 34×34 tinted glyph square radius 10, title 14/600, sub 12, time 12 `#98A2B3`.
- Top properties: horizontal scroll, 170×120 photo tiles radius 16, gradient `rgba(11,18,32,0) 40% → .85`, name 13/700 white, income 12 `#B7C6E0`.
- Bottom nav: Home · Properties · Activity · More. iOS: translucent bar `rgba(255,255,255,.94)` blur, 1px top border, icon 24 + 11/600 label, active `#1B6BF2`. Android: Material 3 nav bar, active icon in 60×32 pill `#E8F0FE`, label 12/600.

### Properties (`B-Properties`)
- Navy header: title 26/800, count 13 `#8FA3C2`; search field 44 h radius 14 `rgba(255,255,255,.08)` with `.12` border; filter chips 32 h pill (All / Residential / Commercial / Land): active white bg navy text, inactive transparent, `rgba(255,255,255,.2)` border, `#B7C6E0` text.
- Property card: 230 h, radius 20, full-bleed photo, gradient overlay `.15 → .05 @35% → .92`, shadow `0 6px 18px rgba(11,18,32,.14)`. Type chip top-left (frosted `rgba(255,255,255,.16)` + blur), status chip top-right (Active green / Attention amber). Bottom: name 18/700, address 12 `#B7C6E0`, three stats (Collected, Expected, "n units / % let") label 10/600 uppercase `#8FA3C2`, value 15/700; occupancy bar 4 h `#5EA2FF`.
- No photo fallback: diagonal navy stripes `#0F1B2D`/`#152540` 12px with building glyph `#3B6FD9`.

### Tenant Home (`B-TenantHome`)
- Navy header: greeting + unit; "Rent due 1 October" 13; amount 44/800; status line.
- Floating action card overlapping −48: "Report payment" primary (state toggles to "Payment reported ✓" with `#E8F0FE` bg / blue text) + 50×50 invoice icon button.
- Two stat cards (Lease progress with 5 h bar; Last payment with green "Confirmed" line).
- My requests rows (44 thumbnail radius 12, status pill In progress blue / Completed green). Notices & documents.
- Nav: Home · Payments · Requests · Profile.

## Authentication & biometric unlock (`B-Auth`)

### Rules
1. Biometrics never authenticate against the server. First login is always email+password or an OAuth provider → server session.
2. After the first successful session, offer biometric unlock once. Enabling stores a per-device flag; the session token lives in Keychain (iOS) / EncryptedSharedPreferences or Keystore (Android).
3. Returning user with a valid session → lock screen → device biometric prompt → app. "Use password instead" is always available.
4. If token refresh fails, skip the lock screen and show the sign-in screen with the expired banner and email prefilled. Keep the biometric preference.
5. Sign out clears the session and turns biometric unlock off for the device; next launch shows plain sign-in with a "You've been signed out" toast.
6. Provider buttons: Google on both; Apple on iOS only. Face ID / Touch ID label and glyph follow `LAContext.biometryType`; Android always says "Fingerprint" and uses the system BiometricPrompt sheet.

### States (ids match the `screen` prop)
Shared: `signin`, `signin-loading`, `signin-invalid`, `signin-network`, `forgot`, `forgot-sent`, `oauth-loading`
Biometric: `bio-offer`, `bio-prompt`, `settings-enabled`, `settings-unavailable`, `settings-notenrolled`, `lock`, `lock-prompt`, `lock-failed`
Session: `signin-returning`, `signin-expired`, `logout-confirm`, `signin-loggedout`

### Sign-in screen layout
- Navy top with glow; logo mark 64×70; title 28/800 ("Welcome to Proplyst" / "Welcome back" / "Session expired"); subtitle 14 `#8FA3C2`.
- White sheet, top radius 28, padding 22/24/30, gap 10.
- Inputs 50 h, radius 14, bg `#F6F8FB`, 1px `#E5E9F0`, text 15; focus: blue border + `0 0 0 3px #E8F0FE`. Password has a 40×40 visibility toggle. Labels 13/600 `#3A4A5E`.
- Banners (above actions): expired = blue tint `#E8F0FE`/`#0B3FA8` with clock icon; invalid = `#FEF2F2` bg, `#FECACA` border, `#B91C1C` text, password border `#FCA5A5`; network = `#FFF7ED`/`#FED7AA`/`#9A3412` with underlined "Retry".
- "Forgot password?" 13/600 blue, right-aligned.
- Primary "Sign in" 54 h radius 14 `#1B6BF2`, 16/700. Disabled (empty field): opacity .45, not tappable. Loading: 18 px spinner (2.5 px ring, `rgba(255,255,255,.4)` / white), label "Signing in…", inputs and provider buttons disabled.
- Divider "or continue with" 12 `#98A2B3`.
- "Continue with Google" 50 h white, 1px border, G mark. iOS only: "Continue with Apple" 50 h black, white Apple glyph.
- Returning user (session exists): divider then row with "Returning user" 12 + email 13/600 and a 40 h pill button "Unlock with Face ID/Touch ID/Fingerprint" (`#F6F8FB`, blue glyph). No session: helper text 12 `#98A2B3` explaining biometric unlock can be enabled after sign-in.
- Toast (signed out): `rgba(255,255,255,.1)` pill above the logo, check icon `#5EA2FF`, 13/600.

### Forgot / sent
Navy screen with back button; title "Reset your password"; white sheet with email + "Send reset link" + "Back to sign in". Sent state: envelope in 84 circle `rgba(27,107,242,.18)`, "Check your email", neutral copy that does not confirm account existence, "Back to sign in" (outlined) and "Didn't get it? Resend".

### OAuth hand-off
Full navy, logo, 28 px spinner (`#5EA2FF` arc), "Continuing with Google/Apple…" 20/700, explanatory 14, "Cancel" link.

### Biometric offer (once, after first login)
"Signed in" pill top-right (`rgba(27,107,242,.18)`/`#5EA2FF`). 112×112 radius 32 tinted square with 56 px glyph; "Unlock faster next time" 26/800; body explains Face ID only unlocks the app. Buttons: "Enable Face ID" primary with glyph, "Not now" text button, footnote "You can change this any time in Settings › Security."

### System prompt (mock — use the real OS UI)
iOS: dimmed blur, 150×150 dark card radius 28 with pulsing glyph + "Face ID", Cancel pill. Android: bottom sheet radius 28, "Proplyst" 12, "Unlock Proplyst" 20/600, "Use your fingerprint to continue", blue fingerprint 56, actions "Use password" (negative button) and "Cancel".

### Settings › Security
Navy header (back, "Settings" 12, "Security" 22/800). Card: row with 40 tinted glyph square, "Face ID unlock" 15/600, status 12, 50×30 switch (on `#1B6BF2`, off `#D1D8E0`, disabled 50% opacity). Status copy:
- enabled: "Unlocks Proplyst on this iPhone/phone." + toast "Face ID unlock is on"
- off: "Off. Use your password each time."
- unavailable (`biometryNotAvailable` / `BIOMETRIC_ERROR_NO_HARDWARE`): "This device doesn't support biometric unlock." switch disabled
- not enrolled (`biometryNotEnrolled` / `BIOMETRIC_ERROR_NONE_ENROLLED`): "Face ID is not set up on this device." + extra row "Set up Face ID on this device first." → "Open Settings" / "Open device settings"
Footer 12 `#98A2B3`: "unlocks the app on this device only. Your Proplyst session still expires and will ask for your password."
Account card: avatar + name + email·role; "Lock Proplyst now" (disabled 45% when biometric off); "Sign out" in `#B91C1C`. (The "Session · tap to simulate expiry" row is a prototype control, do not ship.)

### Lock screen (returning user)
Full navy; wordmark (white) centered top; 120×120 radius 36 glyph button `rgba(27,107,242,.18)` / `#5EA2FF`; "Welcome back, Mohammed" 26/800; email + "Face ID keeps you signed in on this device." 14. Buttons: "Unlock with Face ID" primary with glyph, "Use password instead" outlined `rgba(255,255,255,.18)`, footer "Not Mohammed? Sign out" 12.
Failed/cancelled: glyph tint `rgba(220,38,38,.18)` / `#FCA5A5`, title "Face ID didn't recognise you", sub "Try again, or use your password to continue.", primary "Try again". Repeated-failure lockout follows the OS.

### Logout confirmation
Bottom sheet over Security (scrim `rgba(11,18,32,.55)`): grab handle, "Sign out of Proplyst?" 20/800, body "You'll need your password next time. Face ID unlock on this device will be turned off.", "Sign out" 52 h `#DC2626`, "Cancel" outlined.

## Interactions & state (prototype behaviour to mirror)
- Sign in: disabled until both fields filled → loading (~1.3 s in the prototype) → success / invalid / network. Editing a field clears invalid/network banners.
- Success → `bio-offer` if biometric not yet enabled, otherwise straight to app.
- Enable → system prompt → on success `settings-enabled` with toast; cancel returns to offer.
- Lock → prompt → success opens app; cancel/failure → `lock-failed`; "Use password" → `signin-returning`.
- Expired → `signin-expired` (hasSession false, biometric flag retained).
- Sign out → confirm → `signin-loggedout` (session and biometric flag cleared).
State variables: `screen`, `email`, `password`, `showPassword`, `hasSession`, `biometricEnabled`, `biometricAvailability`, `prompting`, `showLogoutSheet`, `toast`, `oauthProvider`.

## Platform notes
- iOS (SwiftUI): LocalAuthentication `LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`; `biometryType` → label/glyph; `LAError` cases map to states. AuthenticationServices for Sign in with Apple. Tab bar translucent. Status bar spacer 54 pt in the prototype.
- Android (Compose): `BiometricManager.canAuthenticate(BIOMETRIC_STRONG)`; `BiometricPrompt` with `setNegativeButtonText("Use password")`. Credential Manager for Google. Material 3 NavigationBar with active pill. No Apple button.
- Do not invent OAuth client IDs, Apple team IDs, signing keys or Firebase settings — none are specified here.

## Assets
`assets/logo-mark.png`, `assets/logo-wordmark.png` (dark wordmark; invert for navy backgrounds), `assets/logo-full.png`, `assets/logo-dark.png`; property photos `assets/prop-edendale.png`, `prop-northdale.png`, `prop-salta.png` (cropped from the Proplyst web app screenshots — replace with real property images from the API). Icons are 24 px stroke icons (1.9–2 px, round caps); use SF Symbols / Material Symbols equivalents.
