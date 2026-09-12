# Google Play billing compliance — finding, decision and current state

**Status: RESOLVED for Android v1.0 by removing the purchase surface entirely (option A).**
Audited 11 September 2026; remediated 12 September 2026.

## What Android v1.0 actually ships

- **No external PayFast or subscription purchase entry point.** The "Manage subscription" /
  "Billing and plan (opens in browser)" row is gone from `ui/more/OwnerMoreScreen.kt`, along with
  the `WEB_BILLING_URL` constant it used.
- **No external-payment steering of any kind.** No button, link, or copy anywhere in the Android
  source directs a user to PayFast, to `proplyst.co.za/organization/billing`, or to any other
  checkout. The four remaining `ACTION_VIEW` call sites are documents, invoice PDFs, maintenance
  attachments and proof-of-payment files — content the user already owns, never payment.
- **Play Billing is deliberately NOT implemented yet.** Android sells nothing, so §3 has no
  transaction to attach to and §4 has no steering to prohibit.
- **Entitlement comes from signing in.** An organisation subscribes on the web; anyone already
  entitled signs into Android and uses whatever their plan allows. There is no upgrade prompt, no
  paywall and no purchase flow on the device.
- **Web billing and PayFast are unchanged.** Nothing outside the Android module was touched, and no
  existing subscription entitlement was altered.

This is enforced by `app/src/test/java/za/co/proplyst/app/release/ReleaseHygieneTest.kt`, which
scans the whole Kotlin source (comments stripped) and fails if a billing URL, a subscription entry
point, or external purchase copy reappears anywhere — including in a screen the test has never
heard of.

### The residual risk, stated honestly

`Likely:` this passes review. Enforcement in practice keys on in-app purchase and steering
surfaces, and Android now has neither. But §3 describes "cloud software and services (… financial
management)" as requiring Play billing, and Proplyst is that; a reviewer could still take the view
that §3 applies to an app that *unlocks* paid cloud software regardless of where the money changed
hands. Option B below remains the unambiguous end state if that happens.

---

## The original finding, kept for the record

Audited 11 September 2026 against the live policy text.

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

## Decision taken

**Option A, on 12 September 2026, approved by Mohammed.** A is proportionate to a v1.0 whose
subscribers all arrive through the web, and it converts a certain §4 violation into a defensible
position. B remains the correct end state if Android ever becomes a real acquisition channel, and
option C only after B exists.

What owners lose: a shortcut from the app to the billing page. They manage their subscription at
`proplyst.co.za/organization/billing` in a browser as before — Android simply no longer links
there.
