# Notes for the Google Play reviewer

Paste into any free-text field that asks for context, or keep for responding to a review question.

```
Proplyst is business software for South African landlords and property owners. It records the
financial side of a rental portfolio: rent due and collected, expenses, budgets, utility meter
readings and maintenance.

ACCOUNT REQUIRED
All functionality is behind a sign-in. Demonstration credentials are supplied under App access.
They open a populated demo portfolio so every screen shows real data.

PERMISSIONS
The app declares only two:
- INTERNET — it is a client for a hosted service.
- USE_BIOMETRIC — optional fingerprint unlock for the app, off by default.
It declares no camera or storage permission. Receipts and evidence are attached through the system
camera app and the Android photo/file picker, so the app never has ambient access to the gallery.

NO ADS, NO TRACKING
There is no advertising, analytics, attribution or crash-reporting SDK in the build.

FINANCIAL FEATURES
Proplyst records money that has already moved — it is bookkeeping, not a payment service. The
Android app moves no funds, holds no funds, and contains no payment SDK. Subscription billing for
the service itself happens on the web and is not part of this app.

ACCOUNT DELETION
In-app at More → Account → Delete account, and on the web at
https://proplyst.co.za/delete-account (public, no sign-in needed). Deleting removes the person's
name, email address and phone number and permanently disables sign-in. Accounting records are
retained to satisfy South African tax-record law and no longer identify the person; this is stated
on the deletion page and in the privacy policy.

DATA LOCATION
Data is held in Supabase (Postgres) with row-level security, and the application is hosted on
Render. Both act only as processors.
```
