import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR } from '@propvault/config';
import { startTrialActivationCheckout, processBillingWebhookEvent } from '../billing';

// Real integration test against the local Supabase instance, same pattern as billing.test.ts --
// covers the indefinite-trial blocker fix: a new org's trial_ends_at/commercial_setup_completed_at
// must stay null until a verified PayFast callback lands, activate_trial_after_payment() must be
// idempotent under a retried/duplicate callback, and eligibility must be enforced.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

describeIfSupabase('trial-activation checkout (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let principalUserId: string;

  beforeEach(async () => {
    principalUserId = randomUUID();
    const { error: userError } = await serviceClient.auth.admin.createUser({
      user_metadata: {},
      email: `trial-activation-${principalUserId}@test.propertyvault.example`,
      email_confirm: true,
      id: principalUserId,
    } as never);
    if (userError) throw userError;

    const orgName = `Trial Activation Vitest Org ${Date.now()}`;
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: orgName, org_type: 'agency', status: 'trial' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { error: memberError } = await serviceClient.from('organization_members').insert({
      org_id: orgId,
      user_id: principalUserId,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    if (memberError) throw memberError;
  });

  afterEach(async () => {
    await serviceClient.from('trial_usage_records').delete().eq('org_id', orgId);
    await serviceClient.from('payment_methods').delete().eq('org_id', orgId);
    await serviceClient.from('billing_events').delete().eq('org_id', orgId);
    await serviceClient.from('subscription_invoices').delete().eq('org_id', orgId);
    await serviceClient.from('subscription_payments').delete().eq('org_id', orgId);
    await serviceClient.from('organization_members').delete().eq('org_id', orgId);
    await serviceClient.from('organization_subscriptions').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(principalUserId);
  });

  it('a newly created org has trial_ends_at and commercial_setup_completed_at both null', async () => {
    const { data: org } = await serviceClient
      .from('organizations')
      .select('trial_ends_at, commercial_setup_completed_at')
      .eq('id', orgId)
      .single();
    expect(org!.trial_ends_at).toBeNull();
    expect(org!.commercial_setup_completed_at).toBeNull();
  });

  it('startTrialActivationCheckout creates a pending card-verification-fee payment and does not itself start the trial', async () => {
    const result = await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'starter',
      interval: 'monthly',
      idempotencyKey: `test-trial-${orgId}`,
    });
    expect(result.checkoutUrl).toContain('mock-gateway.invalid');

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('*')
      .eq('id', result.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('pending');
    expect(payment!.purpose).toBe('trial_activation');
    // The once-off card-verification fee, never the plan's recurring price -- a R0.00 amount here
    // reliably failed PayFast's own card-authorization step in live production testing (see
    // TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR's own comment).
    expect(Number(payment!.amount)).toBe(TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR);

    const { data: org } = await serviceClient
      .from('organizations')
      .select('trial_ends_at, commercial_setup_completed_at')
      .eq('id', orgId)
      .single();
    expect(org!.trial_ends_at).toBeNull();
    expect(org!.commercial_setup_completed_at).toBeNull();
  });

  it('an unverified/malformed callback does not activate the trial', async () => {
    const checkout = await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'starter',
      interval: 'monthly',
      idempotencyKey: `test-trial-${orgId}`,
    });

    await expect(
      processBillingWebhookEvent(serviceClient, {
        rawBody: JSON.stringify({ malformed: true }),
        signatureHeader: 'test-signature',
      }),
    ).rejects.toThrow();

    const { data: org } = await serviceClient
      .from('organizations')
      .select('trial_ends_at, commercial_setup_completed_at')
      .eq('id', orgId)
      .single();
    expect(org!.trial_ends_at).toBeNull();
    expect(org!.commercial_setup_completed_at).toBeNull();

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('status')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('pending');
  });

  it('a verified card-verification-fee payment_succeeded callback activates the trial, sets commercial_setup_completed_at, and persists a payment method', async () => {
    const checkout = await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'starter',
      interval: 'monthly',
      idempotencyKey: `test-trial-${orgId}`,
    });

    const rawBody = JSON.stringify({
      providerEventId: `evt-${orgId}`,
      type: 'payment_succeeded',
      providerReference: checkout.providerSubscriptionId,
      orgId,
      amount: TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR,
      currency: 'ZAR',
      providerSubscriptionToken: `token-${orgId}`,
    });

    const result = await processBillingWebhookEvent(serviceClient, {
      rawBody,
      signatureHeader: 'test-signature',
    });
    expect(result.alreadyProcessed).toBe(false);

    const { data: org } = await serviceClient
      .from('organizations')
      .select('status, trial_ends_at, commercial_setup_completed_at')
      .eq('id', orgId)
      .single();
    expect(org!.commercial_setup_completed_at).not.toBeNull();
    expect(org!.trial_ends_at).not.toBeNull();
    // Real charges/entitlement are unaffected by trial activation -- the org stays in 'trial'
    // status (never flips to 'active') until the REAL day-30 recurring charge succeeds, exactly
    // the same as a brand-new org's default status.
    expect(org!.status).toBe('trial');

    const trialEndsAt = new Date(org!.trial_ends_at!).getTime();
    const expected = Date.now() + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(trialEndsAt - expected)).toBeLessThan(60 * 1000);

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('status, paid_at, subscription_id')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('paid');
    expect(payment!.paid_at).not.toBeNull();

    // The card-verification-fee success must not pull the subscription's own billing dates
    // forward -- next_payment_date/current_period_end stay anchored to the 30-day trial end set
    // at checkout time, so the selected plan's recurring amount is only ever charged then.
    const { data: sub } = await serviceClient
      .from('organization_subscriptions')
      .select('status, next_payment_date, current_period_end')
      .eq('id', payment!.subscription_id)
      .single();
    expect(sub!.status).toBe('trial');
    expect(sub!.next_payment_date).toBe(sub!.current_period_end);
    const nextPaymentDate = new Date(sub!.next_payment_date!).getTime();
    expect(Math.abs(nextPaymentDate - expected)).toBeLessThan(24 * 60 * 60 * 1000);

    const { data: paymentMethods } = await serviceClient
      .from('payment_methods')
      .select('*')
      .eq('org_id', orgId);
    expect(paymentMethods).toHaveLength(1);
    expect(paymentMethods![0].status).toBe('active');
    expect(paymentMethods![0].is_default).toBe(true);
    expect(paymentMethods![0].card_last4).toBeNull();

    const { data: trialUsage } = await serviceClient
      .from('trial_usage_records')
      .select('*')
      .eq('org_id', orgId);
    expect(trialUsage).toHaveLength(1);
    expect(trialUsage![0].principal_user_id).toBe(principalUserId);
  });

  it('a duplicate/retried card-verification-fee callback does not reset or extend the trial clock', async () => {
    const checkout = await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'starter',
      interval: 'monthly',
      idempotencyKey: `test-trial-${orgId}`,
    });

    const rawBody = JSON.stringify({
      providerEventId: `evt-${orgId}`,
      type: 'payment_succeeded',
      providerReference: checkout.providerSubscriptionId,
      orgId,
      amount: TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR,
      currency: 'ZAR',
    });

    await processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader: 'test-signature' });
    const { data: firstOrg } = await serviceClient
      .from('organizations')
      .select('trial_ends_at')
      .eq('id', orgId)
      .single();
    const firstTrialEndsAt = firstOrg!.trial_ends_at;

    // Same providerEventId -- a genuine gateway retry -- caught by billing_events' own unique
    // constraint before it ever reaches the trial-activation branch a second time.
    const retryResult = await processBillingWebhookEvent(serviceClient, {
      rawBody,
      signatureHeader: 'test-signature',
    });
    expect(retryResult.alreadyProcessed).toBe(true);

    const { data: secondOrg } = await serviceClient
      .from('organizations')
      .select('trial_ends_at')
      .eq('id', orgId)
      .single();
    expect(secondOrg!.trial_ends_at).toBe(firstTrialEndsAt);

    const { data: trialUsage } = await serviceClient
      .from('trial_usage_records')
      .select('id')
      .eq('org_id', orgId);
    expect(trialUsage).toHaveLength(1);
  });

  it('the real day-30 recurring charge on the same provider_reference activates the org normally, after setup has completed, and payment amount semantics stay correct throughout', async () => {
    const checkout = await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'starter',
      interval: 'monthly',
      idempotencyKey: `test-trial-${orgId}`,
    });

    await processBillingWebhookEvent(serviceClient, {
      rawBody: JSON.stringify({
        providerEventId: `evt-setup-${orgId}`,
        type: 'payment_succeeded',
        providerReference: checkout.providerSubscriptionId,
        orgId,
        amount: TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR,
        currency: 'ZAR',
      }),
      signatureHeader: 'test-signature',
    });

    // Payment amount semantics (V1 commercial onboarding pass): the trial-activation row must
    // permanently show the card-verification fee -- never mutated to the plan price -- since that
    // fee is genuinely all that was ever collected for it. A customer must never see "R299 paid"
    // for the date they paid the once-off verification fee.
    const { data: trialRow } = await serviceClient
      .from('subscription_payments')
      .select('amount, status, purpose')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(Number(trialRow!.amount)).toBe(TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR);
    expect(trialRow!.status).toBe('paid');
    expect(trialRow!.purpose).toBe('trial_activation');

    // A real financial event (the verification fee collected) gets a real invoice too, not
    // silently skipped.
    const { data: trialInvoice } = await serviceClient
      .from('subscription_invoices')
      .select('total, subtotal')
      .eq('subscription_payment_id', checkout.subscriptionPaymentId)
      .maybeSingle();
    expect(Number(trialInvoice!.total)).toBe(TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR);

    // The real recurring charge, 30 days later, on the SAME provider_reference/m_payment_id --
    // PayFast echoes it unchanged for the life of the subscription. Must fall through to the
    // EXISTING payment_succeeded handling (flips org to 'active'), not be mistaken for a second
    // trial-activation event, and must be recorded as a BRAND NEW row -- never by overwriting the
    // R0 row above.
    const result = await processBillingWebhookEvent(serviceClient, {
      rawBody: JSON.stringify({
        providerEventId: `evt-real-charge-${orgId}`,
        type: 'payment_succeeded',
        providerReference: checkout.providerSubscriptionId,
        orgId,
        amount: 299,
        currency: 'ZAR',
      }),
      signatureHeader: 'test-signature',
    });
    expect(result.alreadyProcessed).toBe(false);

    const { data: org } = await serviceClient
      .from('organizations')
      .select('status')
      .eq('id', orgId)
      .single();
    expect(org!.status).toBe('active');

    // The card-verification-fee row is still exactly as it was -- untouched by the later real charge.
    const { data: trialRowAfter } = await serviceClient
      .from('subscription_payments')
      .select('amount, status')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(Number(trialRowAfter!.amount)).toBe(TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR);
    expect(trialRowAfter!.status).toBe('paid');

    // The real R299 charge is a SEPARATE row, correctly recording what was ACTUALLY collected.
    const { data: allPayments } = await serviceClient
      .from('subscription_payments')
      .select('id, amount, status, purpose, paid_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });
    expect(allPayments).toHaveLength(2);
    expect(allPayments![0]!.id).toBe(checkout.subscriptionPaymentId);
    expect(Number(allPayments![0]!.amount)).toBe(TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR);
    const realCharge = allPayments![1]!;
    expect(realCharge.id).not.toBe(checkout.subscriptionPaymentId);
    expect(Number(realCharge.amount)).toBe(299);
    expect(realCharge.status).toBe('paid');
    expect(realCharge.purpose).toBe('subscription_charge');
    expect(realCharge.paid_at).not.toBeNull();

    // The real charge also gets its own, separate, correctly-valued invoice.
    const { data: realInvoice } = await serviceClient
      .from('subscription_invoices')
      .select('total, invoice_type')
      .eq('subscription_payment_id', realCharge.id)
      .maybeSingle();
    expect(Number(realInvoice!.total)).toBe(299);
  });

  it('a recurring charge with a mismatched amount is rejected and creates no new payment row', async () => {
    const checkout = await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'starter',
      interval: 'monthly',
      idempotencyKey: `test-trial-${orgId}`,
    });
    await processBillingWebhookEvent(serviceClient, {
      rawBody: JSON.stringify({
        providerEventId: `evt-setup-${orgId}`,
        type: 'payment_succeeded',
        providerReference: checkout.providerSubscriptionId,
        orgId,
        amount: TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR,
        currency: 'ZAR',
      }),
      signatureHeader: 'test-signature',
    });

    // A tampered/incorrect amount for the real recurring charge (Starter is R299, not R999).
    await expect(
      processBillingWebhookEvent(serviceClient, {
        rawBody: JSON.stringify({
          providerEventId: `evt-bad-charge-${orgId}`,
          type: 'payment_succeeded',
          providerReference: checkout.providerSubscriptionId,
          orgId,
          amount: 999,
          currency: 'ZAR',
        }),
        signatureHeader: 'test-signature',
      }),
    ).rejects.toThrow(/billing_amount_mismatch/);

    const { data: allPayments } = await serviceClient
      .from('subscription_payments')
      .select('id')
      .eq('org_id', orgId);
    expect(allPayments).toHaveLength(1);

    const { data: org } = await serviceClient
      .from('organizations')
      .select('status')
      .eq('id', orgId)
      .single();
    expect(org!.status).toBe('trial');
  });

  it('a principal who has already used a trial is refused a second one at checkout time', async () => {
    await serviceClient.rpc('record_trial_usage', {
      p_org_id: orgId,
      p_principal_user_id: principalUserId,
    });

    await expect(
      startTrialActivationCheckout(serviceClient, {
        orgId,
        principalUserId,
        planTier: 'starter',
        interval: 'monthly',
        idempotencyKey: `test-trial-${orgId}`,
      }),
    ).rejects.toThrow(/trial_not_eligible/);

    const { data: org } = await serviceClient
      .from('organizations')
      .select('trial_ends_at')
      .eq('id', orgId)
      .single();
    expect(org!.trial_ends_at).toBeNull();
  });

  it('startTrialActivationCheckout refuses to run again once commercial setup has already completed', async () => {
    await serviceClient.rpc('activate_trial_after_payment', { p_org_id: orgId });

    await expect(
      startTrialActivationCheckout(serviceClient, {
        orgId,
        principalUserId,
        planTier: 'professional',
        interval: 'monthly',
        idempotencyKey: `test-trial-2-${orgId}`,
      }),
    ).rejects.toThrow(/commercial_setup_already_complete/);
  });

  it('a failed payment-method setup callback leaves the org in setup-required state for a clean retry', async () => {
    const checkout = await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'starter',
      interval: 'monthly',
      idempotencyKey: `test-trial-${orgId}`,
    });

    await processBillingWebhookEvent(serviceClient, {
      rawBody: JSON.stringify({
        providerEventId: `evt-fail-${orgId}`,
        type: 'payment_failed',
        providerReference: checkout.providerSubscriptionId,
        orgId,
        amount: TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR,
        currency: 'ZAR',
      }),
      signatureHeader: 'test-signature',
    });

    const { data: org } = await serviceClient
      .from('organizations')
      .select('trial_ends_at, commercial_setup_completed_at')
      .eq('id', orgId)
      .single();
    expect(org!.trial_ends_at).toBeNull();
    expect(org!.commercial_setup_completed_at).toBeNull();

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('status')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('failed');

    // A fresh startTrialActivationCheckout call is still allowed -- the org is still unset-up.
    const retry = await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'starter',
      interval: 'monthly',
      idempotencyKey: `test-trial-retry-${orgId}`,
    });
    expect(retry.checkoutUrl).toContain('mock-gateway.invalid');
  });
});
