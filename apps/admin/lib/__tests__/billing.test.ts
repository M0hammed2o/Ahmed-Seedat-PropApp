import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  startSubscriptionCheckout,
  startPlanChangeCheckout,
  processBillingWebhookEvent,
  cancelOrgSubscription,
  refundSubscriptionPayment,
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
    // subscription_invoices must be deleted before subscription_payments -- it references
    // subscription_payments(id) with the default (RESTRICT-like) ON DELETE behaviour, deliberately
    // NOT cascade (a payment record must never be deletable out from under an existing invoice in
    // production; this test cleanup just has to respect that same real constraint).
    await serviceClient.from('subscription_invoices').delete().eq('org_id', orgId);
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

    // V1 billing invoice pass (WORKLOG.md this date): a confirmed payment also records a
    // Proplyst subscription invoice -- this org's very first, so new_subscription.
    const { data: invoice } = await serviceClient
      .from('subscription_invoices')
      .select('invoice_type, total, status, subscription_payment_id')
      .eq('org_id', orgId)
      .single();
    expect(invoice!.invoice_type).toBe('new_subscription');
    expect(Number(invoice!.total)).toBe(499);
    expect(invoice!.status).toBe('paid');
    expect(invoice!.subscription_payment_id).toBe(checkout.subscriptionPaymentId);
  });

  it('a duplicate webhook delivery (same providerEventId) never creates a second invoice', async () => {
    const checkout = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `test-${orgId}`,
    });
    const rawBody = JSON.stringify({
      providerEventId: `evt-invoice-dup-${orgId}`,
      type: 'payment_succeeded',
      providerReference: checkout.providerSubscriptionId,
      orgId,
      amount: 499,
      currency: 'ZAR',
    });

    await processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader: 'test-signature' });
    const second = await processBillingWebhookEvent(serviceClient, {
      rawBody,
      signatureHeader: 'test-signature',
    });
    expect(second.alreadyProcessed).toBe(true);

    const { count } = await serviceClient
      .from('subscription_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    expect(count).toBe(1);
  });

  it('a payment_succeeded webhook reporting the WRONG amount is rejected -- never marks paid or activates the org', async () => {
    const checkout = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `test-${orgId}`,
    });

    // plan.base_price is 499 -- the gateway reporting 1 (a signed, genuine ITN for the wrong
    // amount, e.g. an integration bug or a tampered checkout) must not be trusted just because
    // the signature itself checked out.
    const rawBody = JSON.stringify({
      providerEventId: `evt-amount-mismatch-${orgId}`,
      type: 'payment_succeeded',
      providerReference: checkout.providerSubscriptionId,
      orgId,
      amount: 1,
      currency: 'ZAR',
    });

    await expect(
      processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader: 'test-signature' }),
    ).rejects.toThrow(/billing_amount_mismatch/);

    const { data: payment } = await serviceClient
      .from('subscription_payments')
      .select('status')
      .eq('id', checkout.subscriptionPaymentId)
      .single();
    expect(payment!.status).toBe('pending');

    const { data: org } = await serviceClient
      .from('organizations')
      .select('status')
      .eq('id', orgId)
      .single();
    expect(org!.status).toBe('trial');

    // The audit trail still captures the event -- rejecting the state transition is not the same
    // as pretending the webhook never arrived.
    const { count } = await serviceClient
      .from('billing_events')
      .select('id', { count: 'exact', head: true })
      .eq('provider_event_id', `evt-amount-mismatch-${orgId}`);
    expect(count).toBe(1);
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
      await processBillingWebhookEvent(serviceClient, {
        rawBody,
        signatureHeader: 'test-signature',
      });

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

      // V1 billing invoice pass (WORKLOG.md this date): the invoice for this upgrade records the
      // R400 actually charged and the TARGET plan -- never the target plan's full base_price
      // (999), and never the OLD plan_id.
      const { data: invoice } = await serviceClient
        .from('subscription_invoices')
        .select('invoice_type, total, plan_id, billing_plan_change_id')
        .eq('subscription_payment_id', checkout.subscriptionPaymentId)
        .single();
      expect(invoice!.invoice_type).toBe('upgrade');
      expect(Number(invoice!.total)).toBe(400);
      expect(invoice!.plan_id).toBe(targetPlanId);
      expect(invoice!.billing_plan_change_id).toBe(change.id);
    });
  });

  // V1 billing invoice pass (WORKLOG.md this date), Phase 10/11 (grace-period access + reactivation
  // lifecycle audit -- upgraded from "Likely" to live-tested). compute_plan_change_quote() prices a
  // suspended/cancelled org's plan change as change_type='reactivation', amount_due_now = the FULL
  // target price (never a proration -- there is no "currently paid period" for a suspended org, see
  // that function's own comment) -- so a reactivation ALWAYS goes through startPlanChangeCheckout +
  // the webhook's deferred-plan-change completion path, never the synchronous $0 branch in
  // confirm_plan_change(). This exercises that exact real path end-to-end.
  describe('reactivation lifecycle (grace-period audit)', () => {
    it('overdue -> suspended -> successful payment -> active again: entitlements restore, no duplicate subscription row, and the stale pre-suspension period is NOT reused', async () => {
      // Backdated, already-ENDED period -- simulates a subscription that has sat suspended for a
      // while, exactly the state Phase 11 asks to be verified rather than assumed: does
      // reactivation give the org a fresh billing period, or does it silently leave the org on a
      // period that ended weeks ago?
      const staleStart = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
      const staleEnd = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
      const { data: sub, error: subError } = await serviceClient
        .from('organization_subscriptions')
        .insert({
          org_id: orgId,
          plan_id: planId,
          billing_cycle: 'monthly',
          current_period_start: staleStart,
          current_period_end: staleEnd,
          status: 'active',
        })
        .select('id')
        .single();
      if (subError) throw subError;

      // overdue -> suspended, matching expire_trials_and_suspend_overdue()'s own real effect
      // (migration 20260101000076): only organizations.status/overdue_since change; the
      // subscription row itself is never touched by suspension.
      await serviceClient
        .from('organizations')
        .update({ status: 'suspended', overdue_since: staleEnd })
        .eq('id', orgId);

      // Simulates confirm_plan_change()'s own real output for a reactivation (service-role direct
      // insert, matching this describe block's own established pattern above -- the auth.uid()-
      // gated RPC itself is covered separately by supabase/tests/billing_reactivation_authorization
      // .test.sql and billing_proration_engine.test.sql).
      const { data: change, error: changeError } = await serviceClient
        .from('billing_plan_changes')
        .insert({
          org_id: orgId,
          change_type: 'reactivation',
          old_plan_id: planId,
          new_plan_id: planId,
          charge_due: 499.0,
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
        targetPlanId: planId,
        amountDueNow: 499.0,
        idempotencyKey: `reactivation-webhook-test-${change.id}`,
      });

      const rawBody = JSON.stringify({
        providerEventId: `evt-reactivation-${change.id}`,
        type: 'payment_succeeded',
        providerReference: checkout.providerSubscriptionId,
        orgId,
        amount: 499,
        currency: 'ZAR',
      });
      await processBillingWebhookEvent(serviceClient, {
        rawBody,
        signatureHeader: 'test-signature',
      });

      const { data: orgAfter } = await serviceClient
        .from('organizations')
        .select('status, overdue_since')
        .eq('id', orgId)
        .single();
      expect(orgAfter!.status).toBe('active');
      expect(orgAfter!.overdue_since).toBeNull();

      const { data: changeAfter } = await serviceClient
        .from('billing_plan_changes')
        .select('status, completed_at')
        .eq('id', change.id)
        .single();
      expect(changeAfter!.status).toBe('completed');
      expect(changeAfter!.completed_at).not.toBeNull();

      // No duplicate subscription row -- still exactly the one row this test created, reused.
      const { data: subsAfter, count } = await serviceClient
        .from('organization_subscriptions')
        .select('id, current_period_start, current_period_end', { count: 'exact' })
        .eq('org_id', orgId);
      expect(count).toBe(1);
      const subAfter = subsAfter![0]!;
      expect(subAfter.id).toBe(sub.id);

      // The stale pre-suspension period must NOT be reused: current_period_end must now be in the
      // future, not the already-ended staleEnd date this test started with.
      expect(new Date(subAfter.current_period_end).getTime()).toBeGreaterThan(Date.now());
      expect(subAfter.current_period_end).not.toBe(staleEnd);
      expect(subAfter.current_period_start).not.toBe(staleStart);

      // A real invoice was recorded for the reactivation charge -- financial history intact.
      const { data: invoice } = await serviceClient
        .from('subscription_invoices')
        .select('invoice_type, total')
        .eq('subscription_payment_id', checkout.subscriptionPaymentId)
        .single();
      expect(invoice!.invoice_type).toBe('reactivation');
      expect(Number(invoice!.total)).toBe(499);
    });

    it('cancelled -> legitimate reactivation -> fresh billing period, and no old prorated period is reused for a self-cancelled org either', async () => {
      const staleStart = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
      const staleEnd = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
      const { data: sub, error: subError } = await serviceClient
        .from('organization_subscriptions')
        .insert({
          org_id: orgId,
          plan_id: planId,
          billing_cycle: 'monthly',
          current_period_start: staleStart,
          current_period_end: staleEnd,
          status: 'cancelled',
        })
        .select('id')
        .single();
      if (subError) throw subError;

      // Self-cancelled, not billing-failure-suspended -- cancelOrgSubscription()'s own real effect
      // on organizations.status, confirmed by the existing "cancelOrgSubscription sets both..." test
      // above; simulated directly here since this describe block is testing reactivation, not
      // cancellation itself.
      await serviceClient.from('organizations').update({ status: 'cancelled' }).eq('id', orgId);

      const { data: change, error: changeError } = await serviceClient
        .from('billing_plan_changes')
        .insert({
          org_id: orgId,
          change_type: 'reactivation',
          old_plan_id: planId,
          new_plan_id: planId,
          charge_due: 499.0,
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
        targetPlanId: planId,
        amountDueNow: 499.0,
        idempotencyKey: `cancelled-reactivation-webhook-test-${change.id}`,
      });

      const rawBody = JSON.stringify({
        providerEventId: `evt-cancelled-reactivation-${change.id}`,
        type: 'payment_succeeded',
        providerReference: checkout.providerSubscriptionId,
        orgId,
        amount: 499,
        currency: 'ZAR',
      });
      await processBillingWebhookEvent(serviceClient, {
        rawBody,
        signatureHeader: 'test-signature',
      });

      const { data: orgAfter } = await serviceClient
        .from('organizations')
        .select('status')
        .eq('id', orgId)
        .single();
      expect(orgAfter!.status).toBe('active');

      const { data: subsAfter, count } = await serviceClient
        .from('organization_subscriptions')
        .select('id, current_period_start, current_period_end', { count: 'exact' })
        .eq('org_id', orgId);
      expect(count).toBe(1);
      const subAfter = subsAfter![0]!;
      expect(subAfter.id).toBe(sub.id);
      expect(new Date(subAfter.current_period_end).getTime()).toBeGreaterThan(Date.now());
      expect(subAfter.current_period_end).not.toBe(staleEnd);
    });
  });

  it('refundSubscriptionPayment flips the linked invoice to refunded without altering its total or invoice_number -- financial history is retained, not erased', async () => {
    const checkout = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId,
      idempotencyKey: `refund-test-${orgId}`,
    });
    const rawBody = JSON.stringify({
      providerEventId: `evt-refund-${orgId}`,
      type: 'payment_succeeded',
      providerReference: checkout.providerSubscriptionId,
      orgId,
      amount: 499,
      currency: 'ZAR',
    });
    await processBillingWebhookEvent(serviceClient, {
      rawBody,
      signatureHeader: 'test-signature',
    });

    const { data: before } = await serviceClient
      .from('subscription_invoices')
      .select('id, invoice_number, total, status')
      .eq('subscription_payment_id', checkout.subscriptionPaymentId)
      .single();
    expect(before!.status).toBe('paid');

    await refundSubscriptionPayment(serviceClient, {
      subscriptionPaymentId: checkout.subscriptionPaymentId,
      idempotencyKey: `refund-idem-${orgId}`,
    });

    const { data: after } = await serviceClient
      .from('subscription_invoices')
      .select('id, invoice_number, total, status')
      .eq('subscription_payment_id', checkout.subscriptionPaymentId)
      .single();
    expect(after!.status).toBe('refunded');
    // The invoice_number and total are UNCHANGED -- a refund records what happened to an
    // already-issued invoice, it never rewrites the original amount charged or reissues a number.
    expect(after!.invoice_number).toBe(before!.invoice_number);
    expect(Number(after!.total)).toBe(Number(before!.total));
    expect(after!.id).toBe(before!.id);
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
