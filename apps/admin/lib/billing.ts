import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBillingGatewayProvider } from './providers/billing';
import { dispatchEmail } from './emailDispatch';

// Organization-level SaaS billing service (SUBSCRIPTIONS.md) -- the one place subscription
// business logic lives, calling BillingGatewayProvider as its only dependency on a real vendor.
// Swapping the mock for a real PayFast/Yoco/Stitch provider means changing
// getBillingGatewayProvider()'s return value, never anything in this file.

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

  const customer = await provider.createCustomer({ orgId: org.id, legalName: org.legal_name, email: `billing+${org.id}@proplyst.example` });
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
  if (subInsertError || !orgSubscription) throw new Error(subInsertError?.message ?? 'Failed to create subscription');

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
  if (paymentInsertError || !payment) throw new Error(paymentInsertError?.message ?? 'Failed to create pending payment');

  return {
    checkoutUrl: subscription.checkoutUrl,
    providerSubscriptionId: subscription.providerSubscriptionId,
    subscriptionPaymentId: payment.id,
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
    .select('id, org_id, subscription_id')
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
      event.type === 'payment_succeeded' ? 'paid' : event.type === 'refund_processed' ? 'refunded' : event.type === 'payment_failed' ? 'failed' : null;
    if (paymentStatus) {
      await serviceClient
        .from('subscription_payments')
        .update({ status: paymentStatus, paid_at: paymentStatus === 'paid' ? new Date().toISOString() : null })
        .eq('id', payment.id);
    }

    if (event.type === 'payment_succeeded') {
      const subscriptionUpdate: Record<string, unknown> = { status: 'active' };
      // Captured once, never overwritten with null by a later event that doesn't carry a token
      // (e.g. a recurring charge's ITN after the first one) -- only ever set on a genuine value.
      if (event.providerSubscriptionToken) {
        subscriptionUpdate.provider_subscription_token = event.providerSubscriptionToken;
      }
      await serviceClient.from('organization_subscriptions').update(subscriptionUpdate).eq('id', payment.subscription_id);
      // Clears overdue_since (not just status) -- a recovered org must re-enter the full 7-day
      // grace period if it goes overdue again later, not resume a clock left over from last time.
      await serviceClient.from('organizations').update({ status: 'active', overdue_since: null }).eq('id', orgId);
    } else if (event.type === 'payment_failed') {
      // Anchors expire_trials_and_suspend_overdue()'s 7-day grace period (20260101000076). Only
      // set on the FIRST failure while already overdue -- a second failed retry before the org
      // recovers must not push the grace-period clock forward, or an org that keeps failing every
      // few days would never actually reach the suspend threshold.
      const { data: currentOrg } = await serviceClient.from('organizations').select('status, overdue_since').eq('id', orgId).single();
      await serviceClient
        .from('organizations')
        .update({ status: 'overdue', overdue_since: currentOrg?.overdue_since ?? new Date().toISOString() })
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
      await serviceClient.from('organization_subscriptions').update({ status: 'cancelled' }).eq('id', payment.subscription_id);
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
export async function cancelOrgSubscription(serviceClient: SupabaseClient, input: { orgId: string }): Promise<void> {
  const provider = getBillingGatewayProvider();

  const { data: current, error } = await serviceClient
    .from('organization_subscriptions')
    .select('id, provider_subscription_token')
    .eq('org_id', input.orgId)
    .order('current_period_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!current) throw new Error(`Organization ${input.orgId} has no subscription to cancel`);
  if (!current.provider_subscription_token) {
    throw new Error(
      `Organization ${input.orgId}'s subscription has no gateway token on record yet (no successful payment has been processed) -- nothing to cancel at the gateway.`,
    );
  }

  await provider.cancelSubscription(current.provider_subscription_token);
  await serviceClient.from('organization_subscriptions').update({ status: 'cancelled' }).eq('id', current.id);
  await serviceClient.from('organizations').update({ status: 'cancelled' }).eq('id', input.orgId);
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
  if (payment.status !== 'paid') throw new Error(`Payment ${input.subscriptionPaymentId} is not paid (status: ${payment.status})`);
  if (!payment.provider_reference) throw new Error('Payment has no provider_reference to refund against');

  await provider.refundPayment({ providerPaymentReference: payment.provider_reference, idempotencyKey: input.idempotencyKey });

  await serviceClient.from('subscription_payments').update({ status: 'refunded' }).eq('id', input.subscriptionPaymentId);
}
