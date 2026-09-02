# Claude Code — start here

Read in this order, then implement. Do not ask the designer to re-explain; everything is in these files.

1. `README.md` — design tokens, every screen's measurements and copy, auth flow rules, state variables, platform notes.
2. `ANDROID_FIDELITY_AUDIT.md` — the correction pass for the existing Compose app (`apps/android/app/src/main/java/za/co/proplyst/app/ui/**`). Every finding is CURRENT → APPROVED → REQUIRED with exact dp/sp. Follow its "Suggested order" (§0 globals first).
3. `HANDOFF_STATUS.md` — what exists and what does not (Property Detail, Activity, Tenant Payments/Requests/Profile, Notifications have no mock yet; do not invent them, follow the Navy Deck list pattern if unavoidable).

Reference mocks (open in a browser, this folder, `support.js` alongside):
- `B-Auth.dc.html` — all 19 auth/biometric states. Set `platform="android"`.
- `B-OwnerHome.dc.html`, `B-Properties.dc.html`, `B-TenantHome.dc.html` — approved screens.
- `Proplyst Auth States.dc.html` — flow rules + every state in frames.
- `Proplyst Mobile Directions.dc.html` — design-system summary. Only 1b Navy Deck is approved; A-/C- files are rejected explorations.

Assets to copy into `res/`: `assets/logo-mark.png`, `assets/logo-wordmark.png` (tint white on navy), `assets/prop-*.png` (dev placeholders only).

Rules
- Visual/UX changes only. Do not touch auth security, session/refresh logic, biometric architecture, repositories, APIs or migrations.
- Biometrics unlock a locally stored session; they never replace server sign-in.
- Keep the floating white pill bottom nav (accepted deviation).
- Typeface is Plus Jakarta Sans (bundle in `res/font/`), weights 400–800.
- No invented OAuth client IDs, Apple team IDs, keys or Firebase settings.
- After each screen, screenshot the emulator next to the matching `B-*` mock and compare before moving on.
