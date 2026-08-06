# Subscriptions

## Model

V1 ships one plan: **PropVault Base**. Entitlement architecture is nonetheless multi-plan-ready (`packages/config/entitlements.ts`) so a future tier doesn't require restructuring — it requires adding a config row.

Placeholder configuration (real commercial values `TO_BE_CONFIRMED` by Mohammed before store submission):

```ts
{
  planId: 'propvault_base',
  displayName: 'PropVault Base',
  monthlyPrice: 'TO_BE_CONFIRMED',
  annualPrice: null,          // disabled for V1
  trialDays: 'TO_BE_CONFIRMED',
  maxProperties: 10,          // configurable placeholder
  storageAllowanceMb: 2048,   // configurable placeholder
  maxFileSizeMb: 25,          // configurable placeholder
  ocrPagesPerMonth: 200,      // configurable placeholder
}
```

## Subscription state machine

`unknown → trialing → active → grace_period → billing_issue → expired/cancelled/revoked`

State is stored in Postgres (`subscriptions.status`), written **only** by the RevenueCat webhook receiver (`apps/admin/app/api/webhooks/revenuecat`) running with the service-role client. Neither app ever writes its own `status` column — the client reads it, never sets it. This directly satisfies "never trust a client-submitted subscription status."

| State                               | Customer can...                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown`                           | Register, browse paywall. No property/document features.                                                                                                   |
| `trialing` / `active`               | Full property + document features, subject to plan limits.                                                                                                 |
| `grace_period` / `billing_issue`    | Full read access; the central `restrictedMode` config decision (see below) governs whether new uploads are blocked.                                        |
| `expired` / `cancelled` / `revoked` | Read-only access to existing properties/documents (never deleted for lapsing — see rule below); new property/upload actions blocked with a paywall prompt. |

Decision recorded in DECISIONS.md: Phase 1 sets `restrictedMode = 'read_only'` (not full lockout) for `grace_period`/`billing_issue`/expired states, since destroying access to a customer's own uploaded bills the moment a card fails would contradict the product's "document vault" trust promise. This is a config flag (`packages/config/subscriptionPolicy.ts`), not a hardcoded branch, so it can change without a redeploy of business logic.

## RevenueCat integration boundary

- Mobile: `react-native-purchases` wrapped behind a `SubscriptionProvider` interface (`apps/mobile/src/features/subscriptions/SubscriptionProvider.ts`) with two implementations:
  - `MockSubscriptionProvider` — used whenever `EXPO_PUBLIC_SUBSCRIPTION_MODE=mock` (the Phase 1 default, since no App Store Connect/Play Console product IDs exist yet). Lets every screen and flow (paywall, restore, entitlement gating) be built and tested without a store account.
  - `RevenueCatSubscriptionProvider` — real SDK calls (`Purchases.configure`, `getOfferings`, `purchasePackage`, `restorePurchases`, `Purchases.getCustomerInfo`), gated behind real product identifiers once provided.
- Server: RevenueCat webhook → validates shared secret → upserts `subscriptions` + appends `subscription_events` (idempotent on RevenueCat's `event.id`).
- The client only ever asks "what does the server think my entitlement is" for anything that gates a paid action server-side (property/document writes are also enforced by a Postgres check — see DECISIONS.md on whether that check ships in Phase 1 or Phase 2).

## Restore Purchases / Manage Subscription

- Restore Purchases: available from the paywall and from Settings; calls `SubscriptionProvider.restore()`, which for the mock provider simulates a restored `active` mock subscription, and for the real provider calls `Purchases.restorePurchases()` then re-syncs from the webhook-fed `subscriptions` table (never trusts the client-side restore result alone as the entitlement source of truth).
- Manage Subscription: deep-links to the platform's native subscription management screen (`Linking.openURL('itms-apps://apps.apple.com/account/subscriptions')` on iOS, `https://play.google.com/store/account/subscriptions` on Android), never a custom in-app cancellation flow.

## Feature-entitlement architecture

`packages/config/entitlements.ts` exposes `hasEntitlement(subscription, feature)` where `feature` is one of a closed set (`add_property`, `upload_document`, `ocr_processing`, ...) checked against `planId` + `status` + configured limits (e.g. `maxProperties`). All gating in the UI and in server-side checks calls this single function — no duplicated "if status === active" branches scattered through the codebase.

## Organization-level web billing (distinct from the mobile flow above)

**Implemented 2026-08-02** (`apps/admin/lib/billing.ts` + `apps/admin/lib/providers/billing.ts`, migration `20260101000054`). This is the org (agency/landlord customer) paying PropertyVault for its own SaaS subscription via a web-based South African payment gateway — a completely separate system from RevenueCat's mobile app-store entitlement flow above, which is about an _individual mobile user's_ subscription. The two are not merged.

- `BillingGatewayProvider` (`packages/types/src/billing.ts`) is vendor-agnostic: `createCustomer`, `createSubscription` (checkout), `getPaymentStatus`, `cancelSubscription`, `refundPayment`, `verifyWebhookSignature`, `parseWebhookEvent` — a real PayFast/Yoco/Stitch provider is added by implementing this interface and swapping `getBillingGatewayProvider()`'s return value; the billing service (`apps/admin/lib/billing.ts`) that calls it never changes.
- `MockBillingGatewayProvider` is the only implementation that exists — no real gateway account exists (external-service blocker). It is deterministic (same `idempotencyKey` → same `providerSubscriptionId`), never returns a real-looking checkout URL (`mock-gateway.invalid`), and never activates real billing.
- `billing_events` (new table) is the idempotency guard: a `unique(provider_name, provider_event_id)` constraint means a retried webhook delivery (which every real gateway does on any non-2xx response) is a no-op, not a double-processed payment.
- The Capitec business bank account this org already receives rent/owner-payout settlements into (`ACCOUNTING.md` §2's Business/Trust Bank Account) can keep receiving PropertyVault subscription-fee settlements too, regardless of which gateway is eventually chosen to _collect_ the payment — Capitec is the settlement destination, not a payment method; PayFast/Yoco/Stitch/Capitec Pay are collection methods that all settle into the same underlying business bank account. Choosing a gateway is a separate decision from which bank the money lands in.
- API: `POST /api/v1/admin/organizations/:orgId/billing/checkout`, `.../billing/cancel`, `.../billing/payments` (list, "Super Admin visibility of payment state"), `POST /api/v1/admin/subscription-payments/:id/refund`, `POST /api/v1/billing/webhook` (unauthenticated, signature-verified — the real gateway's own inbound endpoint). All `super_admin`-triggered (no org self-serve checkout UI in V1, matching every other subscription action in this codebase, e.g. the existing plan-change endpoint).
- Web UI: a Billing panel on the Super Admin customer detail page (`/customers/:id`) — payment history table, start-checkout/cancel-subscription actions.
- Tests: `apps/admin/lib/providers/__tests__/billing.test.ts` (6 cases, deterministic idempotency, malformed-payload rejection) + `apps/admin/lib/__tests__/billing.test.ts` (6 real integration tests against local Supabase: checkout creates a pending payment, a successful webhook moves it to paid and activates the org, a replayed webhook is a genuine no-op verified against the real unique constraint, a failed payment marks the org overdue, cancellation, missing-signature rejection) + `supabase/tests/billing_events_isolation.test.sql` (7 pgTAP assertions — org-scoped read, no client write path, the unique constraint itself).
