# Proplyst Mobile — handoff status (audit, 2 Sep 2026)

Approved direction: **1b Navy Deck**. Files prefixed `B-` are the approved screens. `A-` and `C-` are rejected explorations, included for context only.

## Checklist

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Mobile design system (tokens, type, shape, card + nav rules) | Present | `README.md` › Design tokens; `Proplyst Mobile Directions.dc.html` (turn 1 summary) |
| 2 | Light theme | Present (canvas `#F3F5F9`, white cards) | All `B-*` content areas |
| 3 | Dark / Navy Deck theme | Present (navy `#0B1220` headers, lock/auth screens) | `B-*`, `B-Auth` |
| 4 | Android platform treatment | Present (M3 nav bar, BiometricPrompt sheet, no Apple button) | `platform="android"` prop on every `B-*` file |
| 5 | iOS platform treatment | Present (translucent tab bar, Face ID/Touch ID, Apple button) | `platform="ios"` prop |
| 6 | Login | Present | `B-Auth.dc.html` (`signin*` states); `B-Login.dc.html` legacy |
| 7 | Owner Home | Present | `B-OwnerHome.dc.html` |
| 8 | Properties | Present | `B-Properties.dc.html` |
| 9 | Property Detail | **Missing** | — |
| 10 | Owner Activity | **Missing** (tab exists in nav; Recent-activity row pattern on Owner Home) | — |
| 11 | Owner More / Profile | **Missing** (Security settings sub-screen exists in `B-Auth`) | — |
| 12 | Tenant Home | Present | `B-TenantHome.dc.html` |
| 13 | Tenant Payments | **Missing** (Report-payment card pattern on Tenant Home) | — |
| 14 | Tenant Requests | **Missing** (request row pattern on Tenant Home) | — |
| 15 | Tenant Profile | **Missing** | — |
| 16 | Notifications | **Missing** (bell + unread dot only) | — |
| 17 | Invoice / payment patterns | Partial (activity rows, report-payment state, collected/expected stats) — no invoice list or detail | `B-OwnerHome`, `B-TenantHome` |
| 18 | Maintenance patterns | Partial (Needs-attention severity rows, request status pills) — no request detail or create flow | `B-OwnerHome`, `B-TenantHome` |
| 19 | Google Sign-In states | Present | `B-Auth` `oauth-loading` + button |
| 20 | Apple Sign-In states | Present (iOS only) | `B-Auth` |
| 21 | Face ID / Touch ID states | Present (offer, prompt, enabled, unavailable, not enrolled, lock, failed) | `B-Auth`, `biometric` prop |
| 22 | Android fingerprint states | Present | `B-Auth` with `platform="android"` |
| 23 | Session-expired / logout / error / loading | Present | `B-Auth` |
| 24 | Tappable auth flow | Present | `Proplyst Auth States.dc.html` (first phone) |
| 25 | Auth state-sheet grid | Present (19 states + Touch ID variant) | `Proplyst Auth States.dc.html` |
| 26 | Navigation / component spec | Present (nav structure, cards, chips, buttons, inputs, banners, toasts, sheets) | `README.md` |

## Android fidelity audit (2 Sep 2026)
`ANDROID_FIDELITY_AUDIT.md` — per-screen CURRENT ANDROID / APPROVED DESIGN / REQUIRED CHANGE for Login, Owner Home, Properties, More, Tenant Home, Auth/Biometric, plus exact spacing, type, logo/avatar, radius, floating-nav, light/dark rules. Floating white pill nav is the one accepted deviation.

## Files Claude Code should receive
Everything in `design_handoff_proplyst_mobile/`:
- `README.md` (spec), `HANDOFF_STATUS.md` (this file), `ANDROID_FIDELITY_AUDIT.md` (correction pass)
- Approved: `B-Auth.dc.html`, `B-OwnerHome.dc.html`, `B-Properties.dc.html`, `B-TenantHome.dc.html`, `B-Login.dc.html`
- Overviews: `Proplyst Auth States.dc.html`, `Proplyst Mobile Directions.dc.html`
- Context only: `A-*.dc.html`, `C-*.dc.html`
- `assets/` (logo-mark, logo-wordmark, logo-full, 3 property photos), `support.js`, `frames/` (presentation only)

Not needed: `screenshots/`, `uploads/` (source screenshots; brand values already extracted).
