# Subscriptions

**Rewritten 2026-08-18** (V1 billing/subscription/PayFast commercial-close pass) — the previous
version of this document described the old RevenueCat mobile-only entitlement model as "V1 ships
one plan" and said org-level web billing had "no org self-serve checkout UI in V1." Both are long
superseded. This version reflects what was found by directly auditing the current repository and
running the actual test suites live, not by trusting that a migration existing meant it worked.

## Model: organization-level web billing (the live, real system)

Proplyst's own SaaS subscription is billed to the **organization** (the agency/landlord customer),
not to an individual mobile user. This is the only subscription system that actually exists and
is wired end-to-end; the RevenueCat/mobile-entitlement design this document used to lead with is
dead code (`packages/config/src/planLimits.ts`, `entitlements.ts`, `subscriptionPolicy.ts`,
`packages/types/src/subscription.ts`, the `subscriptions`/`subscription_events` tables from
migration `20260101000012`) — confirmed zero real call sites by grep, superseded module by module
once `plans`/`organization_subscriptions` (migration `20260101000019`) shipped. It is not deleted
outright (a future genuinely-mobile-first product decision could still want it), but nothing in
the live system reads or writes it.

### Plan catalogue (`public.plans`, seeded in migration `20260101000075`)

| Code           | Name         | Price (ZAR/mo) | maxProperties | maxStaff  | ocrEnabled | ownerPortalEnabled | advancedReporting | bulkCommunications | apiAccess | prioritySupport |
| -------------- | ------------ | -------------- | ------------- | --------- | ---------- | ------------------ | ----------------- | ------------------ | --------- | --------------- |
| `starter`      | Starter      | 299.00         | 5             | 1         | false      | false              | false             | false              | —         | —               |
| `professional` | Professional | 699.00         | 25            | unlimited | true       | true               | true              | true               | —         | —               |
| `business`     | Business     | 1499.00        | unlimited     | unlimited | true       | true               | true              | true               | true      | true            |

Not hardcoded — `plans` is a real table (`code, name, billing_cycle, base_price, currency,
feature_limits jsonb, is_active, version`), versioned so a price change creates a NEW version
under the same `code` rather than mutating what an existing subscriber signed up under
(`unique(code, version)`, fixed from an originally-too-strict `unique(code)` in migration
`20260101000046`). A super-admin can create/version plans via `POST /api/v1/admin/plans`.

## The proration engine — the critical commercial rule, proven

**Rule**: an existing customer upgrading mid-period is charged only the prorated DIFFERENCE
between plans for the remaining period, never the full new-plan price again. A downgrade never
issues a mid-cycle refund and keeps the customer's current (higher) entitlement until the period
already paid for ends.

This is implemented entirely in Postgres (`supabase/migrations/20260101000104_billing_proration_engine.sql`),
not in TypeScript — `apps/admin/lib/billing.ts` only ever passes through what these functions
compute, never recomputes or trusts a client-supplied amount:

- **`compute_plan_change_quote(org_id, target_plan_id)`** — pure, side-effect-free, `stable`.
  Classifies the change (`new_subscription` / `upgrade` / `downgrade` / `reactivation` /
  `no_change`) and prices it:
  - **Upgrade** (`target_effective_price >= current_effective_price`): `amount_due_now =
round((target_effective_price - current_effective_price) * remaining_fraction, 2)`, where
    `remaining_fraction = (current_period_end - current_date) / (current_period_end -
current_period_start)`, clamped to `[0, 1]`. `current_period_end` is preserved (not reset);
    the next renewal charges the full new-plan price.
  - **Downgrade**: `amount_due_now = 0`, `effective_at = current_period_end` — scheduled, not
    immediate.
  - **Reactivation** (org status is `suspended`/`cancelled`): full target price, fresh period —
    there is no "currently paid period" to prorate against, so this is priced like a first-time
    subscription, not an upgrade/downgrade.
  - **New subscription** (no `organization_subscriptions` row at all yet, e.g. still trialing):
    full target price.
  - `current_effective_price` folds in `price_override`/`discount_pct`/`promotional_credit` from
    the CURRENT subscription row; `target_effective_price` is always the target plan's plain
    `base_price` — an override/discount does not carry forward onto a new plan (a deliberate,
    disclosed V1 scope decision; a super-admin can apply a fresh override afterward for a
    negotiated deal).
- **`create_plan_change_quote(org_id, target_plan_id)`** — persists one `compute_plan_change_quote()`
  result with a 15-minute expiry (`billing_change_quotes`) — what the customer actually sees
  before confirming.
- **`confirm_plan_change(quote_id)`** — idempotent (calling it twice with the same `quote_id`
  replays the same outcome, never a second charge). ALWAYS recomputes fresh against live state
  rather than trusting the quote row's stored numbers — the quote exists for expiry/idempotency
  bookkeeping, not as the source of truth for the charge. A zero-charge upgrade/no-change applies
  immediately, synchronously. A downgrade is recorded `scheduled`. A real-money upgrade/
  reactivation is recorded `awaiting_payment` — **the org's `plan_id` does not change yet**; that
  only happens in `processBillingWebhookEvent` once the gateway confirms payment succeeded.
  "Upgrade access becomes effective immediately" means immediately upon confirmed payment, never
  before it — granting a paid-tier entitlement before money has actually moved would be a real
  revenue-integrity gap.
- **`cancel_pending_plan_change(org_id)`** — cancels a scheduled downgrade before it takes effect.
  Idempotent (`false`, not an error, if nothing was scheduled).
- **`apply_due_scheduled_plan_changes()`** — service-role-only, called from the subscription
  lifecycle daily job. Applies every scheduled downgrade whose `effective_at` has arrived, flips
  `plan_id`, marks the row `completed`. Idempotent by construction — a row leaves `status =
'scheduled'` the moment it's applied, so re-running is always safe. Never touches
  properties/units/leases/tenants — a downgraded org simply can't CREATE more than its new plan
  allows (see Entitlements below); nothing is deleted or archived.

**Proven live this pass**, not merely read: `pgtap` was installed into the running local Supabase
instance and `supabase/tests/billing_proration_engine.test.sql` (34 assertions) was executed —
34/34 pass, including the exact worked example: Starter (R299) → Professional (R699) exactly
halfway through a 30-day period charges `(699 - 299) * 0.5 = R200.00`, confirmed both via the
assertion and via `cmp_ok` bounding a 1-day-before-renewal upgrade to under R20 of a R400 max
difference. Also covers: upgrading on day 1 (near-full difference), upgrading exactly at
`period_end` (R0.00, no error, no negative amount), a price-override/discount/promotional-credit
combination folding correctly into `current_effective_price`, duplicate confirmation (idempotent,
no second row), an expired never-confirmed quote (rejected), and the full downgrade
schedule→cancel→re-schedule→apply lifecycle.

## PayFast integration

`apps/admin/lib/providers/payfast.ts` implements the vendor-agnostic `BillingGatewayProvider`
interface (`packages/types/src/billing.ts`) — the same interface `MockBillingGatewayProvider`
implements for local dev/CI, so `apps/admin/lib/billing.ts` and the proration engine above never
change when a real gateway is wired in or swapped.

- **Checkout**: builds a signed form submission (fields in submission order, PHP-`urlencode`-
  compatible encoding, MD5 signature) to PayFast's hosted checkout page. `m_payment_id` is our own
  idempotent reference (not a PayFast-generated id — that's only assigned once payment completes),
  echoed back in every ITN for that payment.
- **ITN webhook** (`POST /api/v1/billing/webhook`, unauthenticated — a payment gateway is not a
  signed-in user, trust comes entirely from signature verification): two independent checks, both
  required — (1) recompute the MD5 signature from the raw body and compare, proving the payload
  wasn't tampered with in transit; (2) a server-to-server confirmation POST back to PayFast with
  the same raw body, proving the request actually originated from PayFast (not merely someone who
  guessed/leaked the passphrase and can forge a matching signature offline). A network failure
  reaching PayFast's own confirmation endpoint fails CLOSED (rejected, not silently accepted).
- **Amount validation** (added this pass): a correctly-signed ITN reporting a `payment_succeeded`
  amount that doesn't match the `subscription_payments.amount` it's confirming is REJECTED before
  any entitlement flip or status change — signature proves the event came from PayFast unmodified,
  it does not by itself prove the amount matches what was actually owed.
- **Idempotency**: `billing_events` has a `unique(provider_name, provider_event_id)` constraint —
  a retried webhook delivery (which every real gateway does on any non-2xx response) inserts
  nothing a second time and `processBillingWebhookEvent` returns early without reprocessing.
  Proven live via both a real duplicate-webhook vitest test and the constraint's own pgTAP test.
- **Two genuinely different signature algorithms**, confirmed from independent sources: checkout/
  ITN signs fields in submission order with a running-MD5-then-passphrase pattern; the separate
  Subscriptions/Refunds Management API (`cancelSubscription`/`refundPayment`) sorts every field
  alphabetically first — a different rule, not a copy-paste of the first applied twice.

**Manual/external blocker, unchanged from `TECHNICAL_DEBT_REGISTER.md` TD-36**: no real PayFast
merchant account exists in this environment. Every algorithm above is cross-checked against
PayFast's own documentation and multiple independent working implementations, not invented — but
this has never completed a live round trip against PayFast's sandbox or production servers.
`cancelSubscription`/`refundPayment` (the Management API path) carry the least confidence of the
three call groups and should be the first thing manually verified once credentials exist.
`assertRealPaymentGatewayAvailable()` refuses to silently fall back to the mock gateway in a real
production deploy (`NODE_ENV === 'production'` with no PayFast credentials configured throws
rather than "succeeding" against a fake `mock-gateway.invalid` URL).

## Entitlements / plan limits

`apps/admin/lib/subscriptionEntitlements.ts` — thin wrappers around Postgres RPCs (the database is
the real enforcement, matching this codebase's own "server-side and DB-level, not just a UI
check" pattern): `mayCreateProperty()`/`org_property_limit()`/`available_property_slots()`
(migration `20260101000102`), `getOrgSeatSummary()`/`canInviteStaff()` (staff-seat limits,
migration `20260101000094`), `getOrganizationEntitlements()` (the full feature_limits read).
Called from the actual mutating API routes (e.g. `POST /api/v1/properties` calls
`mayCreateProperty()` before creating, with a second, database-level check as a backstop) — not
merely a UI hint a direct API call could bypass.

**Disclosed, not a bug**: `canUseBulkCommunications()`/`canUseApiAccess()` always return `true`
regardless of plan — there is no real bulk-communications or API-access feature built yet to gate,
so the function has nothing to enforce. The test asserting this is itself named "audit finding,
not a stub oversight."

## Renewals, failed payments, grace period, cancellation

- **Renewal**: PayFast's own recurring billing (subscription_type=1, `cycles=0` = until
  cancelled) re-charges automatically; the resulting ITN is an ordinary `payment_succeeded` event
  for an already-`active` org, which correctly sends no lifecycle email (only a genuine first
  activation or a suspended/cancelled reactivation does).
- **Failed payment**: `organizations.status` moves to `overdue`, `overdue_since` is set — but only
  on the FIRST failure while not already overdue (a second failed retry before recovery does not
  push the grace-period clock forward, or an org that keeps failing every few days would never
  actually reach the suspend threshold). `expire_trials_and_suspend_overdue()` (migration
  `20260101000076`, run daily) suspends an org that's been overdue past the grace period. A
  failed UPGRADE payment specifically (distinct from a failed RECURRING charge) only marks that
  one `billing_plan_changes` row `failed` — the org's own current, already-paid-for plan is
  completely unaffected; the customer keeps what they have and can retry.
- **Cancellation**: immediate (not end-of-period — the existing, deliberate lifecycle, not changed
  by this pass), idempotent (a second cancel call reports `alreadyCancelled` without a second
  gateway call or audit row), resolves the gateway's own recurring-billing token from
  `organization_subscriptions.provider_subscription_token` (captured from the first successful
  ITN) rather than the caller handling a raw gateway token.
- **Grace-period access — fully live-tested this pass** (V1 billing final gap-closure pass,
  upgraded from the prior pass's own "not re-audited in depth" disclosure to `Verified`):
  `organizations.status` transitions (`trial → active → overdue → suspended/cancelled`) remain the
  single authoritative gate every RLS policy and entitlement check reads (`has_org_role()`,
  migration `20260101000055`/`20260101000057`) — no separate access-mode config layer exists (the
  old `restrictedMode`/`grace_period` config described in a much earlier version of this document
  belonged to the now-dead RevenueCat model). The full matrix, run live against a real local
  Supabase instance, not inferred from migration comments (`supabase/tests/
grace_period_access_matrix.test.sql`, 16 assertions, plus the pre-existing `multi_tenant_
isolation.test.sql` coverage for `suspended`/`archived`):
  - **trial / active / overdue**: full read+write access, unchanged — `overdue` (the grace period
    itself) is NOT a restricted state; a real INSERT/UPDATE against `properties` succeeds for the
    org's own principal in all three states. This is the deliberate commercial policy: a
    grace-period customer keeps normal business access while they sort out payment.
  - **suspended / cancelled**: read-only — `viewer`-level access passes (the org can still view its
    own data and reach billing to pay/reactivate), `agent`-level (write) access fails; proven with
    a real UPDATE attempt against `properties` that runs without a permission error but genuinely
    changes zero rows (RLS with no write policy for the failing case, not an exception — verified
    by re-reading the row afterward, not merely by the predicate function's return value).
  - **archived**: zero access at any level (pre-existing `multi_tenant_isolation.test.sql`
    coverage, unchanged this pass).
  - No status transition ever deletes or archives business data — suspension/cancellation only
    ever changes `organizations.status` (and the RLS gate that reads it); every table's rows remain
    intact and readable at `viewer` level throughout.
- **Reactivation lifecycle — a real bug found and fixed this pass, not merely tested**: a
  reactivation (suspended/cancelled → paid → active again) always prices at the FULL target plan
  price via `compute_plan_change_quote()`'s own `reactivation` branch (there is no "currently paid
  period" to prorate against for a suspended org) and completes through the same deferred-payment
  webhook path as a paid upgrade. A live end-to-end test (`billing.test.ts`'s new "reactivation
  lifecycle (grace-period audit)" describe block) caught that `processBillingWebhookEvent`'s
  plan-change-completion branch was flipping `plan_id`/org status back to `active` but **not**
  refreshing `organization_subscriptions.current_period_start`/`current_period_end`/
  `next_payment_date` — a subscription reactivated after sitting suspended for weeks would silently
  keep an already-ended period, not a fresh one. Fixed in `apps/admin/lib/billing.ts`: when the
  completed change's `change_type` is `reactivation`, the subscription now gets the same
  fresh-30-day period every other new-period code path in this file already opens. Re-verified live
  for BOTH starting states (overdue→suspended→paid→active, and self-cancelled→reactivated→paid→
  active): exactly one subscription row throughout (no duplicate), the stale pre-suspension period
  dates are never reused, entitlements (plan_id) restore correctly, a real invoice is recorded for
  the reactivation charge.

## Subscription invoices/receipts

A formal invoice/receipt system now exists for Proplyst's own SaaS subscription charges
(`public.subscription_invoices`, migration `20260101000108`, V1 billing final gap-closure pass) —
explicitly distinct from the unrelated landlord/tenant accounting invoice system
(`public.invoices`, `apps/admin/lib/accounting.ts`), which this table is deliberately named to
never be confused with.

- **Numbering**: `PLY-YYYY-NNNNNN`, server-generated from a Postgres sequence
  (`generate_subscription_invoice_number()`) — race-safe under real concurrent webhook delivery by
  construction, never a client-supplied or random string.
- **Lifecycle**: exactly one invoice row per successfully-collected charge, created by
  `create_subscription_invoice_for_payment(payment_id)` (`security definer`, service-role only)
  from `processBillingWebhookEvent`'s `payment_succeeded` branch, run AFTER the existing plan-flip/
  status logic so an upgrade's invoice reflects the already-applied target plan. Classified
  server-side, never from a client hint: a payment linked to a `billing_plan_changes` row inherits
  that row's `change_type` (upgrade/reactivation) as `invoice_type`; an unlinked payment is
  `new_subscription` if the org has no prior invoice at all, otherwise `renewal`. A downgrade never
  produces an invoice (no money moves, structurally — no payment row exists to invoice). An unpaid/
  pending/failed payment is refused (`raise exception`), never invoiced. A refund
  (`refundSubscriptionPayment`) flips the linked invoice's `status` to `refunded` without altering
  its `invoice_number`/`total` — financial history is retained, never erased or renumbered.
- **Amount correctness**: the invoice `total` is always the payment's own already-charged `amount`
  — for an upgrade, that is the server-computed PRORATED difference, never the target plan's full
  base price (the exact anti-requirement this system was built to satisfy: an upgrade invoice must
  not falsely claim the entire new monthly price was paid today).
- **Idempotency**: `unique(subscription_payment_id)` makes a duplicate invoice for the same payment
  structurally impossible (a second call throws a unique-violation), on top of — not instead of —
  `billing_events`' own `(provider_name, provider_event_id)` idempotency guard, which already
  prevents the whole `payment_succeeded` branch from running twice for the same real gateway event.
- **PDF**: generated live per authenticated request (`apps/admin/lib/subscriptionInvoicePdf.ts`,
  `pdfkit`) — never stored behind a signed URL, so there is nothing to expire or leak; every
  request re-authenticates and re-checks org access from scratch. Titled "Payment Receipt" by
  default; only becomes "Tax Invoice" if `platformBillingEntity.vatNumber`
  (`packages/config/src/branding.ts`, all fields `null` today) is actually configured — never
  fabricated. Served at `GET /api/v1/organizations/:orgId/billing/invoices/:invoiceId/pdf`
  (customer, `requireBillingPrincipalAccess`-gated) and the matching `/api/v1/admin/organizations/
:orgId/billing/invoices/:invoiceId/pdf` (platform staff, `read_only_admin`+).
- **UI**: `/organization/billing`'s new Invoices panel (number/date/plan/amount/status/download);
  platform-admin's `BillingPanel.tsx` gets the matching read-only table — no separate accounting
  suite was built.
- **Security**: `subscription_invoices` has only a `select` RLS policy, scoped to the caller's own
  active org membership — no client INSERT/UPDATE/DELETE policy exists at all; every write goes
  through the service-role-only RPC or the service-role refund path. Verified live: 22/22 pgTAP
  assertions (`supabase/tests/subscription_invoices.test.sql` — classification, exact-amount,
  idempotency, cross-org isolation, no-client-write) plus 5/5 real route-level tests
  (`app/api/v1/organizations/[orgId]/billing/invoices/__tests__/route.access.test.ts`, a real
  Next.js route handler invoked against a real local Supabase instance, not mocked) proving Org B's
  principal is forbidden from both listing and downloading Org A's invoices even when supplying Org
  A's own `orgId` in the URL, and that an unauthenticated caller is rejected outright.

## Billing UX

- **Web** (`/organization/billing`, `OrganizationBillingView.tsx`): current plan/status/renewal
  date, plan comparison cards, a quote-then-confirm flow that shows "Due today" and "From [date]:
  R[amount]/month" BEFORE anything is charged (never a surprise charge), a distinct explanation
  for downgrades ("no refund... keep access until [date]") vs. upgrades ("access begins
  immediately once confirmed"), a pending-scheduled-downgrade panel with a "Keep current plan"
  cancel action, and the payment-history table. Every mutation re-checked server-side
  (`requireBillingPrincipalAccess`/`has_billing_principal_access()`) — the component itself
  enforces nothing.
- **Android** (V1 billing invoice pass, WORKLOG.md this date, closes TD-50): `DashboardScreen`
  (`apps/android/.../ui/dashboard/DashboardScreen.kt`) now has a "Manage subscription" action in
  its top app bar, gated to org principals only (`DashboardViewModel.isPrincipal`, mirroring the
  web billing page's own `role !== 'principal'` gate exactly) — a tenant-portal user never reaches
  this screen at all (`DashboardScreen` only renders inside `OwnerRootScreen`), and a non-principal
  owner-portal member (viewer/accountant/manager) does not see the action either. Tapping it opens
  `https://proplyst.co.za/organization/billing` via a plain `ACTION_VIEW` HTTPS Intent in the
  device browser — the same unauthenticated-link pattern already used elsewhere in the app
  (document/payment-proof links); there is no native→web session handoff (no token passed), so a
  user not already logged into the web app in their browser signs in there separately. Still
  deliberately **no Google Play Billing SDK, no in-app purchase flow** — Android continues to only
  ever open the existing web billing surface, never duplicate it. See the Google Play policy note
  immediately below for what remains a manual, non-code action before any Play Store submission.

### Google Play billing policy — manual review required before Play Store submission

**Not resolved by this pass, and not resolvable by guessing at Google Play policy text.** Flagged
here as an explicit, disclosed manual action for Mohammed (or whoever runs the Play Console
submission), not attempted in code:

- Proplyst Android (V1) provides property-management functionality (properties, tenants, leases,
  payments, maintenance, documents, compliance) to organizations that already have an active
  Proplyst subscription. It does **not** sell or upsell that subscription in-app — subscription
  purchase and management happen exclusively on the Proplyst web app, and the app's only
  in-app reference to it is the "Manage subscription" link above, which opens a browser tab.
- Google Play's policy on "payments" (real-money transactions for digital content/services
  consumed inside the app) has specific, and periodically revised, requirements about whether an
  app that gates its core functionality behind an external subscription must use Google Play's
  billing system, and what an app is allowed to say/link to about managing that subscription
  in-app. Whether Proplyst's specific case (a B2B property-management SaaS, not consumer digital
  content) is in-scope for those requirements, and whether a plain browser link like the one built
  here is acceptable as-is, requires an actual read of Google's current Payments policy (and
  ideally Play Console's own pre-submission policy checker) at submission time — not an assumption
  made in this pass.
- **Action required before Play Store submission**: review Google Play's current Payments policy
  and User Choice Billing requirements against Proplyst's actual model, using the Play Console's
  own policy status/pre-launch report tooling. If that review concludes Google Play Billing
  integration is required, that is new, not-yet-scoped Android work — do not build it speculatively
  before the review happens.

## Security

`has_billing_principal_access(org_id)` (migration `20260101000103`) — a narrow, billing-route-only
authorization primitive: true iff the caller holds an ACTIVE membership on the target org with
role exactly `principal`, and the org isn't archived. Deliberately does NOT consult
`organizations.status` the way `has_org_role()` does — a suspended/cancelled org's own principal
is exactly who needs to stay authorized here, so they can reactivate; every other org mutation
keeps using `has_org_role()`, which correctly still forces a suspended/cancelled org to
viewer-only.

`organization_subscriptions`/`subscription_payments`/`billing_plan_changes`/`billing_change_quotes`
each have ONLY a `select`-type RLS policy, scoped to the caller's own active org memberships — no
INSERT/UPDATE/DELETE policy exists for any authenticated client on any of the four tables. Every
write goes through a `security definer` RPC (which itself re-checks `has_billing_principal_access`)
or the service-role webhook/checkout code path. Proven live this pass with a new dedicated pgTAP
suite (`supabase/tests/billing_cross_org_isolation.test.sql`, 17 assertions): Org B's principal
cannot see or confirm Org A's billing rows; a non-principal member of Org A cannot request or
cancel a billing change for their own org; a direct client UPDATE/INSERT against any of the four
tables either throws (`42501`, no policy) or silently affects zero rows (verified unchanged) —
"customer cannot forge payment status" and "cannot edit invoice amount" hold structurally.
