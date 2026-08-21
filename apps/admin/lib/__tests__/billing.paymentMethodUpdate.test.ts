import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startPaymentMethodUpdateCheckout, processBillingWebhookEvent } from '../billing';

// Real integration test against the local Supabase instance, same pattern as
// billing.trialActivation.test.ts -- covers V1 commercial onboarding Phase 18: an
// ALREADY-set-up org replacing its payment method must never restart/extend the trial, and the
// old PayFast subscription token must be superseded (not left as a second live billing
// arrangement) once the new one is confirmed.

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

describeIfSupabase('payment-method-update checkout (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let principalUserId: string;
  let subscriptionId: string;
  const OLD_TOKEN = 'old-payfast-token';

  beforeEach(async () => {
    principalUserId = randomUUID();
    const { error: userError } = await serviceClient.auth.admin.createUser({
      user_metadata: {},
      email: `payment-method-update-${principalUserId}@test.propertyvault.example`,
      email_confirm: true,
      id: principalUserId,
    } as never);
    if (userError) throw userError;

    const orgName = `Payment Method Update Vitest Org ${Date.now()}`;
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

    // Simulate an org that has already completed commercial setup (trial activation already
    // happened in an earlier session) -- activate_trial_after_payment() is the same idempotent
    // RPC the real webhook calls, matching the pattern the trial-activation test suite already
    // uses for its "setup already complete" test.
    await serviceClient.rpc('activate_trial_after_payment', { p_org_id: orgId });

    const { data: plan } = await serviceClient
      .from('plans')
      .select('id, billing_cycle')
      .eq('code', 'starter')
      .eq('billing_cycle', 'monthly')
      .single();

    const periodStart = new Date().toISOString().slice(0, 10);
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: sub, error: subError } = await serviceClient
      .from('organization_subscriptions')
      .insert({
        org_id: orgId,
        plan_id: plan!.id,
        billing_cycle: 'monthly',
        current_period_start: periodStart,
        current_period_end: periodEnd,
        next_payment_date: periodEnd,
        status: 'trial',
        provider_subscription_token: OLD_TOKEN,
      })
      .select('id')
      .single();
    if (subError) throw subError;
    subscriptionId = sub!.id;

    await serviceClient.from('payment_methods').insert({
      org_id: orgId,
      provider: 'payfast',
      provider_reference: OLD_TOKEN,
      status: 'active',
      is_default: true,
    });
  });

  afterEach(async () => {
    await serviceClient.from('payment_methods').delete().eq('org_id', orgId);
    await serviceClient.from('billing_events').delete().eq('org_id', orgId);
    await serviceClient.from('subscription_invoices').delete().eq('org_id', orgId);
    await serviceClient.from('subscription_payments').delete().eq('org_id', orgId);
    await serviceClient.from('organization_members').delete().eq('org_id', orgId);
    await serviceClient.from('organization_subscriptions').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(principalUserId);
  });

  it('creates a R0 pending payment-method-update checkout using the existing next_payment_date, not a fresh +30 days', async () => {
    const { data: subBefore } = await serviceClient
      .from('organization_subscriptions')
      .select('next_payment_date')
      .eq('id', subscriptionId)
      .single();

    const result = await startPaymentMethodUpdateCheckout(serviceClient, {
      orgId,
      idempotencyKey: `test-pm-update-${orgId}`,
    });
    expect(result.checkoutUrl).toContain('mock-gateway.invalid');

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('*')
      .eq('id', result.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('pending');
    expect(payment!.purpose).toBe('payment_method_update');
    expect(Number(payment!.amount)).toBe(0);

    const { data: subAfter } = await serviceClient
      .from('organization_subscriptions')
      .select('next_payment_date')
      .eq('id', subscriptionId)
      .single();
    expect(subAfter!.next_payment_date).toBe(subBefore!.next_payment_date);
  });

  it('refuses to run for an org that has not completed commercial setup', async () => {
    const { data: freshOrg } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `No Setup Org ${Date.now()}`, org_type: 'agency', status: 'trial' })
      .select('id')
      .single();

    await expect(
      startPaymentMethodUpdateCheckout(serviceClient, {
        orgId: freshOrg!.id,
        idempotencyKey: `test-pm-update-nosetup-${freshOrg!.id}`,
      }),
    ).rejects.toThrow(/commercial_setup_not_complete/);

    await serviceClient.from('organizations').delete().eq('id', freshOrg!.id);
  });

  it('a verified R0 payment_succeeded callback persists the new payment method and does not touch trial_ends_at', async () => {
    const { data: orgBefore } = await serviceClient
      .from('organizations')
      .select('trial_ends_at, commercial_setup_completed_at')
      .eq('id', orgId)
      .single();

    const checkout = await startPaymentMethodUpdateCheckout(serviceClient, {
      orgId,
      idempotencyKey: `test-pm-update-${orgId}`,
    });

    const NEW_TOKEN = `new-token-${orgId}`;
    const result = await processBillingWebhookEvent(serviceClient, {
      rawBody: JSON.stringify({
        providerEventId: `evt-pm-update-${orgId}`,
        type: 'payment_succeeded',
        providerReference: checkout.providerSubscriptionId,
        orgId,
        amount: 0,
        currency: 'ZAR',
        providerSubscriptionToken: NEW_TOKEN,
      }),
      signatureHeader: 'test-signature',
    });
    expect(result.alreadyProcessed).toBe(false);

    const { data: orgAfter } = await serviceClient
      .from('organizations')
      .select('trial_ends_at, commercial_setup_completed_at')
      .eq('id', orgId)
      .single();
    expect(orgAfter!.trial_ends_at).toBe(orgBefore!.trial_ends_at);
    expect(orgAfter!.commercial_setup_completed_at).toBe(orgBefore!.commercial_setup_completed_at);

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('status, paid_at')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('paid');
    expect(payment!.paid_at).not.toBeNull();

    // The OLD payment method row is superseded (status flips to 'replaced'), and a new active
    // row exists for the new token -- never two simultaneously-active rows.
    const { data: methods } = await serviceClient
      .from('payment_methods')
      .select('status, is_default, provider_reference')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });
    expect(methods).toHaveLength(2);
    expect(methods![0]!.provider_reference).toBe(OLD_TOKEN);
    expect(methods![0]!.status).toBe('replaced');
    expect(methods![0]!.is_default).toBe(false);
    expect(methods![1]!.provider_reference).toBe(NEW_TOKEN);
    expect(methods![1]!.status).toBe('active');
    expect(methods![1]!.is_default).toBe(true);

    const { data: subAfter } = await serviceClient
      .from('organization_subscriptions')
      .select('provider_subscription_token')
      .eq('id', subscriptionId)
      .single();
    expect(subAfter!.provider_subscription_token).toBe(NEW_TOKEN);
  });

  it('a failed payment-method-update callback marks the attempt failed without touching the existing payment method on file', async () => {
    const checkout = await startPaymentMethodUpdateCheckout(serviceClient, {
      orgId,
      idempotencyKey: `test-pm-update-${orgId}`,
    });

    await processBillingWebhookEvent(serviceClient, {
      rawBody: JSON.stringify({
        providerEventId: `evt-pm-update-fail-${orgId}`,
        type: 'payment_failed',
        providerReference: checkout.providerSubscriptionId,
        orgId,
        amount: 0,
        currency: 'ZAR',
      }),
      signatureHeader: 'test-signature',
    });

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('status')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('failed');

    const { data: methods } = await serviceClient
      .from('payment_methods')
      .select('status, provider_reference')
      .eq('org_id', orgId);
    expect(methods).toHaveLength(1);
    expect(methods![0]!.provider_reference).toBe(OLD_TOKEN);
    expect(methods![0]!.status).toBe('active');

    const { data: subAfter } = await serviceClient
      .from('organization_subscriptions')
      .select('provider_subscription_token')
      .eq('id', subscriptionId)
      .single();
    expect(subAfter!.provider_subscription_token).toBe(OLD_TOKEN);
  });
});
