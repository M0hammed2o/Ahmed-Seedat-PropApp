# App access — reviewer sign-in

Proplyst requires an account, so Google must be given working credentials or the review fails.

In Play Console: **App content → App access → All or some functionality is restricted**, then add
one instruction set.

| Field | Value |
|---|---|
| Name | Owner / landlord account |
| Username | `demo-owner@proplyst-demo.local` |
| Password | **Do not type from memory. See below.** |
| Any other instructions | See the block below |

## Where to get the password

It is deliberately not in this repository. Read it from the gitignored file on your machine:

```
C:\Users\junsm\Downloads\PropValt (Property App)\.env.demo-credentials.local
```

the value of `PROPLYST_PROD_DEMO_PASSWORD`. Paste it straight into Play Console. Do not commit it,
do not paste it into chat, and do not put it in the store listing.

## Instructions to paste into Play Console

```
Proplyst is property-management software for landlords. All functionality requires an account.

Sign in with the credentials above on the sign-in screen. No email confirmation, one-time code or
second factor is required for this account.

On the web only, the first sign-in may show a one-page "Accept the Privacy Policy" screen, because
the policy was updated on 11 September 2026. Tick the box and tap "Agree and continue". The Android
app does not show this screen.

The account opens a fully populated demonstration portfolio (11 properties, 39 units, 36 tenants)
so every screen has real data:

- Home shows rent collected, outstanding rent, operating expenses and the monthly net position.
- Properties lists the portfolio; tap any property for its units and finances.
- Rent status shows who has paid, partly paid or is overdue.
- Add expense, Meter reading and Record payment are reachable from Home's quick actions.
- More contains account settings, including account deletion.

This is a dedicated demonstration organisation. It contains no real customer or tenant data, and
nothing done in it affects any real user.

The same account also works at https://proplyst.co.za.
```
