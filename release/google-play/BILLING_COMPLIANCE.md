# Google Play billing compliance — finding and remediation options

**Status: unresolved policy violation. Do not submit without a decision on this.**
Audited 11 September 2026. No code was changed; this is a report.

## How subscription purchasing actually works today

1. The Android app contains **no Play Billing integration at all**. Grepping
   `app/build.gradle.kts`, `gradle/libs.versions.toml` and the whole Kotlin source for
   `com.android.billingclient` / `BillingClient` returns nothing.
2. `ui/more/OwnerMoreScreen.kt:58` defines
   `WEB_BILLING_URL = "https://proplyst.co.za/organization/billing"`.
3. Line 175, inside an `if (isPrincipal)` block labelled **"Manage subscription"** /
   *"Billing and plan (opens in browser)"*, fires
   `Intent(ACTION_VIEW, Uri.parse(WEB_BILLING_URL))` — it leaves the app for the system browser.
4. That page (`components/organizations/OrganizationBillingView.tsx`) is not a read-only receipt.
   It offers **Upgrade**, **Cancel subscription**, **update payment method** and **restore access**.
5. Payment is taken there by **PayFast**. Google receives nothing.

So: a paid subscription to cloud software, sold through an in-app button that routes the user to an
external payment processor.

## Why this is a violation

Checked against the live policy text on 11 September 2026, not from memory —
[Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738).

**Section 3 — what must use Play billing.** The "requires Google Play's billing system" list
explicitly includes *"cloud software and services (storage, productivity, **financial
management**)"* and *"subscription services"*. Proplyst is subscription cloud software for
property financial management. It lands inside that description rather than near it.

**No exemption applies.** The exemptions are physical goods, physical services, credit-card and
utility bill remittance, peer-to-peer payments, online auctions, tax-exempt donations, gambling
content. **There is no SaaS, B2B or enterprise-software exemption.** This is the assumption most
worth abandoning early — "we're B2B, the consumer rules don't apply" is not in the policy.

**Section 4 — anti-steering.** Separately and independently, §4 prohibits leading users to an
alternative payment method *"via … in-app webviews, buttons, links, messaging, advertisements"*.
The "Manage subscription" button is precisely a button leading to an alternative payment method.

Both halves are violated. Fixing only the billing integration and keeping the link out, or removing
the link and keeping PayFast-only purchasing, each still leaves one half standing.

## What is *not* available as an escape

The **external offers programme**, which legitimises linking out, is **EEA-only**. Proplyst is a
South African product billing in ZAR through a South African processor. It does not qualify.

**User choice billing does cover South Africa** — SA is named among the countries where a user may
pick an alternative billing system at purchase, with the service fee reduced by 4%. That is a real
option, but note what it is not: it still requires integrating Play Billing and *offering Play's own
system as one of the choices*. It is not permission to keep PayFast alone.

## The options, in the order I would consider them

### A. Strip the billing entry point from the Android app *(lowest cost, unblocks submission)*
Delete `WEB_BILLING_URL` and the "Manage subscription" row. The app then contains no purchase flow
and no steering link; subscriptions are bought on the web by people who found Proplyst as a web
product. This removes the §4 violation outright and removes the in-app purchase surface that §3
attaches to.

Honest about the residual risk: the app still *unlocks paid cloud software*, and Google can still
take the view that §3 applies to the app regardless of where the transaction happens. `Likely:`
this passes review, because enforcement in practice keys on in-app purchase and steering surfaces,
both of which would be gone — but it is a judgement call, not a guarantee.

Cost: a few lines, then a rebuild, version bump and re-sign of the AAB.

### B. Integrate Play Billing properly
Add the Play Billing Library, create the subscription products in Play Console, and reconcile Play's
purchase tokens against the existing PayFast subscription records server-side. Unambiguously
compliant.

Cost: substantial. Two billing systems to keep in sync, a new server-side reconciliation path, and
Play's 15%/30% fee on Android-originated subscriptions. This is an architectural change and is
**not** something to start without an explicit decision.

### C. User choice billing (SA-eligible)
B, plus an alternative billing system alongside it, for a 4% fee reduction. Strictly more work than
B. Only worth it once B exists and the Android subscription volume justifies it.

## Recommendation

**A now, B later if Android becomes a real acquisition channel.** A is proportionate to a v1.0
whose subscribers all arrive through the web, and it converts a certain §4 violation into a
defensible position. B is the correct end state but should not be rushed into a first release.

**This needs your decision before submission.** Option A is a deliberate product change — removing
a feature owners can currently reach — so it was not applied automatically.
