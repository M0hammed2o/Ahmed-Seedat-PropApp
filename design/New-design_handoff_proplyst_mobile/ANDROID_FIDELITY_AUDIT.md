# Android fidelity audit — Proplyst Mobile (1b Navy Deck)

Audited: `apps/android/app/src/main/java/za/co/proplyst/app/ui/**` at `M0hammed2o/Ahmed-Seedat-PropApp@main` (2 Sep 2026).
Source of truth: `B-Auth.dc.html`, `B-OwnerHome.dc.html`, `B-Properties.dc.html`, `B-TenantHome.dc.html`, `Proplyst Auth States.dc.html`, `README.md`, `assets/`.
Intentional deviation kept: **floating white pill bottom nav** (Owner: Home | Properties | Activity | More · Tenant: Home | Payments | Requests | Profile).

Scope: visual only. No changes to repositories, APIs, auth/session security, biometric architecture, data layers, deep links, migrations or iOS.

Verdict in one line: tokens (`Color.kt`, `Shape.kt`) are faithful; the screens are structurally right but read as "Material 3 with Proplyst colours" rather than the design. The gap is typography, component shape, sizing, and missing brand assets — all correctable without touching behaviour.

Format for every finding: **CURRENT ANDROID → APPROVED DESIGN → REQUIRED CHANGE.**

---

## 0. Global (fix these first — they resolve ~half the per-screen gaps)

### 0.1 Typeface
- CURRENT ANDROID: `ProplystFontFamily = FontFamily.Default` (Roboto). Weight 800 ("ExtraBold") collapses to Bold in Roboto.
- APPROVED DESIGN: Plus Jakarta Sans 400/500/600/700/800 everywhere.
- REQUIRED CHANGE: bundle Plus Jakarta Sans (OFL) in `res/font/` (`plus_jakarta_sans_regular/medium/semibold/bold/extrabold.ttf`), set `ProplystFontFamily = FontFamily(Font(...))`. One-line change in `Type.kt`; the whole app follows.

### 0.2 Type scale (`Type.kt`)
- CURRENT: `cardTitle` 17/SemiBold; `caption` 13/Normal; `statusLabel` 11 Bold +0.5; `greeting` 14 Medium; `bodySmall` 14. Several screens override sizes inline (`copy(fontSize = 13.sp)`).
- APPROVED: see §8 table.
- REQUIRED: add tokens `pageTitle 26/800/−0.5`, `cardTitle 15/600`, `cardTitleLarge 18/700/−0.2`, `caption 12/400`, `microLabel 10/600 uppercase +0.5`, `chipLabel 11/700`, `button 16/700`, `buttonSecondary 15/600`. Remove inline `.copy(fontSize=…)` overrides.

### 0.3 Brand assets
- CURRENT: only `proplyst_logo_mark.png`. Wordmark is faked with two `Text("Prop")`+`Text("lyst")`.
- APPROVED: header uses **mark 26 dp + "Proplyst" 16/700** (the "lyst" in `#5EA2FF` is the design's own text wordmark — acceptable) on Owner/Tenant Home; **`logo-wordmark.png` (white, 20 dp tall)** centred on the lock screen.
- REQUIRED: copy `assets/logo-wordmark.png` → `drawable-nodpi/proplyst_wordmark.png`. Add the 26 dp mark before the text wordmark on both Home headers. Use the image wordmark on the lock screen.

### 0.4 Navy header glow
- CURRENT: `radialGradient(center = Offset(900f,-100f), radius 700f)` in raw px — position drifts with density/width.
- APPROVED: 340 dp circle, centre at top-right offset (−100 dp x, −140 dp y from the header's top-right), `rgba(27,107,242,.40) → 0` (login: 360 dp, .35).
- REQUIRED: compute centre from the drawn size (`drawBehind { … size.width + 100.dp.toPx() … }`) and radius `170.dp.toPx()`.

### 0.5 Card elevation
- CURRENT: `shadowElevation = 1.dp` (list cards), `3.dp` (KPI/action card), `12.dp` (nav).
- APPROVED: list cards `0 1px 2px rgba(15,27,45,.04)` (≈ **0.5–1 dp, very soft**); cards overlapping the navy header `0 8px 24px rgba(11,18,32,.10)` (≈ **8 dp**); photo cards `0 6px 18px rgba(11,18,32,.14)` (≈ **6 dp**); floating nav `0 12px 32px rgba(15,27,45,.28)` (12 dp is right).
- REQUIRED: list cards 1 dp with `ambientColor/spotColor = Navy.copy(alpha=.10)`; overlap cards 8 dp; photo cards 6 dp.

### 0.6 Text fields
- CURRENT: `OutlinedTextField` 56 dp, Material label/indicator behaviour.
- APPROVED: **50 dp** (login) / 44 dp (search), radius 14, bg `#F6F8FB`, 1 px `#E5E9F0`, text 15, no floating label; focus = blue border + 3 dp `#E8F0FE` halo; external label 13/600 `#3A4A5E` 6 dp above.
- REQUIRED: replace with `BasicTextField` inside a `Surface(shape = 14.dp, border, color = inputSurface)` sized 50 dp; draw the focus halo with `Modifier.border(3.dp, blueTint)` when focused. Keep the trailing 40×40 visibility toggle.

---

## 1. LOGIN (`SignInScreen.kt`)

| Item | CURRENT ANDROID | APPROVED DESIGN | REQUIRED CHANGE |
|---|---|---|---|
| Logo size | mark 64 dp, centred | mark **64×70 dp, left-aligned** (`B-Auth`), 84×92 on legacy `B-Login` | Left-align in a column with 24 dp side padding |
| Logo placement | Top of header, 24 dp below status bar | Hero is bottom-anchored: header takes the free space, content sits at the **bottom** of the navy area, 20 dp above the sheet | Wrap hero in `Column(Modifier.weight(1f), verticalArrangement = Bottom)`; sheet follows; whole screen `fillMaxHeight` (scroll only when keyboard shows) |
| Welcome hierarchy | 28/800 centred | 28/800 **left-aligned**, letter-spacing −0.6, line-height 1.15, 16 dp below logo | Left-align; use `screenTitle` |
| Tagline | 15 body, 4 dp below | **14** `#8FA3C2`, 6 dp below | `bodySmall`, top 6 dp |
| Navy hero height | ~content height (≈ 190 dp) | ≈ **38–42 % of screen** (fills remaining height above sheet) | Weight-based layout as above |
| Form sheet | `Surface` radius 28 top, padding 22 h / 26 v | radius **28** top, padding **22 top / 24 sides / 30 bottom**, gap 10 between rows | Adjust padding; use `Arrangement.spacedBy(10.dp)` |
| Inputs | Outlined 56 dp | 50 dp, see §0.6 | §0.6 |
| Error banner | Above fields, 12 dp padding, no icon/dot | **Below password, above "Forgot password?"**; radius 12; 10×12 padding; invalid = 8 dp red dot + text; network = wifi-off icon + text + underlined **Retry** | Move banner; add dot/icon; add Retry action for network kind. Also tint the password border `#FCA5A5` on invalid |
| Forgot password | 13/600, right | 13/600 right, **no extra 4 dp padding jitter** | Keep; height 20 |
| Sign in button | 54 dp, radius 14, `enabled = !isSubmitting` | 54 dp, radius 14, **disabled at 45 % opacity while either field is empty**; loading shows 18 dp spinner (2.5 dp stroke, `rgba(255,255,255,.4)` track) + "Signing in…" | Add `enabled = fieldsFilled && !isSubmitting`, `disabledContainerColor = primary.copy(alpha=.45)`, `disabledContentColor = White` |
| Divider | 18 dp above/below | **2 dp above**, part of the 10 dp rhythm; text 12 `#98A2B3` | Reduce spacing |
| Google button | OutlinedButton 50 dp, "G" text glyph | 50 dp, white, 1 px `#E5E9F0`, radius 14, **20 dp circular G badge** (1 px border, blue "G" 12/800) + "Continue with Google" 15/600 `#0F1B2D` | Draw the 20 dp badge; remove Material outlined ripple colour |
| Config note | Grey caption below Google | Not in design | Keep (honest boundary) but style as 12 `#98A2B3` centred |
| Returning-user biometric | **Absent** | When a session exists: 1 px `#EEF1F5` divider, row: "Returning user" 12 `#98A2B3` / email 13/600, right: **40 dp pill** `#F6F8FB` 1 px border, blue fingerprint glyph 20 + "Unlock with Fingerprint" 13/700 | Add row when `BiometricLockPreferences.enabled && session != null`. No session: centred helper 12 `#98A2B3` "After you sign in, you can turn on Fingerprint to unlock Proplyst faster on this device." |
| Expired session | Generic error banner | Blue banner `#E8F0FE`/`#0B3FA8`, clock icon, "**Your session expired.** Sign in again to continue. Fingerprint unlock stays on for this device." + title "Session expired", subtitle "For your security, please sign in again." | Add `SignInErrorKind.SESSION_EXPIRED` visual (wiring already exists via `TokenAuthenticator` → sign-out) |
| Signed-out toast | Absent | Pill toast at top of hero: `rgba(255,255,255,.10)` bg, 1 px `.14` border, radius 12, check icon `#5EA2FF`, "You've been signed out" 13/600 | Show when arriving from sign-out |
| Forgot-password | Title centred, sheet with 84 dp circle in white | Title **left**, subtitle "Enter the email on your account and we'll send a reset link." 14 `#8FA3C2`; sent state is a **full-navy centred screen** (84 dp circle `rgba(27,107,242,.18)`, "Check your email" 26/800 white, body 14 `#8FA3C2`, outlined button `rgba(255,255,255,.08)` + "Didn't get it? Resend" 13/600 `#5EA2FF`) | Restyle both states |
| Vertical spacing | 14–18 dp mixed | 10 dp rhythm inside sheet; 22 dp hero→sheet | Apply |

---

## 2. OWNER HOME (`DashboardScreen.kt`)

| Item | CURRENT ANDROID | APPROVED DESIGN | REQUIRED CHANGE |
|---|---|---|---|
| Logo + wordmark | Text "Prop"+"lyst" only | **Mark 26 dp** + "Prop**lyst**" 16/700 (lyst `#5EA2FF`), 8 dp gap | Add mark image |
| Bell | 40 dp circle `.08` white, no border, no dot | 40 dp circle, bg `.06`, **1 px border `rgba(255,255,255,.14)`**, 20 dp outline bell (1.8 stroke), **unread dot 9 dp `#5EA2FF` with 2 dp navy ring** at top-right | Add border + dot (dot bound to unread count > 0) |
| Avatar | **Absent** | 40 dp circle `#1B6BF2`, initials 13/700 white, 8 dp right of bell | Add; initials from profile name |
| Greeting | "Good evening" 14 Medium `#8FA3C2` | "Good evening, **Mohammed**" 14/400 `#8FA3C2` | Append first name |
| Month label | "Collected in September" 13 `#B7C6E0` | "Collected in September" **13 `#8FA3C2`**, 2 dp below greeting | Colour + spacing |
| Financial hero | 44/800 (Roboto Bold), top 2 dp | **44/800 Plus Jakarta**, letter-spacing −1.4, line-height 1.05, **8 dp** below label | Font + spacing |
| Progress line | `LinearProgressIndicator` 6 dp, then % on next row | 6 dp track `.14`, fill `#5EA2FF`, **% 13/700 `#5EA2FF` inline to the right** (10 dp gap), row 14 dp below amount | Row(track weight 1, Text) |
| Billed / outstanding | One row, "94% of R21,200 billed" / "Outstanding R1,200" | Separate row 10 dp below: "Billed **R 21,200**" · "Outstanding **R 1,200**" — label 13 `#8FA3C2`, values 600 (white / `#FDBA74`), 18 dp gap. Note the **space after R** (`R 20,000`) | Reformat; update `formatCurrency` call sites to `"R ${…}"` |
| Header padding | bottom 44 dp; top 20 | bottom **64 dp**, top 10 dp below status bar, sides 20 | Adjust |
| KPI overlap card | offset −44, radius 18, elevation 3, values `titleLarge` ExtraBold, labels 13 | offset **−44** ✓, radius 18 ✓, **elevation 8 (soft navy)**, padding 14 v / 6 h; values **20/800 −0.5**, labels **11 `#5B6B7F`** 3 dp below; 1 px `#EEF1F5` dividers full row height; "Open jobs" value in `#D97706` when > 0 | Sizes, elevation, warning colour. Order: Occupancy · Properties · Open jobs · Expiring |
| Needs attention header | Title + count pill inline | Title 17/700 **left**, count pill **right-aligned** (navy, 12/700, 3×9 padding) via `SpaceBetween` | Layout |
| Severity rails | 4×36 bar ✓, colours ✓ | ✓ plus row padding **14 v / 16 h**, radius 16, elevation 1 soft | Padding |
| Row text | message 15 body (2 lines) + label below | **Title 15/600 (1 line)** + context 13 `#5B6B7F` below; severity label **11/700 uppercase +0.3 right-aligned in rail colour** | Split `insight.message` into title/context if the DTO has both; otherwise title = message, context = property name; move label to trailing |
| Recent activity | 34 dp bell icon square for every row | 34 dp glyph square radius 10 with **semantic tint + glyph**: payment `#DCFCE7`/`#15803D`; invoice `#E8F0FE`/`#1B6BF2`; maintenance `#FEF3C7`/`#B45309`; lease `#DCFCE7`/`#15803D`; **time 12 `#98A2B3` trailing** | Map `AppNotification.type` → tint/glyph; add relative time |
| Activity row text | title 14/600, body 13 | title **14/600**, sub **12 `#5B6B7F`**; 12 v padding; 1 px `#EEF1F5` dividers; card padding 4 v / 16 h | Adjust |
| Top properties | 170×120 tiles, name only | 170×120, radius 16, image opacity .9, gradient `transparent 40% → navy .85`; **name 13/700 + income 12 `#B7C6E0`** ("R 36,500 collected") at 12 h / 10 bottom | Add second line from `Property` extras |
| Section rhythm | 20 dp between sections | **24 dp** between sections, 12 dp title→card, 8 dp between attention rows | Adjust |
| Bottom spacer | 96 dp | 110 dp (clears 64 dp nav + 10 + inset) | 110 |

---

## 3. PROPERTIES (`PropertiesListScreen.kt`)

| Item | CURRENT ANDROID | APPROVED DESIGN | REQUIRED CHANGE |
|---|---|---|---|
| Navy header | title + count stacked | Title **26/800 left**, count **13 `#8FA3C2` right-aligned on the same baseline** | `Row(SpaceBetween, alignByBaseline)` |
| Header padding | top 20 / bottom 18 | top **10** (below status bar) / bottom **20**, sides 20 | Adjust |
| Search field | Outlined 56 dp | **44 dp**, radius 14, bg `rgba(255,255,255,.08)`, 1 px `.12` border, 18 dp search icon `#8FA3C2`, placeholder 14 `#8FA3C2`, 14 dp below title | §0.6 pattern, dark variant |
| Filter chips | 32 dp ✓, white/transparent ✓ | 32 dp, padding 0 14, **13/600**; inactive text `#B7C6E0`, border `.2`; active white bg `#0B1220` text; 12 dp below search | Font size only |
| Card size | 230 dp, radius 20 ✓ | ✓; **elevation 6 (`rgba(11,18,32,.14)`)**; 14 dp between cards | Add shadow (`Modifier.shadow(6.dp, shape, ambient/spot navy .14)`); spacing 14 |
| Gradient | `.15 → .05 @35% → navy .92` ✓ | ✓ | — |
| Type chip | `.18` white pill | `rgba(255,255,255,.16)` + **1 px `.2` border + blur** (blur optional on Android; keep border), 11/700, padding 5×10, 14 dp inset | Add border; inset 14 |
| Status chip | Active `#DCFCE7`/success; Archived grey | Active `#DCFCE7`/`#15803D`; **Attention `#FEF3C7`/`#B45309`** (when outstanding > 0 or vacancy alert); Archived `#EEF1F5`/`#98A2B3` | Add Attention mapping |
| Name | 18 Bold | **18/700 −0.2** | Token |
| Address | 13 `#B7C6E0` | **12 `#B7C6E0`**, 2 dp below | Size |
| Statistics | UNITS · OCCUPIED · LET | **Collected · Expected · "{n} units / {x}% let"** (last right-aligned). Micro-label 10/600 uppercase +0.5 `#8FA3C2`; value 15/700 white; 18 dp gaps; 12 dp above | Use collected/expected from card extras; fall back to Units/Let if amounts absent |
| Progress line | 4 dp ✓ | 4 dp, track `.2`, fill `#5EA2FF`, **10 dp** below stats | Spacing |
| No-photo fallback | `PropertyPhoto` default | Diagonal stripes `#0F1B2D`/`#152540` 12 dp + 56 dp building glyph `#3B6FD9` | Implement in `PropertyImage.kt` placeholder |
| Floating nav | — | Content padding bottom 110 dp so last card clears the pill | Spacer 110 |

---

## 4. MORE (`OwnerMoreScreen.kt`) — no dedicated mock; must follow the Navy Deck list pattern (Security settings in `B-Auth` is the reference)

| Item | CURRENT ANDROID | APPROVED PATTERN | REQUIRED CHANGE |
|---|---|---|---|
| Header | Navy, "More" 28/800, bottom 18 | Navy header; eyebrow **"Settings" 12 `#8FA3C2`** + title **22/800 −0.4**; bottom **22 dp**; glow per §0.4 | Add eyebrow, size |
| Account area | Absent on More (lives in AccountScreen) | **Account card first**: 40 dp avatar `#1B6BF2` initials, name 15/600, "email · Owner" 12 `#5B6B7F`; card overlaps header by **−12 dp**? No — in the design the card sits 16 dp below the header | Add account card at top; tapping → Account & security |
| Section hierarchy | 11/700 uppercase labels `#98A2B3` + individual cards per row | Rows **grouped into one white card per section** (radius 18, rows divided by 1 px `#EEF1F5`), section label 11/700 uppercase `#98A2B3` 8 dp above, 12 dp between cards | Group rows |
| Row | Surface radius 14, elevation 1, 36 dp icon square | Row padding **14 v / 16 h**; **40 dp** glyph square radius 12 `#E8F0FE` icon 20 dp `#1B6BF2`; title 15/600; description 12 `#5B6B7F`; chevron 16 dp `#98A2B3` | Sizes |
| Destructive | n/a | "Sign out" row text `#B91C1C` with icon in same colour, last row of Account card | Add (routes to existing sign-out confirm) |
| Icons | Filled Material icons | **Outlined** Material Symbols (stroke ≈ 2) | Switch to `Icons.Outlined.*` |
| Floating nav | — | bottom spacer 110 | Adjust |

---

## 5. TENANT HOME (`TenantHomeScreen.kt`)

| Item | CURRENT ANDROID | APPROVED DESIGN | REQUIRED CHANGE |
|---|---|---|---|
| Logo/header | Text wordmark only, bell `.08` no border | Mark 26 + wordmark; bell with border (no dot unless unread); **avatar 40 dp `#1B6BF2` initials** | As §2 |
| Greeting | "Hi there" + property·unit | "**Hi Lerato** · Unit AQ-101, Atlas Quarter" 14 `#8FA3C2` one line | Use first name; join |
| Rent hero | "Outstanding balance" 13 + amount 44 | "**Rent due 1 October**" 13 `#8FA3C2` 10 dp below greeting; amount **44/800** 6 dp below; status line 14 `#8FA3C2` 8 dp below ("Due in 29 days · no outstanding balance" / "Payment reported · awaiting confirmation") | Use invoice due date; add status line |
| Caught-up state | Green check + "You're all caught up" 22 | Design shows amount **R 0** with status "Up to date" — keep the amount slot stable | Show "R 0" 44/800 + status line |
| Header padding | bottom 48 | bottom **70**, top 10 | Adjust |
| Report payment card | offset −40, radius 18, elevation 3, padding 14 | offset **−48**, radius 18, **elevation 8**, padding 14; button 50 dp radius 12 "Report payment" 15/700; **50×50 white 1 px `#E5E9F0` invoice button** (outline receipt icon `#0F1B2D`) | Elevation, offset, icon button style |
| Reported state | — | After report: button bg `#E8F0FE`, text `#1B6BF2` "Payment reported ✓" | Bind to pending PaymentReport |
| Lease card | 14 padding, status text | padding **14 v / 16 h**; label 12 `#5B6B7F`; value **"9 / 12 mo"** 20/800 (unit 13/600 `#98A2B3`); bar 5 dp `#EEF1F5`/`#1B6BF2` 10 dp below | Compute months elapsed/total |
| Last payment | 16/600 amount | **20/800** amount; "Confirmed · 1 Sep" 12/600 `#15803D` 8 dp below | Sizes |
| Requests | Header "See all"; icon square 34 | Header "**New request**" 13/600 link; rows are **separate white cards** (radius 16, 8 dp gap): **44 dp thumbnail radius 12** (striped placeholder), title 15/600, date 12 `#98A2B3`, status pill 12/600 (In progress `#E8F0FE`/`#1B6BF2`, Completed `#DCFCE7`/`#15803D`) | Restyle |
| Notices | Generic preview list | Card radius 16: **36 dp navy square** radius 10 with `#5EA2FF` info icon; title 14/600; body 13 `#5B6B7F` | Restyle |
| Documents | Absent | Two 50 % buttons: white, radius 14, 12×14 padding, blue document icon 18, "Lease agreement" / "House rules" 13/600 | Add (routes to existing DocumentsListScreen) |
| Section rhythm | 16–20 | 16 dp after action card, **24** between sections, 12 title→card | Adjust |

---

## 6. AUTH / BIOMETRIC (`BiometricLockOverlay.kt`, `AccountScreen.kt`, `SignInScreen.kt`)

| State | CURRENT ANDROID | APPROVED DESIGN (`B-Auth`, platform=android) | REQUIRED CHANGE |
|---|---|---|---|
| Lock screen (returning user) | Canvas bg, Material lock icon, "Proplyst is locked" titleLarge, default `Button("Unlock")` | **Full navy `#0B1220`**; white wordmark 20 dp centred at top (16 dp below status bar); centred **120 dp radius-36 glyph tile** `rgba(27,107,242,.18)` with 56 dp fingerprint `#5EA2FF`; "Welcome back, {first name}" 26/800 white 26 dp below; email + "Fingerprint keeps you signed in on this device." 14 `#8FA3C2`; bottom: **"Unlock with Fingerprint"** 54 dp primary with 20 dp glyph, **"Use password instead"** 50 dp outlined `rgba(255,255,255,.18)` bg `.06`, footer "Not {name}? **Sign out**" 12 (`#5EA2FF` link); 24 dp side / 36 dp bottom padding | Rebuild overlay visuals; wire "Use password instead" → existing sign-out-to-sign-in path (session cleared, returning-user shortcut shown); "Sign out" → existing confirm |
| Failed / cancelled | Red error text under title | Glyph tile `rgba(220,38,38,.18)` / `#FCA5A5`; title "**Fingerprint didn't recognise you**"; sub "Try again, or use your password to continue."; primary label "**Try again**" | Map `BiometricResult.Failed/Cancelled` → this state |
| System prompt | Real `BiometricPrompt` ✓ | Real system sheet; **negative button "Use password"**, title "Unlock Proplyst", subtitle "Use your fingerprint to continue" | Set `setNegativeButtonText("Use password")`, title/subtitle strings |
| Biometric offer after first login | **Absent** (toggle only in Account) | One-time screen after first successful sign-in when hardware available & not yet enabled: navy; "Signed in" pill top-right; **112 dp radius-32 tile** + 56 glyph; "Unlock faster next time" 26/800; body 14 `#8FA3C2`; "**Enable Fingerprint**" 54 primary w/ glyph; "**Not now**" 50 text; footnote "You can change this any time in Settings › Security." | Add screen; enabling calls existing `BiometricAuthenticator` then `BiometricLockPreferences` |
| Settings › Security (enabled) | `AccountScreen`: M3 TopAppBar "Account", plain rows, dividers, default Switch, default Buttons | Navy header (eyebrow "Settings" 12 / "Security" 22/800); **card** radius 18: row 40 dp glyph square (`#E8F0FE`/`#1B6BF2` when on, `#F3F5F9`/`#98A2B3` off), "Fingerprint unlock" 15/600, status 12 `#5B6B7F` ("Unlocks Proplyst on this phone." / "Off. Use your password each time."), **50×30 switch** (`#1B6BF2` / `#D1D8E0`, 24 dp knob); footer 12 `#98A2B3` "Fingerprint unlocks the app on this device only. Your Proplyst session still expires and will ask for your password."; **toast** (navy pill, check `#5EA2FF`, "Fingerprint unlock is on") overlapping header −12 dp | Restyle `AccountScreen` into "Security" card layout; keep `AccountViewModel` |
| Unavailable | AlertDialog "Biometric lock unavailable" | Inline: status "This device doesn't support biometric unlock.", **switch disabled at 50 %** | Replace dialog with inline disabled state (`BIOMETRIC_ERROR_NO_HARDWARE`) |
| Not enrolled | AlertDialog | Inline: status "Fingerprint is not set up on this device.", switch disabled, extra row: "Set up Fingerprint on this device first." + "**Open device settings**" 13/700 blue (→ `Settings.ACTION_BIOMETRIC_ENROLL` / `ACTION_SECURITY_SETTINGS`) | Replace dialog (`BIOMETRIC_ERROR_NONE_ENROLLED`) |
| Account card | Version text + buttons | Card: 40 avatar + name + "email · Owner"; rows **"Lock Proplyst now"** (blue lock icon, disabled 45 % when biometric off), **"Sign out"** `#B91C1C` | Restyle |
| Sign-out confirm | `AlertDialog` | **Bottom sheet** radius 28: grab handle 40×4 `#E5E9F0`; "Sign out of Proplyst?" 20/800; body 14 `#5B6B7F` "You'll need your password next time. Fingerprint unlock on this device will be turned off."; "Sign out" 52 dp `#DC2626`; "Cancel" 50 dp outlined; scrim `rgba(11,18,32,.55)` | `ModalBottomSheet` |
| Expired session → sign-in | Sign-in with generic error | See §1 "Expired session" | §1 |
| Normal sign-in fallback | ✓ exists | ✓ | — |

---

## 7. Exact spacing guidance
- Page gutter **20 dp** (login/auth sheets **24 dp**).
- Rhythm: 4 · 8 · 12 · 16 · 20 · 24 · 32. Section-to-section **24**, section title → card **12**, rows inside a stacked list **8**, inside a form **10**.
- Navy header: top padding **10 dp below status bar**; bottom padding **64** (Owner Home), **70** (Tenant Home), **20** (Properties), **22** (Security/More); login hero is weight-filled.
- Overlap cards: `offset(y = −44)` (Owner KPI), `−48` (Tenant action card).
- Row padding: list rows **14 v / 16 h**; compact rows **12 v / 16 h**; KPI strip **14 v / 6 h**.
- Bottom content spacer **110 dp** on every tab screen (64 nav + 10 margin + gesture inset).

## 8. Exact type hierarchy (Plus Jakarta Sans)
| Token | Size / weight | Tracking | Use |
|---|---|---|---|
| financialHero | 44 / 800 | −1.4 | Collected amount, rent due |
| screenTitle | 28 / 800 | −0.6 | Login / auth titles |
| pageTitle | 26 / 800 | −0.5 | Properties, lock, offer titles |
| settingsTitle | 22 / 800 | −0.4 | Security / More |
| sectionHeading | 17 / 700 | 0 | "Needs attention", "Recent activity" |
| cardTitleLarge | 18 / 700 | −0.2 | Property card name |
| wordmark | 16 / 700 | −0.2 | "Proplyst" in header |
| button | 16 / 700 | 0 | Primary 54 dp buttons |
| buttonSecondary | 15 / 600 | 0 | 50 dp secondary buttons |
| cardTitle | 15 / 600 | 0 | Row titles |
| body | 14 / 400 | 0 | Subtitles, greetings |
| caption | 13 / 400 | 0 | Context lines, header labels |
| captionEmphasis | 13 / 600–700 | 0 | Links, % badge, chip text |
| meta | 12 / 400–600 | 0 | Timestamps, descriptions |
| kpiValue | 20 / 800 | −0.5 | KPI strip, stat cards |
| chipLabel | 11 / 700 | +0.3 uppercase (severity) / normal (status) | Chips, section labels |
| microLabel | 10 / 600 | +0.5 uppercase | Stat labels on photo cards |

## 9. Exact logo / avatar sizing
- Login mark **64×70 dp** (aspect 370:400), left-aligned.
- Home header mark **26 dp tall** + wordmark text 16/700, gap 8.
- Lock screen wordmark image **20 dp tall**, white (tint `#FFFFFF`), centred.
- Avatar **40 dp** circle `#1B6BF2`, initials 13/700 white. Bell **40 dp** circle. Icon buttons in navy: bg `rgba(255,255,255,.06)`, border 1 px `.14`.
- Unread dot 9 dp `#5EA2FF`, 2 dp ring in header colour, at (top 7, right 8).

## 10. Exact card radius guidance
- Inputs, buttons, chips-as-buttons **14** · Small tiles/thumbnails **10–12** · List cards **16** · Stat / KPI / action / settings cards **18** · Photo cards & hero tiles **20** · Glyph tiles **32 (112 dp) / 36 (120 dp)** · Sheets **28** top corners · Pills **999**.

## 11. Exact floating-nav dimensions (kept as the approved deviation)
- Container: white `#FFFFFF` in **both** themes, pill (999), **height 64 dp**, horizontal margin **20 dp**, bottom margin **10 dp** above gesture inset, shadow **12 dp** with `rgba(15,27,45,.28)` ambient/spot.
- Items: 4, equal weight, inner padding 6 dp. Active indicator **52×30 dp** pill `#E8F0FE`; icon **22 dp** (`#1B6BF2` active / `#98A2B3` inactive); label **11/600** 2 dp below (same colours). Use **outlined** icons (`Icons.Outlined`).
- `FloatingBottomNav.kt` already matches these values; change only `labelSmall` → 11/600 (not 700 + tracking) and icons to outlined.

## 12. Light-mode treatment
Canvas `#F3F5F9`; cards `#FFFFFF`; navy headers `#0B1220`; text `#0F1B2D` / `#5B6B7F` / `#98A2B3`; borders `#E5E9F0`; dividers `#EEF1F5`; inputs `#F6F8FB`. Status tints per README. This is what every `B-*` mock shows.

## 13. Dark-mode treatment
`ProplystDarkPalette` in `Color.kt` is accepted as the dark theme: canvas `#0B1220`, cards `#121B2E`, header navy `#08111F`, text `#F3F6FC` / `#AAB9D1` / `#7C8CAB`, borders `#263252`, primary `#5EA2FF`. Rules: headers keep the glow; overlap cards keep the 8 dp navy shadow; floating nav stays white; status chips use the lifted dark tints; photo-card gradient unchanged. Auth/lock screens are navy in both themes (no change).

## 14. Component / state references
- Login & auth states → `B-Auth.dc.html` (`screen` prop ids: `signin`, `signin-loading`, `signin-invalid`, `signin-network`, `signin-expired`, `signin-loggedout`, `signin-returning`, `forgot`, `forgot-sent`, `oauth-loading`, `bio-offer`, `bio-prompt`, `settings-enabled`, `settings-unavailable`, `settings-notenrolled`, `lock`, `lock-prompt`, `lock-failed`, `logout-confirm`). View with `platform="android"`.
- Owner Home → `B-OwnerHome.dc.html`; Properties → `B-Properties.dc.html`; Tenant Home → `B-TenantHome.dc.html` (all `platform="android"`).
- Security settings / More list pattern → `B-Auth.dc.html` `settings-enabled`.
- Tokens → `README.md` › Design tokens; this file §7–§11 supersedes where more specific.
- Assets → `assets/logo-mark.png`, `assets/logo-wordmark.png`, `assets/prop-*.png`.

## Suggested order for Claude Code
1. §0 globals (font, tokens, assets, glow, shadows, text field) — one PR.
2. §1 Login + §6 auth/biometric (lock overlay, offer screen, Security restyle, bottom-sheet sign-out).
3. §2 Owner Home, §3 Properties.
4. §5 Tenant Home, §4 More.
Each step: screenshot the emulator next to the matching `B-*` frame (Android tweak) and compare before merging.
