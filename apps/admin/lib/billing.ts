import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BillingGatewayProvider } from '@propvault/types';
import { getBillingGatewayProvider } from './providers/billing';
import { dispatchEmail } from './emailDispatch';

// Organization-level SaaS billing service (SUBSCRIPTIONS.md) -- the one place subscription
// business logic lives, calling BillingGatewayProvider as its only dependency on a real vendor.
// Swapping the mock for a real PayFast/Yoco/Stitch provider means changing
// getBillingGatewayProvider()'s return value, never anything in this file.
//
// RELEASE A P0 (Phase 13, PayFast adapter boundary): the plan-change/proration RULES themselves
// live entirely in Postgres (migration 20260101000104's compute_plan_change_quote()/
// confirm_plan_change()) -- this file only ever passes the amount THAT ENGINE computed through to
// whichever BillingGatewayProvider is configured. When real PayFast credentials arrive later, only
// getBillingGatewayProvider()'s own selection (apps/admin/lib/providers/billing.ts) needs to
// change; nothing here or in the SQL engine needs to be rewritten.

/**
 * RELEASE A Phase 13: "production must NOT silently fall back to mock when a real payment is
 * expected." getBillingGatewayProvider() itself has always silently returned
 * MockBillingGatewayProvider whenever PayFast credentials are absent -- correct and necessary for
 * local dev/CI (which never has real credentials), but a real, disclosed risk if this ran in a
 * production deploy without them: a customer's checkout would "succeed" against a fake
 * `https://mock-gateway.invalid/...` URL with no real money ever collected. Gated on
 * `NODE_ENV === 'production'` specifically (not merely "provider is mock") so every existing local/
 * CI test -- none of which ever configure real PayFast credentials -- is completely unaffected.
 */
function assertRealPaymentGatewayAvailable(provider: BillingGatewayProvider): void {
  if (provider.providerName === 'mock' && process.env.NODE_ENV === 'production') {
    throw new Error(
      'billing_gateway_not_configured: PayFast merchant credentials are not configured in this production environment. Refusing to process what would be a real customer payment through the mock gateway.',
    );
  }
}

export interface StartCheckoutResult {
  checkoutUrl: string;
  providerSubscriptionId: string;
  subscriptionPaymentId: string;
}

/**
 * Creates (or reuses, via a deterministic idempotencyKey) a pending subscription + its first
 * subscription_payments row, then returns a checkout URL for staff to complete payment setup.
 * Always writes an organization_subscriptions row with status='trial' pending confirmation --
 * the webhook (processBillingWebhookEvent) is what ever moves it to 'active', never this call
 * itself (never trust the checkout-initiation response as proof of payment).
 */
export async function startSubscriptionCheckout(
  serviceClient: SupabaseClient,
  input: { orgId: string; planId: string; idempotencyKey: string },
): Promise<StartCheckoutResult> {
  const provider = getBillingGatewayProvider();
  assertRealPaymentGatewayAvailable(provider);

  const { data: org, error: orgError } = await serviceClient
    .from('organizations')
    .select('id, legal_name')
    .eq('id', input.orgId)
    .single();
  if (orgError || !org) throw new Error(orgError?.message ?? 'Organization not found');

  const { data: plan, error: planError } = await serviceClient
    .from('plans')
    .select('*')
    .eq('id', input.planId)
    .single();
  if (planError || !plan) throw new Error(planError?.message ?? 'Plan not found');

  const customer = await provider.createCustomer({
    orgId: org.id,
    legalName: org.legal_name,
    email: `billing+${org.id}@proplyst.example`,
  });
  const subscription = await provider.createSubscription({
    orgId: org.id,
    providerCustomerId: customer.providerCustomerId,
    planCode: plan.code,
    amount: plan.base_price,
    currency: plan.currency,
    billingCycle: plan.billing_cycle,
    idempotencyKey: input.idempotencyKey,
  });

  const periodStart = new Date().toISOString().slice(0, 10);
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: orgSubscription, error: subInsertError } = await serviceClient
    .from('organization_subscriptions')
    .insert({
      org_id: org.id,
      plan_id: plan.id,
      billing_cycle: plan.billing_cycle,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      next_payment_date: periodEnd,
      status: 'trial',
    })
    .select('id')
    .single();
  if (subInsertError || !orgSubscription)
    throw new Error(subInsertError?.message ?? 'Failed to create subscription');

  const { data: payment, error: paymentInsertError } = await serviceClient
    .from('subscription_payments')
    .insert({
      org_id: org.id,
      subscription_id: orgSubscription.id,
      amount: plan.base_price,
      currency: plan.currency,
      status: 'pending',
      provider_reference: subscription.providerSubscriptionId,
    })
    .select('id')
    .single();
  if (paymentInsertError || !payment)
    throw new Error(paymentInsertError?.message ?? 'Failed to create pending payment');

  return {
    checkoutUrl: subscription.checkoutUrl,
    providerSubscriptionId: subscription.providerSubscriptionId,
    subscriptionPaymentId: payment.id,
  };
}

export interface StartPlanChangeCheckoutResult {
  checkoutUrl: string;
  providerSubscriptionId: string;
  subscriptionPaymentId: string;
  billingPlanChangeId: string;
}

/**
 * RELEASE A: collects a real payment for a plan change whose confirm_plan_change() call (migration
 * 20260101000104) came back `awaiting_payment` -- an upgrade or reactivation with a nonzero
 * amount_due_now. Deliberately distinct from startSubscriptionCheckout(): it charges the
 * SERVER-COMPUTED prorated `amountDueNow` (never plan.base_price), and links the resulting
 * subscription_payments row to the billing_plan_changes row via `billing_plan_change_id` so
 * processBillingWebhookEvent can apply the actual target plan once payment is confirmed, rather
 * than creating a brand new organization_subscriptions row the way a first-time checkout does --
 * an existing, paying org already has one; this reuses it (its plan_id only flips on confirmed
 * payment, see below).
 */
export async function startPlanChangeCheckout(
  serviceClient: SupabaseClient,
  input: {
    orgId: string;
    billingPlanChangeId: string;
    targetPlanId: string;
    amountDueNow: number;
    idempotencyKey: string;
  },
): Promise<StartPlanChangeCheckoutResult> {
  const provider = getBillingGatewayProvider();
  assertRealPaymentGatewayAvailable(provider);

  const { data: org, error: orgError } = await serviceClient
    .from('organizations')
    .select('id, legal_name')
    .eq('id', input.orgId)
    .single();
  if (orgError || !org) throw new Error(orgError?.message ?? 'Organization not found');

  const { data: plan, error: planError } = await serviceClient
    .from('plans')
    .select('*')
    .eq('id', input.targetPlanId)
    .single();
  if (planError || !plan) throw new Error(planError?.message ?? 'Plan not found');

  const { data: currentSubscription, error: subFetchError } = await serviceClient
    .from('organization_subscriptions')
    .select('id')
    .eq('org_id', input.orgId)
    .order('current_period_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subFetchError) throw new Error(subFetchError.message);

  const customer = await provider.createCustomer({
    orgId: org.id,
    legalName: org.legal_name,
    email: `billing+${org.id}@proplyst.example`,
  });
  const subscription = await provider.createSubscription({
    orgId: org.id,
    providerCustomerId: customer.providerCustomerId,
    planCode: plan.code,
    // The server-computed prorated amount -- NEVER plan.base_price. This is the entire point of
    // the proration engine: the customer is charged only the difference, not the full new price.
    amount: input.amountDueNow,
    currency: plan.currency,
    billingCycle: plan.billing_cycle,
    idempotencyKey: input.idempotencyKey,
  });

  let subscriptionId = currentSubscription?.id;
  if (!subscriptionId) {
    // Reactivation of an org with no prior organization_subscriptions row at all (should not
    // normally happen -- reactivation implies a prior subscription -- but handled defensively
    // rather than assumed impossible) -- a fresh row, on the OLD/current plan_id until payment
    // confirms, exactly like startSubscriptionCheckout's own posture.
    const periodStart = new Date().toISOString().slice(0, 10);
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: newSub, error: newSubError } = await serviceClient
      .from('organization_subscriptions')
      .insert({
        org_id: org.id,
        plan_id: plan.id,
        billing_cycle: plan.billing_cycle,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        next_payment_date: periodEnd,
        status: 'trial',
      })
      .select('id')
      .single();
    if (newSubError || !newSub)
      throw new Error(newSubError?.message ?? 'Failed to create subscription');
    subscriptionId = newSub.id;
  }

  const { data: payment, error: paymentInsertError } = await serviceClient
    .from('subscription_payments')
    .insert({
      org_id: org.id,
      subscription_id: subscriptionId,
      amount: input.amountDueNow,
      currency: plan.currency,
      status: 'pending',
      provider_reference: subscription.providerSubscriptionId,
      billing_plan_change_id: input.billingPlanChangeId,
    })
    .select('id')
    .single();
  if (paymentInsertError || !payment)
    throw new Error(paymentInsertError?.message ?? 'Failed to create pending payment');

  return {
    checkoutUrl: subscription.checkoutUrl,
    providerSubscriptionId: subscription.providerSubscriptionId,
    subscriptionPaymentId: payment.id,
    billingPlanChangeId: input.billingPlanChangeId,
  };
}

export interface ProcessWebhookResult {
  alreadyProcessed: boolean;
  eventType?: string;
}

/**
 * The idempotent webhook receiver: verifies the signature, parses the event, and inserts into
 * billing_events first -- if that insert hits the (provider_name, provider_event_id) unique
 * constraint, the event was already processed (a gateway retry) and this returns immediately
 * without touching subscription_payments/organization_subscriptions/organizations a second time.
 */
export async function processBillingWebhookEvent(
  serviceClient: SupabaseClient,
  input: { rawBody: string; signatureHeader: string | null },
): Promise<ProcessWebhookResult> {
  const provider = getBillingGatewayProvider();

  if (!(await provider.verifyWebhookSignature(input.rawBody, input.signatureHeader))) {
    throw new Error('Invalid webhook signature');
  }

  const event = provider.parseWebhookEvent(input.rawBody);

  const { data: payment } = await serviceClient
    .from('subscription_payments')
    .select('id, org_id, subscription_id, billing_plan_change_id')
    .eq('provider_reference', event.providerReference)
    .maybeSingle();

  const orgId = event.orgId ?? payment?.org_id;
  if (!orgId) throw new Error(`Cannot resolve org_id for billing event ${event.providerEventId}`);

  const { error: insertError } = await serviceClient.from('billing_events').insert({
    org_id: orgId,
    provider_name: provider.providerName,
    provider_event_id: event.providerEventId,
    event_type: event.type,
    payload: event.raw,
  });

  if (insertError) {
    // 23505 = unique_violation -- this exact event was already processed, a gateway retry.
    // Anything else is a real error and must propagate.
    if (insertError.code === '23505') {
      return { alreadyProcessed: true };
    }
    throw new Error(insertError.message);
  }

  if (payment) {
    const paymentStatus =
      event.type === 'payment_succeeded'
        ? 'paid'
        : event.type === 'refund_processed'
          ? 'refunded'
          : event.type === 'payment_failed'
            ? 'failed'
            : null;
    if (paymentStatus) {
      await serviceClient
        .from('subscription_payments')
        .update({
          status: paymentStatus,
          paid_at: paymentStatus === 'paid' ? new Date().toISOString() : null,
        })
        .eq('id', payment.id);
    }

    if (event.type === 'payment_succeeded') {
      const subscriptionUpdate: Record<string, unknown> = { status: 'active' };
      // Captured once, never overwritten with null by a later event that doesn't carry a token
      // (e.g. a recurring charge's ITN after the first one) -- only ever set on a genuine value.
      if (event.providerSubscriptionToken) {
        subscriptionUpdate.provider_subscription_token = event.providerSubscriptionToken;
      }
      await serviceClient
        .from('organization_subscriptions')
        .update(subscriptionUpdate)
        .eq('id', payment.subscription_id);
      // Clears overdue_since (not just status) -- a recovered org must re-enter the full 7-day
      // grace period if it goes overdue again later, not resume a clock left over from last time.
      await serviceClient
        .from('organizations')
        .update({ status: 'active', overdue_since: null })
        .eq('id', orgId);

      // RELEASE A: completes a deferred upgrade/reactivation -- this payment was collecting a
      // billing_plan_changes.status = 'awaiting_payment' amount (startPlanChangeCheckout), so the
      // actual entitlement flip (plan_id) happens HERE, on confirmed payment, never before it.
      // "Upgrade access becomes effective immediately" means immediately upon payment confirmation,
      // not before -- granting a paid-tier entitlement before money has actually moved would be a
      // real revenue-integrity gap, not a feature.
      if (payment.billing_plan_change_id) {
        const { data: pendingChange } = await serviceClient
          .from('billing_plan_changes')
          .select('id, new_plan_id, status')
          .eq('id', payment.billing_plan_change_id)
          .maybeSingle();
        if (pendingChange && pendingChange.status === 'awaiting_payment') {
          await serviceClient
            .from('organization_subscriptions')
            .update({ plan_id: pendingChange.new_plan_id })
            .eq('id', payment.subscription_id);
          await serviceClient
            .from('billing_plan_changes')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', pendingChange.id);
        }
      }
    } else if (event.type === 'payment_failed' && payment.billing_plan_change_id) {
      // RELEASE A: a failed UPGRADE/REACTIVATION payment is a materially different situation than
      // a failed RECURRING subscription charge (the branch below) -- the org's own current,
      // already-paid-for plan is completely unaffected; only the plan-change attempt itself
      // failed. Marks the plan change failed and deliberately does NOT touch organizations.status
      // or the overdue grace period at all -- the customer simply keeps using what they already
      // have and can retry the upgrade.
      await serviceClient
        .from('billing_plan_changes')
        .update({ status: 'failed', failure_reason: 'Gateway payment failed' })
        .eq('id', payment.billing_plan_change_id)
        .eq('status', 'awaiting_payment');
    } else if (event.type === 'payment_failed') {
      // Anchors expire_trials_and_suspend_overdue()'s 7-day grace period (20260101000076). Only
      // set on the FIRST failure while already overdue -- a second failed retry before the org
      // recovers must not push the grace-period clock forward, or an org that keeps failing every
      // few days would never actually reach the suspend threshold.
      const { data: currentOrg } = await serviceClient
        .from('organizations')
        .select('status, overdue_since')
        .eq('id', orgId)
        .single();
      await serviceClient
        .from('organizations')
        .update({
          status: 'overdue',
          overdue_since: currentOrg?.overdue_since ?? new Date().toISOString(),
        })
        .eq('id', orgId);

      // Notify the org's principal -- a failed subscription charge is exactly the kind of event
      // EMAIL.md §1's "Billing (platform)" category names ("payment failed"). Never blocks/fails
      // the webhook response -- same "log, don't throw" boundary as every other dispatch site.
      try {
        const { data: principal } = await serviceClient
          .from('organization_members')
          .select('user_id')
          .eq('org_id', orgId)
          .eq('role', 'principal')
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();
        if (principal) {
          const { data: authUser } = await serviceClient.auth.admin.getUserById(principal.user_id);
          await dispatchEmail(serviceClient, {
            orgId,
            toAddress: authUser?.user?.email ?? null,
            templateName: 'subscription_payment_issue',
            templateVars: { providerReference: event.providerReference },
            // relatedEntityType carries the specific event id (text column) since orgId is the
            // only real uuid available here -- one failed-payment email per distinct gateway
            // event, not one ever per org.
            relatedEntityType: `billing_event:${event.providerEventId}`,
            relatedEntityId: orgId,
            actorUserId: null,
          });
        }
      } catch (err) {
        console.error('[emailDispatch] subscription_payment_issue dispatch failed', err);
      }
    } else if (event.type === 'subscription_cancelled') {
      await serviceClient
        .from('organization_subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', payment.subscription_id);
      await serviceClient.from('organizations').update({ status: 'cancelled' }).eq('id', orgId);
    }
  }

  return { alreadyProcessed: false, eventType: event.type };
}

/**
 * Explicit, staff- or principal-triggered cancellation (as opposed to a gateway-reported one via
 * webhook). Resolves the gateway's own recurring-billing token from
 * organization_subscriptions.provider_subscription_token itself (captured by
 * processBillingWebhookEvent from the org's first successful payment ITN) -- callers never handle
 * a raw gateway token, matching the "no DB access from a provider class, no gateway-internal
 * details in API contracts" boundary used throughout this codebase.
 */
export async function cancelOrgSubscription(
  serviceClient: SupabaseClient,
  input: { orgId: string; actorUserId?: string },
): Promise<{ alreadyCancelled: boolean }> {
  const provider = getBillingGatewayProvider();

  const { data: current, error } = await serviceClient
    .from('organization_subscriptions')
    .select(
      'id, plan_id, status, provider_subscription_token, current_period_start, current_period_end',
    )
    .eq('org_id', input.orgId)
    .order('current_period_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!current) throw new Error(`Organization ${input.orgId} has no subscription to cancel`);

  // RELEASE A P0 (Phase 12, idempotency): a double-click/browser-retry of cancel must not call the
  // gateway's own cancel-subscription API twice or write a second audit row -- already-cancelled
  // is treated as a successful no-op, matching cancel_pending_plan_change()'s own established
  // "cancel is safe to call even if already cancelled" convention.
  if (current.status === 'cancelled') {
    return { alreadyCancelled: true };
  }

  if (!current.provider_subscription_token) {
    throw new Error(
      `Organization ${input.orgId}'s subscription has no gateway token on record yet (no successful payment has been processed) -- nothing to cancel at the gateway.`,
    );
  }

  await provider.cancelSubscription(current.provider_subscription_token);
  await serviceClient
    .from('organization_subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', current.id);
  await serviceClient.from('organizations').update({ status: 'cancelled' }).eq('id', input.orgId);

  // RELEASE A P0 (Phase 11, audit trail): explicit cancellation dates -- requested_at is now(),
  // effective_at is also now() (this codebase's cancellation is immediate, not end-of-period --
  // preserving the existing intended lifecycle exactly as instructed, not changing it).
  await serviceClient.from('billing_plan_changes').insert({
    org_id: input.orgId,
    actor_user_id: input.actorUserId ?? null,
    change_type: 'cancellation',
    old_plan_id: current.plan_id,
    new_plan_id: null,
    period_start: current.current_period_start,
    period_end: current.current_period_end,
    charge_due: 0,
    status: 'completed',
    effective_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  return { alreadyCancelled: false };
}

/** Explicit, staff-triggered refund of a specific payment. */
export async function refundSubscriptionPayment(
  serviceClient: SupabaseClient,
  input: { subscriptionPaymentId: string; idempotencyKey: string },
): Promise<void> {
  const provider = getBillingGatewayProvider();

  const { data: payment, error } = await serviceClient
    .from('subscription_payments')
    .select('*')
    .eq('id', input.subscriptionPaymentId)
    .single();
  if (error || !payment) throw new Error(error?.message ?? 'Payment not found');
  if (payment.status !== 'paid')
    throw new Error(
      `Payment ${input.subscriptionPaymentId} is not paid (status: ${payment.status})`,
    );
  if (!payment.provider_reference)
    throw new Error('Payment has no provider_reference to refund against');

  await provider.refundPayment({
    providerPaymentReference: payment.provider_reference,
    idempotencyKey: input.idempotencyKey,
  });

  await serviceClient
    .from('subscription_payments')
    .update({ status: 'refunded' })
    .eq('id', input.subscriptionPaymentId);
}
