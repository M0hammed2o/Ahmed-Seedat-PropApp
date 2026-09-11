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

1. **Privacy policy.** The live page at `https://proplyst.co.za/privacy` is an explicit
   placeholder that says it "is not binding legal content". Google will reject that. An accurate
   draft is in `PRIVACY_POLICY_DRAFT.md` — review, adjust, and publish it.
2. **Support email.** `packages/config/src/branding.ts` still carries the documented
   `support@proplyst.example` placeholder. A real mailbox is needed for the store listing and for
   the "I can't sign in" path on `/delete-account`.
3. **Play Console itself** — account, identity verification, content rating questionnaire, and the
   final release confirmation are all account-owner actions.
