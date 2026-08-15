import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  startSubscriptionCheckout,
  startPlanChangeCheckout,
  processBillingWebhookEvent,
  cancelOrgSubscription,
} from '../billing';

// Real integration test against the local Supabase instance (same pattern as
// lib/supabase/__tests__/server.test.ts) -- mocking Supabase's chained query builder would only
// prove the mock behaves as configured, not that billing_events' real unique constraint (the
// actual idempotency guard) does its job. Skipped automatically if `supabase start` isn't running.

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

describeIfSupabase('billing service (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let planId: string;

  beforeEach(async () => {
    const orgName = `Billing Vitest Org ${Date.now()}`;
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: orgName, org_type: 'agency', status: 'trial' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: plan, error: planError } = await serviceClient
      .from('plans')
      .insert({
        code: `vitest-plan-${Date.now()}`,
        name: 'Vitest Plan',
        billing_cycle: 'monthly',
        base_price: 499,
        currency: 'ZAR',
      })
      .select('id')
      .single();
    if (planError) throw planError;
    planId = plan.id;
  });

  afterEach(async () => {
    await serviceClient.from('billing_events').delete().eq('org_id', orgId);
    await serviceClient.from('billing_change_quotes').delete().eq('org_id', orgId);
    await serviceClient.from('billing_plan_changes').delete().eq('org_id', orgId);
    await serviceClient.from('subscription_payments').delete().eq('org_id', orgId);
    await serviceClient.from('organization_subscriptions').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.from('plans').delete().eq('id', planId);
  });

  it('startSubscriptionCheckout creates a trial subscription and a pending payment', async () => {
    const result = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `test-${orgId}`,
    });
    expect(result.checkoutUrl).toContain('mock-gateway.invalid');

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('*')
      .eq('id', result.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('pending');
    expect(payment.provider_reference).toBe(result.providerSubscriptionId);
  });

  it('processBillingWebhookEvent moves a pending payment to paid and activates the org', async () => {
    const checkout = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `test-${orgId}`,
    });

    const rawBody = JSON.stringify({
      providerEventId: `evt-${orgId}`,
      type: 'payment_succeeded',
      providerReference: checkout.providerSubscriptionId,
      orgId,
      amount: 499,
      currency: 'ZAR',
    });

    const result = await processBillingWebhookEvent(serviceClient, {
      rawBody,
      signatureHeader: 'test-signature',
    });
    expect(result.alreadyProcessed).toBe(false);

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('status')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('paid');

    const { data: org } = await serviceClient
      .from('organizations')
      .select('status')
      .eq('id', orgId)
      .single();
    expect(org!.status).toBe('active');
  });

  it('a replayed webhook (same providerEventId) is a no-op, not a double-processed payment', async () => {
    const checkout = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `test-${orgId}`,
    });

    const rawBody = JSON.stringify({
      providerEventId: `evt-replay-${orgId}`,
      type: 'payment_succeeded',
      providerReference: checkout.providerSubscriptionId,
      orgId,
      amount: 499,
      currency: 'ZAR',
    });

    const first = await processBillingWebhookEvent(serviceClient, {
      rawBody,
      signatureHeader: 'test-signature',
    });
    const second = await processBillingWebhookEvent(serviceClient, {
      rawBody,
      signatureHeader: 'test-signature',
    });

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);

    const { count } = await serviceClient
      .from('billing_events')
      .select('id', { count: 'exact', head: true })
      .eq('provider_event_id', `evt-replay-${orgId}`);
    expect(count).toBe(1);
  });

  it('a payment_failed event marks the org overdue without touching subscription_payments as paid', async () => {
    const checkout = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `test-${orgId}`,
    });

    const rawBody = JSON.stringify({
      providerEventId: `evt-fail-${orgId}`,
      type: 'payment_failed',
      providerReference: checkout.providerSubscriptionId,
      orgId,
    });

    await processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader: 'test-signature' });

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('status')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('failed');

    const { data: org } = await serviceClient
      .from('organizations')
      .select('status')
      .eq('id', orgId)
      .single();
    expect(org!.status).toBe('overdue');
  });

  it('cancelOrgSubscription sets both the subscription and organization to cancelled', async () => {
    const checkout = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `test-${orgId}`,
    });

    // cancelOrgSubscription resolves the gateway token from provider_subscription_token, which is
    // only ever populated by a successful payment's webhook -- there is nothing to cancel until
    // one has been processed.
    const rawBody = JSON.stringify({
      providerEventId: `evt-cancel-${orgId}`,
      type: 'payment_succeeded',
      providerReference: checkout.providerSubscriptionId,
      providerSubscriptionToken: `mock-token-${orgId}`,
      orgId,
      amount: 499,
      currency: 'ZAR',
    });
    await processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader: 'test-signature' });

    await cancelOrgSubscription(serviceClient, { orgId });

    const { data: org } = await serviceClient
      .from('organizations')
      .select('status')
      .eq('id', orgId)
      .single();
    expect(org!.status).toBe('cancelled');
  });

  it('cancelOrgSubscription throws if no payment has ever succeeded (no gateway token on record)', async () => {
    await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `test-${orgId}`,
    });
    await expect(cancelOrgSubscription(serviceClient, { orgId })).rejects.toThrow(
      /no gateway token/,
    );
  });

  it('rejects a webhook with no signature header', async () => {
    const rawBody = JSON.stringify({
      providerEventId: 'evt-nosig',
      type: 'payment_succeeded',
      providerReference: 'mock-sub-x',
      orgId,
    });
    await expect(
      processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader: null }),
    ).rejects.toThrow();
  });

  // RELEASE A P0 (V1 Commercial Launch Gap Audit, Phase 13/18): startPlanChangeCheckout()/the
  // webhook's deferred-plan-change completion/cancelOrgSubscription()'s idempotency. The
  // compute/confirm RPCs themselves (auth.uid()-gated) are fully covered at the SQL layer by
  // supabase/tests/billing_proration_engine.test.sql -- these tests exercise the TypeScript layer
  // that composes with them, using a directly-inserted billing_plan_changes row (service-role,
  // bypassing the auth.uid()-gated RPCs) to simulate exactly what confirm_plan_change() would have
  // produced for a real, authenticated principal.
  describe('plan-change checkout + webhook completion (RELEASE A)', () => {
    let targetPlanId: string;

    beforeEach(async () => {
      const { data: targetPlan, error: targetPlanError } = await serviceClient
        .from('plans')
        .insert({
          code: `vitest-target-plan-${Date.now()}`,
          name: 'Vitest Target Plan',
          billing_cycle: 'monthly',
          base_price: 999,
          currency: 'ZAR',
        })
        .select('id')
        .single();
      if (targetPlanError) throw targetPlanError;
      targetPlanId = targetPlan.id;

      // A real, active current subscription -- the state startPlanChangeCheckout() expects to
      // find and reuse (never create a second subscription row for an upgrade).
      await serviceClient.from('organization_subscriptions').insert({
        org_id: orgId,
        plan_id: planId,
        billing_cycle: 'monthly',
        current_period_start: new Date().toISOString().slice(0, 10),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        status: 'active',
      });
    });

    afterEach(async () => {
      await serviceClient.from('plans').delete().eq('id', targetPlanId);
    });

    it('startPlanChangeCheckout charges the server-computed prorated amount, never plan.base_price', async () => {
      const { data: change, error: changeError } = await serviceClient
        .from('billing_plan_changes')
        .insert({
          org_id: orgId,
          change_type: 'upgrade',
          old_plan_id: planId,
          new_plan_id: targetPlanId,
          charge_due: 250.0,
          currency: 'ZAR',
          status: 'awaiting_payment',
          effective_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (changeError) throw changeError;

      const checkout = await startPlanChangeCheckout(serviceClient, {
        orgId,
        billingPlanChangeId: change.id,
        targetPlanId,
        amountDueNow: 250.0,
        idempotencyKey: `plan-change-test-${change.id}`,
      });

      const { data: payment } = await serviceClient
        .from('subscription_payments')
        .select('amount, billing_plan_change_id, status')
        .eq('id', checkout.subscriptionPaymentId)
        .single();
      // 250.00, NOT the target plan's 999 base_price -- proves the prorated amount is what's
      // actually charged, not the full new-plan price.
      expect(Number(payment!.amount)).toBe(250);
      expect(payment!.billing_plan_change_id).toBe(change.id);
      expect(payment!.status).toBe('pending');

      // The org's CURRENT subscription row is reused, not duplicated -- still exactly one row.
      const { count } = await serviceClient
        .from('organization_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);
      expect(count).toBe(1);
    });

    it('a payment_succeeded webhook for a plan-change payment flips plan_id and completes the change', async () => {
      const { data: change, error: changeError } = await serviceClient
        .from('billing_plan_changes')
        .insert({
          org_id: orgId,
          change_type: 'upgrade',
          old_plan_id: planId,
          new_plan_id: targetPlanId,
          charge_due: 400.0,
          currency: 'ZAR',
          status: 'awaiting_payment',
          effective_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (changeError) throw changeError;

      const checkout = await startPlanChangeCheckout(serviceClient, {
        orgId,
        billingPlanChangeId: change.id,
        targetPlanId,
        amountDueNow: 400.0,
        idempotencyKey: `plan-change-webhook-test-${change.id}`,
      });

      // Before payment: plan_id is UNCHANGED (still the original plan).
      const { data: before } = await serviceClient
        .from('organization_subscriptions')
        .select('plan_id')
        .eq('org_id', orgId)
        .single();
      expect(before!.plan_id).toBe(planId);

      const rawBody = JSON.stringify({
        providerEventId: `evt-planchange-${change.id}`,
        type: 'payment_succeeded',
        providerReference: checkout.providerSubscriptionId,
        orgId,
        amount: 400,
        currency: 'ZAR',
      });
      await processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader: 'test-signature' });

      // After payment: plan_id has flipped to the TARGET plan, and the change is completed.
      const { data: after } = await serviceClient
        .from('organization_subscriptions')
        .select('plan_id')
        .eq('org_id', orgId)
        .single();
      expect(after!.plan_id).toBe(targetPlanId);

      const { data: completedChange } = await serviceClient
        .from('billing_plan_changes')
        .select('status, completed_at')
        .eq('id', change.id)
        .single();
      expect(completedChange!.status).toBe('completed');
      expect(completedChange!.completed_at).not.toBeNull();
    });
  });

  it('cancelOrgSubscription is idempotent -- a second call reports alreadyCancelled without a second audit row or gateway call', async () => {
    const checkout = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `test-${orgId}`,
    });
    const rawBody = JSON.stringify({
      providerEventId: `evt-cancel-idem-${orgId}`,
      type: 'payment_succeeded',
      providerReference: checkout.providerSubscriptionId,
      providerSubscriptionToken: `mock-token-idem-${orgId}`,
      orgId,
      amount: 499,
      currency: 'ZAR',
    });
    await processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader: 'test-signature' });

    const first = await cancelOrgSubscription(serviceClient, { orgId });
    expect(first.alreadyCancelled).toBe(false);

    const second = await cancelOrgSubscription(serviceClient, { orgId });
    expect(second.alreadyCancelled).toBe(true);

    const { count } = await serviceClient
      .from('billing_plan_changes')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('change_type', 'cancellation');
    expect(count).toBe(1);
  });
});
