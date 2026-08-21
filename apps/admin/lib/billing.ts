import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BillingGatewayProvider, BillingWebhookEvent } from '@propvault/types';
import { getBillingGatewayProvider } from './providers/billing';
import { dispatchEmail, type EmailTemplateName } from './emailDispatch';

/** V1 communications productionisation (WORKLOG.md this date): every billing lifecycle email
 * below is sent to the org's principal -- resolves the same way regardless of whether the caller
 * has a live browser session (a route confirming its own request already has `user.email`
 * directly) or not (a webhook has only a service client). Centralised here since 4 separate call
 * sites in this file need it. */
async function resolveOrgPrincipalEmail(
  serviceClient: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data: principal } = await serviceClient
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'principal')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (!principal) return null;
  const { data: authUser } = await serviceClient.auth.admin.getUserById(principal.user_id);
  return authUser?.user?.email ?? null;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Fires the one lifecycle email that corresponds to a completed billing_plan_changes row --
 * shared by confirm-change/route.ts (a synchronous, no-payment-required change: a $0 upgrade, a
 * downgrade, or a $0 reactivation) and processBillingWebhookEvent below (an upgrade/reactivation
 * that required real payment, confirmed by the gateway webhook). Both call sites already know
 * which plan changed and to whom; this only owns "which template for which change_type" and the
 * actual dispatchEmail() call, so that mapping exists in exactly one place. */
export async function dispatchPlanChangeLifecycleEmail(
  serviceClient: SupabaseClient,
  input: {
    orgId: string;
    billingPlanChangeId: string;
    changeType: string;
    newPlanId: string;
    amountDueNow: number;
    effectiveAt: string;
    toEmail: string | null;
  },
): Promise<void> {
  const template: EmailTemplateName | null =
    input.changeType === 'upgrade'
      ? 'plan_upgraded'
      : input.changeType === 'downgrade'
        ? 'plan_downgrade_scheduled'
        : input.changeType === 'reactivation'
          ? 'subscription_reactivated'
          : input.changeType === 'new_subscription'
            ? 'subscription_activated'
            : null; // 'no_change' -- nothing meaningful happened, no email
  if (!template) return;

  try {
    const { data: plan } = await serviceClient
      .from('plans')
      .select('name, base_price, currency')
      .eq('id', input.newPlanId)
      .maybeSingle();
    if (!plan) return;

    await dispatchEmail(serviceClient, {
      orgId: input.orgId,
      toAddress: input.toEmail,
      templateName: template,
      templateVars: {
        planName: plan.name,
        amountDueNow: formatMoney(input.amountDueNow, plan.currency),
        nextRenewalAmount: formatMoney(plan.base_price, plan.currency),
        effectiveAt: input.effectiveAt,
      },
      relatedEntityType: 'billing_plan_change',
      relatedEntityId: input.billingPlanChangeId,
      actorUserId: null,
    });
  } catch (err) {
    console.error('[emailDispatch] plan-change lifecycle email dispatch failed', err);
  }
}

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

export interface StartTrialActivationCheckoutResult {
  checkoutUrl: string;
  providerSubscriptionId: string;
  subscriptionPaymentId: string;
}

/**
 * Commercial plan restructure -- the one entry point for a brand-new, not-yet-set-up
 * organization's principal to select a plan tier + billing interval and hand off to PayFast to
 * register a real, verifiable payment method. Charges nothing now (createSubscription's
 * initialAmount: 0, billingDate 30 days out defers the real first recurring charge) -- and never
 * starts the trial itself: activate_trial_after_payment() only ever runs from
 * processBillingWebhookEvent's trial-activation branch below, once PayFast's own verified ITN
 * confirms the payment method actually works. Matches this file's own established principle
 * ("never trust the checkout-initiation response as proof of payment") applied to trial
 * activation, not just paid activation.
 *
 * Deliberately does not accept a planId or amount from the caller (Phase 6, server-authoritative
 * pricing) -- planTier + interval resolve to the exact active `plans` row and its price here,
 * the only place that lookup happens; a client cannot influence what gets charged.
 */
export async function startTrialActivationCheckout(
  serviceClient: SupabaseClient,
  input: {
    orgId: string;
    principalUserId: string;
    planTier: 'starter' | 'professional' | 'business';
    interval: 'monthly' | 'annual';
    idempotencyKey: string;
  },
): Promise<StartTrialActivationCheckoutResult> {
  const provider = getBillingGatewayProvider();
  assertRealPaymentGatewayAvailable(provider);

  const { data: org, error: orgError } = await serviceClient
    .from('organizations')
    .select('id, legal_name, commercial_setup_completed_at')
    .eq('id', input.orgId)
    .single();
  if (orgError || !org) throw new Error(orgError?.message ?? 'Organization not found');
  if (org.commercial_setup_completed_at) {
    throw new Error(
      'commercial_setup_already_complete: this organization has already completed payment-method setup.',
    );
  }

  // Server-authoritative plan resolution -- `code` follows this codebase's own convention
  // (20260101000111): `${tier}_${interval}`, e.g. "professional_annual".
  const planCode = `${input.planTier}_${input.interval}`;
  const { data: plan, error: planError } = await serviceClient
    .from('plans')
    .select('*')
    .eq('code', planCode)
    .eq('is_active', true)
    .single();
  if (planError || !plan)
    throw new Error(planError?.message ?? `Plan not found or inactive: ${planCode}`);

  // Trial eligibility, checked here as an early, honest rejection before sending the customer to
  // PayFast at all -- re-checked again, more completely, at actual activation time below (the
  // real payment_provider_reference only exists once PayFast responds), so this first check is
  // never the sole gate, only a faster no for an already-known-ineligible principal.
  const { data: alreadyUsed } = await serviceClient.rpc('has_used_trial_before', {
    p_principal_user_id: input.principalUserId,
  });
  if (alreadyUsed) {
    throw new Error('trial_not_eligible: a free trial has already been used by this account.');
  }

  const customer = await provider.createCustomer({
    orgId: org.id,
    legalName: org.legal_name,
    email: `billing+${org.id}@proplyst.example`,
  });

  const billingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const subscription = await provider.createSubscription({
    orgId: org.id,
    providerCustomerId: customer.providerCustomerId,
    planCode: plan.code,
    amount: Number(plan.base_price),
    initialAmount: 0,
    billingDate,
    currency: plan.currency,
    billingCycle: plan.billing_cycle,
    idempotencyKey: input.idempotencyKey,
  });

  const periodStart = new Date().toISOString().slice(0, 10);
  const periodEnd = billingDate;

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
      amount: 0,
      currency: plan.currency,
      status: 'pending',
      provider_reference: subscription.providerSubscriptionId,
      purpose: 'trial_activation',
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

export interface StartPaymentMethodUpdateCheckoutResult {
  checkoutUrl: string;
  providerSubscriptionId: string;
  subscriptionPaymentId: string;
}

/**
 * V1 commercial onboarding pass, Phase 18 -- lets an org that has ALREADY completed commercial
 * setup add/replace its payment method (a failed/expired card, or a customer just wants to switch
 * cards). Deliberately a separate function from startTrialActivationCheckout(), which explicitly
 * refuses to run again once commercial_setup_completed_at is set -- this one requires the exact
 * opposite precondition, and its webhook branch (processBillingWebhookEvent, purpose ===
 * 'payment_method_update') never calls activate_trial_after_payment() or record_trial_usage():
 * a card update must not restart, extend, or re-grant a trial.
 */
export async function startPaymentMethodUpdateCheckout(
  serviceClient: SupabaseClient,
  input: { orgId: string; idempotencyKey: string },
): Promise<StartPaymentMethodUpdateCheckoutResult> {
  const provider = getBillingGatewayProvider();
  assertRealPaymentGatewayAvailable(provider);

  const { data: org, error: orgError } = await serviceClient
    .from('organizations')
    .select('id, legal_name, commercial_setup_completed_at')
    .eq('id', input.orgId)
    .single();
  if (orgError || !org) throw new Error(orgError?.message ?? 'Organization not found');
  if (!org.commercial_setup_completed_at) {
    throw new Error(
      'commercial_setup_not_complete: complete initial payment-method setup before updating your payment method.',
    );
  }

  const { data: subscription, error: subError } = await serviceClient
    .from('organization_subscriptions')
    .select('id, plan_id, billing_cycle')
    .eq('org_id', input.orgId)
    .order('current_period_start', { ascending: false })
    .limit(1)
    .single();
  if (subError || !subscription)
    throw new Error(subError?.message ?? 'This organization has no subscription on record.');

  const { data: plan, error: planError } = await serviceClient
    .from('plans')
    .select('code, base_price, currency')
    .eq('id', subscription.plan_id)
    .single();
  if (planError || !plan) throw new Error(planError?.message ?? 'Plan not found');

  const customer = await provider.createCustomer({
    orgId: org.id,
    legalName: org.legal_name,
    email: `billing+${org.id}@proplyst.example`,
  });

  // Same R0-plus-billing_date shape as the original trial-activation checkout (the ONLY
  // real-gateway-verified way this codebase has to confirm a card actually works) -- but
  // billing_date here is intentionally the org's OWN next_payment_date, not a fresh +30 days:
  // this is a card replacement, not a new trial, so it must not imply a new billing cycle either.
  const { data: subDates } = await serviceClient
    .from('organization_subscriptions')
    .select('next_payment_date')
    .eq('id', subscription.id)
    .single();
  const billingDate =
    subDates?.next_payment_date ??
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const gatewaySubscription = await provider.createSubscription({
    orgId: org.id,
    providerCustomerId: customer.providerCustomerId,
    planCode: plan.code,
    amount: Number(plan.base_price),
    initialAmount: 0,
    billingDate,
    currency: plan.currency,
    billingCycle: subscription.billing_cycle,
    idempotencyKey: input.idempotencyKey,
  });

  const { data: payment, error: paymentInsertError } = await serviceClient
    .from('subscription_payments')
    .insert({
      org_id: org.id,
      subscription_id: subscription.id,
      amount: 0,
      currency: plan.currency,
      status: 'pending',
      provider_reference: gatewaySubscription.providerSubscriptionId,
      purpose: 'payment_method_update',
    })
    .select('id')
    .single();
  if (paymentInsertError || !payment)
    throw new Error(paymentInsertError?.message ?? 'Failed to create pending payment');

  return {
    checkoutUrl: gatewaySubscription.checkoutUrl,
    providerSubscriptionId: gatewaySubscription.providerSubscriptionId,
    subscriptionPaymentId: payment.id,
  };
}

/**
 * Commercial plan restructure -- records (or replaces) an org's verified payment method from a
 * real gateway confirmation. Never stores raw card data (PAN/CVV): only the provider-safe
 * metadata a gateway's own webhook/API actually exposes. PayFast's subscription ITN payload does
 * not carry card brand/last4/expiry (confirmed against parseWebhookEvent's own field list) --
 * those columns are left null rather than fabricated. Exported so a future dedicated
 * card-replacement route can call it directly: marks any existing active method 'replaced' first,
 * inserts the new one as active/default, and never touches organizations/trial state -- a later
 * card update is safe to run through this same function without resetting the trial clock or
 * restarting commercial setup.
 */
export async function persistPaymentMethod(
  serviceClient: SupabaseClient,
  input: { orgId: string; provider: string; providerReference: string | null },
): Promise<void> {
  await serviceClient
    .from('payment_methods')
    .update({ status: 'replaced', is_default: false })
    .eq('org_id', input.orgId)
    .eq('status', 'active');

  await serviceClient.from('payment_methods').insert({
    org_id: input.orgId,
    provider: input.provider,
    provider_reference: input.providerReference,
    status: 'active',
    is_default: true,
  });
}

/**
 * Commercial plan restructure -- handles a webhook event for a trial-activation-purpose payment
 * row BEFORE the organization has completed commercial setup (processBillingWebhookEvent checks
 * organizations.commercial_setup_completed_at before ever calling this, so a later real recurring
 * charge on the same row -- once setup has completed -- never reaches this function; it falls
 * through to the existing payment_succeeded handling unchanged).
 */
async function handleTrialActivationWebhookEvent(
  serviceClient: SupabaseClient,
  input: {
    orgId: string;
    payment: { id: string; subscription_id: string };
    event: BillingWebhookEvent;
  },
): Promise<ProcessWebhookResult> {
  const { orgId, payment, event } = input;

  if (event.type === 'payment_failed' || event.type === 'subscription_cancelled') {
    // Payment-method setup failed or was cancelled -- leave the org in "setup required" (no
    // trial starts, commercial_setup_completed_at stays null), mark the attempt failed so the
    // setup UI can offer a clean retry. No fake success is ever synthesized from browser return
    // state -- this is the only thing that can mark a setup attempt failed.
    await serviceClient
      .from('subscription_payments')
      .update({ status: 'failed' })
      .eq('id', payment.id);
    return { alreadyProcessed: false, eventType: event.type };
  }

  if (event.type !== 'payment_succeeded') {
    return { alreadyProcessed: false, eventType: event.type };
  }

  const { data: principalRows } = await serviceClient
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'principal')
    .eq('status', 'active')
    .limit(1);
  const principalUserId = principalRows?.[0]?.user_id as string | undefined;

  // Defense-in-depth re-check of trial eligibility, immediately before activation -- the
  // checkout-initiation check (startTrialActivationCheckout) already ran once with less
  // information; this is the actual, server-verified moment a trial is granted, now including
  // the real payment_provider_reference PayFast has confirmed.
  if (principalUserId) {
    const { data: alreadyUsed } = await serviceClient.rpc('has_used_trial_before', {
      p_principal_user_id: principalUserId,
      p_payment_provider_reference: event.providerReference,
    });
    if (alreadyUsed) {
      console.error(
        '[billing] trial-activation webhook: eligibility re-check failed at activation time -- refusing to start trial',
        { orgId, principalUserId },
      );
      await serviceClient
        .from('subscription_payments')
        .update({ status: 'failed' })
        .eq('id', payment.id);
      return { alreadyProcessed: false, eventType: event.type };
    }
  }

  await persistPaymentMethod(serviceClient, {
    orgId,
    provider: 'payfast',
    providerReference: event.providerSubscriptionToken ?? event.providerReference,
  });

  await serviceClient.rpc('activate_trial_after_payment', { p_org_id: orgId });

  if (principalUserId) {
    await serviceClient.rpc('record_trial_usage', {
      p_org_id: orgId,
      p_principal_user_id: principalUserId,
      p_payment_provider_reference: event.providerReference,
    });
  }

  if (event.providerSubscriptionToken) {
    await serviceClient
      .from('organization_subscriptions')
      .update({ provider_subscription_token: event.providerSubscriptionToken })
      .eq('id', payment.subscription_id);
  }

  // Payment amount semantics (V1 commercial onboarding pass): this row's `amount` permanently
  // records what was ACTUALLY collected for THIS transaction -- R0 for a trial-activation
  // checkout -- and is never mutated afterward. The REAL recurring charge PayFast collects on
  // billing_date reuses the same provider_reference (PayFast's m_payment_id is stable for a
  // subscription's whole lifetime) but is treated as a genuinely separate financial event: since
  // this row's status is about to become 'paid' (not 'pending'), processBillingWebhookEvent's own
  // "status is not pending" rule creates a BRAND NEW subscription_payments row for that later
  // charge rather than overwriting this one -- see that function's own comment for why. A customer
  // must never see "R299 paid" on the date they actually paid R0.
  await serviceClient
    .from('subscription_payments')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', payment.id);

  // A real financial event (card verified, R0 collected) deserves a real invoice/receipt --
  // create_subscription_invoice_for_payment() (migration 20260101000108) reads this row's own
  // amount directly, which is correctly 0 now that it's never mutated; logged, not thrown, on
  // failure, matching the identical try/catch posture the main payment_succeeded branch below
  // already uses for the same call.
  try {
    await serviceClient.rpc('create_subscription_invoice_for_payment', { p_payment_id: payment.id });
  } catch (err) {
    console.error('[billing] trial-activation invoice creation failed', {
      paymentId: payment.id,
      orgId,
      err,
    });
  }

  try {
    const toEmail = await resolveOrgPrincipalEmail(serviceClient, orgId);
    const { data: orgRow } = await serviceClient
      .from('organizations')
      .select('legal_name, trial_ends_at')
      .eq('id', orgId)
      .single();
    await dispatchEmail(serviceClient, {
      orgId,
      toAddress: toEmail,
      templateName: 'subscription_activated',
      templateVars: { legalName: orgRow?.legal_name, trialEndsAt: orgRow?.trial_ends_at },
      relatedEntityType: `billing_event:${event.providerEventId}`,
      relatedEntityId: orgId,
      actorUserId: null,
    });
  } catch (err) {
    console.error('[emailDispatch] trial-activation lifecycle email dispatch failed', err);
  }

  return { alreadyProcessed: false, eventType: event.type };
}

/**
 * V1 commercial onboarding pass, Phase 18 -- handles a payment-method-update checkout's R0 ITN.
 * Persists the new payment method and, critically, cancels the OLD PayFast subscription/token
 * before adopting the new one: provider.createSubscription() always creates a genuinely NEW
 * gateway subscription (a fresh m_payment_id/token), so without an explicit cancel the org would
 * end up with TWO live recurring-billing arrangements at PayFast -- a real double-billing risk,
 * not a cosmetic one. cancelSubscription() is this codebase's least-verified PayFast method (its
 * own header comment: never exercised against a live round trip) -- failure here is logged
 * loudly, not silently swallowed, since an unconfirmed cancellation is a genuine operational risk
 * that needs a human to check PayFast's own dashboard, not just a retry.
 */
async function handlePaymentMethodUpdateWebhookEvent(
  serviceClient: SupabaseClient,
  input: {
    orgId: string;
    payment: { id: string; subscription_id: string };
    event: BillingWebhookEvent;
  },
): Promise<ProcessWebhookResult> {
  const { orgId, payment, event } = input;

  if (event.type === 'payment_failed' || event.type === 'subscription_cancelled') {
    await serviceClient
      .from('subscription_payments')
      .update({ status: 'failed' })
      .eq('id', payment.id);
    return { alreadyProcessed: false, eventType: event.type };
  }
  if (event.type !== 'payment_succeeded') {
    return { alreadyProcessed: false, eventType: event.type };
  }

  const { data: sub } = await serviceClient
    .from('organization_subscriptions')
    .select('provider_subscription_token')
    .eq('id', payment.subscription_id)
    .maybeSingle();
  const oldToken = sub?.provider_subscription_token;

  if (oldToken && oldToken !== event.providerSubscriptionToken) {
    try {
      const provider = getBillingGatewayProvider();
      await provider.cancelSubscription(oldToken);
    } catch (err) {
      console.error(
        '[billing] failed to cancel the SUPERSEDED PayFast subscription after a payment-method ' +
          'update -- possible double-billing risk, needs manual verification in the PayFast ' +
          'dashboard',
        { orgId, oldToken, err },
      );
    }
  }

  await persistPaymentMethod(serviceClient, {
    orgId,
    provider: 'payfast',
    providerReference: event.providerSubscriptionToken ?? event.providerReference,
  });

  if (event.providerSubscriptionToken) {
    await serviceClient
      .from('organization_subscriptions')
      .update({ provider_subscription_token: event.providerSubscriptionToken })
      .eq('id', payment.subscription_id);
  }

  await serviceClient
    .from('subscription_payments')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', payment.id);

  try {
    const toEmail = await resolveOrgPrincipalEmail(serviceClient, orgId);
    await dispatchEmail(serviceClient, {
      orgId,
      toAddress: toEmail,
      templateName: 'subscription_reactivated',
      templateVars: {},
      relatedEntityType: `billing_event:${event.providerEventId}`,
      relatedEntityId: orgId,
      actorUserId: null,
    });
  } catch (err) {
    console.error('[emailDispatch] payment-method-update confirmation email dispatch failed', err);
  }

  return { alreadyProcessed: false, eventType: event.type };
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

  // Payment amount semantics (V1 commercial onboarding pass): PayFast's m_payment_id/
  // provider_reference is stable for a subscription's ENTIRE lifetime, so more than one
  // subscription_payments row can now share it (one per actual financial event -- see below) --
  // this is no longer guaranteed to match at most one row, hence order+limit(1) instead of
  // maybeSingle() directly on an unfiltered query.
  const { data: latestPayment } = await serviceClient
    .from('subscription_payments')
    .select('id, org_id, subscription_id, billing_plan_change_id, amount, purpose, status')
    .eq('provider_reference', event.providerReference)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const orgId = event.orgId ?? latestPayment?.org_id;
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

  let payment = latestPayment;

  // Payment amount semantics: the row found above is the MOST RECENT one for this
  // provider_reference. If its status is still 'pending', THIS event is confirming the specific
  // checkout Proplyst itself just initiated (trial activation, a first subscription, or a plan
  // change) -- reuse it in place, exactly as before. If it's already 'paid'/'failed'/'refunded',
  // there is no local record waiting for this event at all: this is a genuinely NEW financial
  // event PayFast initiated on its own recurring-billing schedule (the real day-30 first charge,
  // or any later month's renewal, or that renewal failing) -- create a BRAND NEW row for it
  // instead of overwriting the historical record of the previous one. This is what stops a R0
  // trial-activation row from ever being repurposed to claim R299 was collected: that row's
  // status is already 'paid' by the time the real charge's ITN arrives, so this branch fires and
  // a second, separate row is created for the real R299 event.
  if (
    payment &&
    payment.status !== 'pending' &&
    (event.type === 'payment_succeeded' || event.type === 'payment_failed')
  ) {
    const expected = await serviceClient.rpc('org_subscription_expected_amount', {
      p_subscription_id: payment.subscription_id,
    });
    const expectedAmount = expected.data !== null ? Number(expected.data) : null;

    if (event.type === 'payment_succeeded' && event.amount !== null && expectedAmount !== null) {
      if (Math.abs(expectedAmount - Number(event.amount)) > 0.01) {
        console.error(
          '[billing] recurring-charge amount mismatch -- refusing to record or grant entitlement',
          { orgId, subscriptionId: payment.subscription_id, expectedAmount, receivedAmount: event.amount },
        );
        throw new Error(
          `billing_amount_mismatch: subscription ${payment.subscription_id} expected ${expectedAmount}, gateway reported ${event.amount}`,
        );
      }
    }

    const newAmount =
      event.amount !== null ? Number(event.amount) : (expectedAmount ?? Number(payment.amount));

    const { data: newRow, error: newRowError } = await serviceClient
      .from('subscription_payments')
      .insert({
        org_id: orgId,
        subscription_id: payment.subscription_id,
        amount: newAmount,
        currency: 'ZAR',
        status: event.type === 'payment_succeeded' ? 'paid' : 'failed',
        provider_reference: event.providerReference,
        purpose: 'subscription_charge',
        paid_at: event.type === 'payment_succeeded' ? new Date().toISOString() : null,
      })
      .select('id, org_id, subscription_id, billing_plan_change_id, amount, purpose, status')
      .single();
    if (newRowError || !newRow)
      throw new Error(newRowError?.message ?? 'Failed to record recurring charge event');
    payment = newRow;
  }

  if (payment) {
    // Commercial plan restructure: a trial-activation checkout's R0 setup event is handled by a
    // completely separate path from a real charge. Checked against
    // organizations.commercial_setup_completed_at (not the payment's own `purpose` column alone)
    // because the SAME row is reused for the real day-30 recurring charge once billing_date
    // arrives -- once setup has genuinely completed, that later event must fall through to the
    // unchanged logic below, never be treated as a second activation attempt.
    if (payment.purpose === 'trial_activation') {
      const { data: orgSetupState } = await serviceClient
        .from('organizations')
        .select('commercial_setup_completed_at')
        .eq('id', orgId)
        .single();
      if (!orgSetupState?.commercial_setup_completed_at) {
        return handleTrialActivationWebhookEvent(serviceClient, { orgId, payment, event });
      }
    }

    // V1 commercial onboarding pass, Phase 18: a payment-method-update checkout's R0 event is
    // ALWAYS handled here, never falls through to the ordinary recurring-charge logic below --
    // unlike a trial-activation row, this row is never reused for a later real charge (the plan's
    // actual next recurring charge stays anchored to whichever provider_reference the org's
    // subscription already had), so there is no "later legitimate event on the same row" case to
    // preserve a fallthrough for.
    if (payment.purpose === 'payment_method_update') {
      return handlePaymentMethodUpdateWebhookEvent(serviceClient, { orgId, payment, event });
    }

    // RELEASE A: defense-in-depth amount check, distinct from (and in addition to)
    // verifyWebhookSignature() above. The signature proves the ITN genuinely came from the
    // gateway unmodified in transit; it does NOT prove the amount the gateway is confirming
    // matches what THIS payment record actually expects to collect. Never skip straight to
    // marking paid/flipping entitlement on a signed-but-wrong-amount event -- that would grant
    // a paid-tier entitlement for less than the org actually owes, a real revenue-integrity gap,
    // not just a data-quality one. Only checked for payment_succeeded (the one event type that
    // ever grants entitlement) and only when the provider actually reported an amount (PayFast's
    // real ITN always does; the mock provider's test fixtures may omit it, in which case there is
    // nothing to cross-check against and the existing trust-the-signature posture applies).
    if (event.type === 'payment_succeeded' && event.amount !== null) {
      const expectedAmount = Number(payment.amount);
      const receivedAmount = Number(event.amount);
      if (Math.abs(expectedAmount - receivedAmount) > 0.01) {
        console.error(
          '[billing] webhook amount mismatch -- refusing to mark paid or grant entitlement',
          {
            paymentId: payment.id,
            orgId,
            expectedAmount,
            receivedAmount,
            providerEventId: event.providerEventId,
          },
        );
        throw new Error(
          `billing_amount_mismatch: payment ${payment.id} expected ${expectedAmount}, gateway reported ${receivedAmount}`,
        );
      }
    }

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
      // V1 communications productionisation (WORKLOG.md this date): read BEFORE this branch's own
      // updates below overwrite it -- the only way to tell a genuine first activation or a
      // suspended/cancelled org's reactivation apart from an uneventful recurring renewal charge
      // (which must NOT send an email every billing cycle) is what the org's status *was* the
      // instant before this payment landed.
      const { data: orgBefore } = await serviceClient
        .from('organizations')
        .select('status, legal_name')
        .eq('id', orgId)
        .single();

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
      let planChangeCompleted = false;
      if (payment.billing_plan_change_id) {
        const { data: pendingChange } = await serviceClient
          .from('billing_plan_changes')
          .select('id, new_plan_id, status, change_type')
          .eq('id', payment.billing_plan_change_id)
          .maybeSingle();
        if (pendingChange && pendingChange.status === 'awaiting_payment') {
          const subscriptionUpdateForChange: Record<string, unknown> = {
            plan_id: pendingChange.new_plan_id,
          };
          // V1 billing invoice pass (WORKLOG.md this date), Phase 11 (reactivation lifecycle audit):
          // a reactivation has no "currently paid period" to preserve (compute_plan_change_quote()'s
          // own comment) -- the org's period may have sat expired for days/weeks while
          // suspended/cancelled. Found LIVE, via a real test (billing.test.ts's reactivation
          // lifecycle test), not by inspection: without this, current_period_end/next_payment_date
          // stayed at their stale pre-suspension values, an already-ended period silently carried
          // forward into the reactivated subscription. Same flat-30-day convention this file already
          // uses everywhere else a fresh period is opened (startSubscriptionCheckout/
          // startPlanChangeCheckout's own new-row branch above).
          if (pendingChange.change_type === 'reactivation') {
            const periodStart = new Date().toISOString().slice(0, 10);
            const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10);
            subscriptionUpdateForChange.current_period_start = periodStart;
            subscriptionUpdateForChange.current_period_end = periodEnd;
            subscriptionUpdateForChange.next_payment_date = periodEnd;
          }
          await serviceClient
            .from('organization_subscriptions')
            .update(subscriptionUpdateForChange)
            .eq('id', payment.subscription_id);
          await serviceClient
            .from('billing_plan_changes')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', pendingChange.id);
          planChangeCompleted = true;

          const toEmail = await resolveOrgPrincipalEmail(serviceClient, orgId);
          await dispatchPlanChangeLifecycleEmail(serviceClient, {
            orgId,
            billingPlanChangeId: pendingChange.id,
            changeType: pendingChange.change_type,
            newPlanId: pendingChange.new_plan_id,
            amountDueNow: payment.amount,
            effectiveAt: new Date().toISOString(),
            toEmail,
          });
        }
      }

      // No plan change was involved -- either the org's very first successful payment
      // (startSubscriptionCheckout) or a gateway-side recovery of a previously
      // suspended/cancelled subscription. A routine renewal charge for an org that was already
      // 'active' falls through here with neither condition true, correctly sending nothing.
      if (!planChangeCompleted && orgBefore) {
        const isReactivation = orgBefore.status === 'suspended' || orgBefore.status === 'cancelled';
        const isFirstActivation = orgBefore.status === 'trial';
        if (isReactivation || isFirstActivation) {
          try {
            const { data: sub } = await serviceClient
              .from('organization_subscriptions')
              .select('plan_id')
              .eq('id', payment.subscription_id)
              .maybeSingle();
            const { data: plan } = sub
              ? await serviceClient.from('plans').select('name').eq('id', sub.plan_id).maybeSingle()
              : { data: null };
            const toEmail = await resolveOrgPrincipalEmail(serviceClient, orgId);
            await dispatchEmail(serviceClient, {
              orgId,
              toAddress: toEmail,
              templateName: isReactivation ? 'subscription_reactivated' : 'subscription_activated',
              templateVars: { planName: plan?.name, legalName: orgBefore.legal_name },
              relatedEntityType: `billing_event:${event.providerEventId}`,
              relatedEntityId: orgId,
              actorUserId: null,
            });
          } catch (err) {
            console.error('[emailDispatch] subscription lifecycle email dispatch failed', err);
          }
        }
      }

      // V1 billing invoice pass (WORKLOG.md this date): records the Proplyst subscription
      // invoice/receipt for this confirmed payment -- run LAST in this branch, after
      // organization_subscriptions/billing_plan_changes have already been flipped above, so an
      // upgrade's invoice reflects the ALREADY-APPLIED target plan/period, not a stale pre-flip
      // snapshot. create_subscription_invoice_for_payment() (migration 20260101000108) is itself
      // idempotent (unique(subscription_payment_id)) -- logged, not thrown, on failure: the
      // payment/entitlement state above has already been correctly applied by this point, and
      // failing the whole webhook response here would misreport that core success as a failure
      // to the gateway. A missing invoice is a real, visible-in-logs problem to investigate, not
      // silently swallowed.
      try {
        await serviceClient.rpc('create_subscription_invoice_for_payment', {
          p_payment_id: payment.id,
        });
      } catch (err) {
        console.error('[billing] subscription invoice creation failed', {
          paymentId: payment.id,
          orgId,
          err,
        });
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
        const toEmail = await resolveOrgPrincipalEmail(serviceClient, orgId);
        await dispatchEmail(serviceClient, {
          orgId,
          toAddress: toEmail,
          templateName: 'subscription_payment_issue',
          templateVars: { providerReference: event.providerReference },
          // relatedEntityType carries the specific event id (text column) since orgId is the
          // only real uuid available here -- one failed-payment email per distinct gateway
          // event, not one ever per org.
          relatedEntityType: `billing_event:${event.providerEventId}`,
          relatedEntityId: orgId,
          actorUserId: null,
        });
      } catch (err) {
        console.error('[emailDispatch] subscription_payment_issue dispatch failed', err);
      }
    } else if (event.type === 'subscription_cancelled') {
      await serviceClient
        .from('organization_subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', payment.subscription_id);
      await serviceClient.from('organizations').update({ status: 'cancelled' }).eq('id', orgId);

      // V1 communications productionisation: a gateway-reported cancellation (e.g. the customer
      // cancelled directly through the PayFast customer portal, not through Proplyst) is just as
      // real an account event as the self-serve /billing/cancel route below -- must notify either
      // way, distinct relatedEntityType so it never collides with cancelOrgSubscription()'s own
      // idempotency key for the same org.
      try {
        const toEmail = await resolveOrgPrincipalEmail(serviceClient, orgId);
        await dispatchEmail(serviceClient, {
          orgId,
          toAddress: toEmail,
          templateName: 'subscription_cancelled',
          templateVars: {},
          relatedEntityType: `billing_event:${event.providerEventId}`,
          relatedEntityId: orgId,
          actorUserId: null,
        });
      } catch (err) {
        console.error('[emailDispatch] subscription_cancelled dispatch failed', err);
      }
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

  // V1 communications productionisation: distinct relatedEntityType from the webhook-driven
  // subscription_cancelled dispatch above -- this is the self-serve principal-initiated
  // cancellation, keyed by the org itself (only ever fires once per org per cancellation, guarded
  // by the alreadyCancelled early-return above).
  try {
    const toEmail = await resolveOrgPrincipalEmail(serviceClient, input.orgId);
    await dispatchEmail(serviceClient, {
      orgId: input.orgId,
      toAddress: toEmail,
      templateName: 'subscription_cancelled',
      templateVars: {},
      relatedEntityType: 'organization_subscriptions',
      relatedEntityId: input.orgId,
      actorUserId: input.actorUserId ?? null,
    });
  } catch (err) {
    console.error('[emailDispatch] subscription_cancelled dispatch failed', err);
  }

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

  // V1 billing invoice pass (WORKLOG.md this date): the original invoice is retained, never
  // deleted or overwritten in its amounts/invoice_number -- only its status changes, so financial
  // history stays intact and a refunded charge is still visible as exactly what was originally
  // invoiced, now marked refunded. A payment predating this pass (or one that never successfully
  // reached create_subscription_invoice_for_payment(), e.g. the logged-not-thrown failure path in
  // processBillingWebhookEvent) may have no linked invoice at all -- updating zero rows here is a
  // correct, silent no-op, not an error.
  await serviceClient
    .from('subscription_invoices')
    .update({ status: 'refunded' })
    .eq('subscription_payment_id', input.subscriptionPaymentId);
}
