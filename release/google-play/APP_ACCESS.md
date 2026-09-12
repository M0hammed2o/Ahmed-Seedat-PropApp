# App access — reviewer sign-in

Proplyst requires an account, so Google must be given working credentials or the review fails.

## The declaration question

Play Console asks whether all functionality is available without special access. **You cannot
truthfully pick that option.** Every screen in the app is behind a sign-in — `RootNavGraph` sends an
unauthenticated launch to `SignInScreen`, and there is no browse-without-an-account mode.

Choose **App content → App access → All or some functionality is restricted**, then add one
instruction set with the values below.

## Values to enter

| Field | Value |
|---|---|
| Name | `Owner / landlord account` |
| Username | `demo-owner@proplyst-demo.local` |
| Password | **Do not type from memory — see below** |
| Any other information | The 483-character block below |

### Where to get the password

Deliberately not in this repository. Read `PROPLYST_PROD_DEMO_PASSWORD` from the gitignored file on
your machine:

```
C:\Users\junsm\Downloads\PropValt (Property App)\.env.demo-credentials.local
```

Paste it straight into Play Console. Do not commit it, do not paste it into chat, and do not put it
in the store listing.

### "Any other information required to access your app" — 477 of 500 characters

```
Sign in with the email and password above on the first screen. No OTP, no two-factor and no email
confirmation are needed, and there is no Google sign-in option to worry about. Fingerprint unlock
is offered after sign-in but is optional; skip it.

The account opens a populated demonstration portfolio, so every screen has data. Nothing is
paywalled, and the app contains no purchase flow at all. It holds no real customer data.

The same login works at https://proplyst.co.za.
```

## Why this account is safe to hand over — audited, not assumed

| Question | Answer | Evidence |
|---|---|---|
| Is it a real, existing account? | Yes — reused, not newly created | Provisioned earlier for the marketing portfolio |
| Organisation | A dedicated demonstration organisation | Separate org row; no real customer shares it |
| Role | Owner **of that organisation only** | Not a platform super-admin — see below |
| Can it see other customers' data? | No | RLS scopes every read to the caller's org via `has_org_role()` |
| Synthetic data? | Yes — entirely | Portfolio was seeded; no real tenant or landlord records |
| Does the password expire? | No expiry mechanism exists | No rotation or max-age logic in the auth layer |
| OTP / email confirmation? | Neither | Password sign-in only |
| Two-factor (MFA)? | **Not for this account** | `lib/mfaGate.ts` only forces AAL2 for platform super-admins; an ordinary org owner is never asked |
| Google Sign-In required? | No, and it cannot be used | `googleSignInAvailable = BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()`, and that property is unset, so the button is inert |
| Biometric skippable? | Yes — opt-in, default off | `BiometricLockPreferences`: `getBoolean(KEY_ENABLED, false)` |
| Paywall or purchase gate? | None found | No subscription check blocks navigation in the app or middleware |
| Works on Android? | Yes | Same credentials as the web; the app authenticates against the same backend |

### The deliberate limits — read before changing anything here

This account is an **organisation owner, not a platform super-admin**. That is on purpose. The
super-admin route group (`app/(super-admin)/`) is guarded by `getAdminSession()`, which enforces
AAL2 MFA and an email allow-list. Do not add this account to that allow-list to make the review
easier: it would hand a third party platform-wide visibility, and it would force an MFA enrolment
the reviewer cannot complete anyway.

Nothing about authentication was weakened anywhere to make this work. Every "no" in the table above
was already true for ordinary users before the review.

## Two things that used to need explaining, and no longer do

**The dead Google button is gone.** The sign-in screen used to render an enabled "Continue with
Google" button with a caption admitting it did not work, because `GOOGLE_WEB_CLIENT_ID` is unset in
the release build. The button, the Google badge and the "or continue with" divider are now rendered
only when Google sign-in is actually available, so the reviewer sees a plain email-and-password
screen with nothing inert on it. This is a visibility gate, not a removal: configuring
`GOOGLE_WEB_CLIENT_ID` brings the existing UI back with no further code change.

**There is no subscription purchase link.** The "Manage subscription" row was removed from More for
this release — see BILLING_COMPLIANCE.md. A reviewer will find no purchase, upgrade or external
payment flow anywhere in the app, which is the intended v1.0 behaviour rather than an omission.
