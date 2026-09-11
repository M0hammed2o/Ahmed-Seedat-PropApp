# Proplyst — Google Play release package

Prepared 2026-09-10 for the first production release of the Proplyst Android app.

| | |
|---|---|
| Application ID | `za.co.proplyst.app` |
| Version name | 1.0.0 |
| Version code | 1 |
| Min SDK | 26 (Android 8.0) |
| Target SDK | **36 (Android 16)** — required for new apps from 2026-08-31 |
| Artifact | `apps/android/app/build/outputs/bundle/release/app-release.aab` |

## Files here

| File | What it is |
|---|---|
| `STORE_LISTING.md` | App name, descriptions, category, contact fields |
| `DATA_SAFETY.md` | Every Data safety answer, derived from the actual code |
| `APP_ACCESS.md` | Reviewer sign-in instructions (no password in git) |
| `RELEASE_NOTES.md` | "What's new" text |
| `REVIEWER_NOTES.md` | Context for the Google reviewer |
| `SIGNING.md` | Upload key location, fingerprints, backup rules |
| `PRIVACY_POLICY_DRAFT.md` | Accurate policy text — **needs Mohammed's legal sign-off** |
| `ASSETS.md` | Which store graphics exist and which are still needed |

## What is blocking publication

These need Mohammed personally and cannot be done from the repository:

1. **Play Console itself** — account, identity verification, content rating questionnaire, and the
   final release confirmation are all account-owner actions.
2. **Feature graphic** (1024×500). See `ASSETS.md`.
3. **Registered legal entity name and address** — optional but good practice in the privacy policy.
   `platformBillingEntity` in `packages/config/src/branding.ts` is still null by design and was not
   invented. Supply the details and they can be added in one edit.

**Resolved 2026-09-11:** the privacy policy is now real and published (`v1.0-2026-09-11`), and the
support address is `notifications@genbridge.co.za` throughout.
