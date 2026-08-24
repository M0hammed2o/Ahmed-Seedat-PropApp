import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startSubscriptionCheckout, startTrialActivationCheckout } from '../billing';

// Subscription integrity fix (this date): a read-only production audit found Mo's Properties with
// 2 simultaneous organization_subscriptions rows -- root-caused to startSubscriptionCheckout()/
// startTrialActivationCheckout() inserting a new row unconditionally on every call, with nothing
// to stop a retry/double-click from creating a second one before the first ever resolved. This
// file proves the fix (findOrCreateCurrentSubscriptionForCheckout(), lib/billing.ts): reuse an
// existing unresolved row, and the new organization_subscriptions_one_current_per_org unique index
// (migration 20260101000126) as the real, DB-enforced backstop against a genuine concurrent race.
// Real integration test against the local Supabase instance, same pattern as billing.test.ts.

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

describeIfSupabase('checkout idempotency (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let principalUserId: string;
  let starterPlanId: string;
  let professionalPlanId: string;

  beforeEach(async () => {
    const orgName = `Checkout Idempotency Vitest Org ${Date.now()}`;
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: orgName, org_type: 'agency', status: 'trial' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    principalUserId = crypto.randomUUID();
    const { error: userError } = await serviceClient.auth.admin.createUser({
      email: `checkout-idempotency-${principalUserId}@test.propertyvault.example`,
      email_confirm: true,
      id: principalUserId,
    } as never);
    if (userError) throw userError;

    const { error: memberError } = await serviceClient.from('organization_members').insert({
      org_id: orgId,
      user_id: principalUserId,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    if (memberError) throw memberError;

    const { data: starter } = await serviceClient
      .from('plans')
      .select('id')
      .eq('code', 'starter_monthly')
      .single();
    starterPlanId = starter!.id;
    const { data: professional } = await serviceClient
      .from('plans')
      .select('id')
      .eq('code', 'professional_monthly')
      .single();
    professionalPlanId = professional!.id;
  });

  afterEach(async () => {
    await serviceClient.from('billing_events').delete().eq('org_id', orgId);
    await serviceClient.from('subscription_invoices').delete().eq('org_id', orgId);
    await serviceClient.from('subscription_payments').delete().eq('org_id', orgId);
    await serviceClient.from('organization_subscriptions').delete().eq('org_id', orgId);
    await serviceClient.from('organization_members').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(principalUserId);
  });

  it('double-clicking startSubscriptionCheckout (same org, before either resolves) creates exactly one organization_subscriptions row', async () => {
    const first = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId: starterPlanId,
      idempotencyKey: `dbl-click-1-${orgId}`,
    });
    const second = await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId: starterPlanId,
      idempotencyKey: `dbl-click-2-${orgId}`,
    });

    const { data: subs } = await serviceClient
      .from('organization_subscriptions')
      .select('id, status')
      .eq('org_id', orgId);
    expect(subs).toHaveLength(1);
    expect(subs![0]!.status).toBe('trial');

    // Two distinct payment attempts are still recorded (each checkout call is a real, separate
    // gateway checkout attempt) -- what must not duplicate is the subscription row itself.
    const { data: payments } = await serviceClient
      .from('subscription_payments')
      .select('id')
      .eq('org_id', orgId);
    expect(payments).toHaveLength(2);
    expect(first.subscriptionPaymentId).not.toBe(second.subscriptionPaymentId);
  });

  it('resubmitting startTrialActivationCheckout for a different plan redirects the SAME unresolved trial row instead of creating a second one', async () => {
    await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'starter',
      interval: 'monthly',
      idempotencyKey: `resubmit-1-${orgId}`,
    });

    const { data: subsAfterFirst } = await serviceClient
      .from('organization_subscriptions')
      .select('id, plan_id')
      .eq('org_id', orgId);
    expect(subsAfterFirst).toHaveLength(1);
    expect(subsAfterFirst![0]!.plan_id).toBe(starterPlanId);
    const firstRowId = subsAfterFirst![0]!.id;

    // The customer changes their mind mid-checkout and picks Professional instead, before ever
    // completing the first PayFast redirect.
    await startTrialActivationCheckout(serviceClient, {
      orgId,
      principalUserId,
      planTier: 'professional',
      interval: 'monthly',
      idempotencyKey: `resubmit-2-${orgId}`,
    });

    const { data: subsAfterSecond } = await serviceClient
      .from('organization_subscriptions')
      .select('id, plan_id, status')
      .eq('org_id', orgId);
    expect(subsAfterSecond).toHaveLength(1);
    expect(subsAfterSecond![0]!.id).toBe(firstRowId);
    expect(subsAfterSecond![0]!.plan_id).toBe(professionalPlanId);
    expect(subsAfterSecond![0]!.status).toBe('trial');
  });

  it('a concurrent-request race (two inserts attempted simultaneously) still converges to exactly one current row, via the unique index', async () => {
    // Simulate the race window directly: both requests read "no existing current row" before
    // either has inserted, then both attempt to insert. The DB constraint -- not app-level
    // check-then-act -- is what actually prevents two current rows here.
    const basePayload = {
      org_id: orgId,
      plan_id: starterPlanId,
      billing_cycle: 'monthly',
      current_period_start: new Date().toISOString().slice(0, 10),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      status: 'trial' as const,
    };

    const [a, b] = await Promise.all([
      serviceClient.from('organization_subscriptions').insert(basePayload).select('id').single(),
      serviceClient.from('organization_subscriptions').insert(basePayload).select('id').single(),
    ]);

    const succeeded = [a, b].filter((r) => !r.error);
    const failed = [a, b].filter((r) => r.error);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error!.code).toBe('23505');

    const { data: subs } = await serviceClient
      .from('organization_subscriptions')
      .select('id')
      .eq('org_id', orgId);
    expect(subs).toHaveLength(1);
  });

  it('a checkout attempt against an org that already has an ACTIVE subscription reuses that row by id, without rewriting its plan', async () => {
    const { data: activeSub, error } = await serviceClient
      .from('organization_subscriptions')
      .insert({
        org_id: orgId,
        plan_id: professionalPlanId,
        billing_cycle: 'monthly',
        current_period_start: new Date().toISOString().slice(0, 10),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        status: 'active',
      })
      .select('id')
      .single();
    if (error) throw error;

    // A stray/redundant checkout call against an already-active org (e.g. a stale page) must not
    // silently downgrade the org's real, paid-for plan.
    await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId: starterPlanId,
      idempotencyKey: `already-active-${orgId}`,
    });

    const { data: subs } = await serviceClient
      .from('organization_subscriptions')
      .select('id, plan_id, status')
      .eq('org_id', orgId);
    expect(subs).toHaveLength(1);
    expect(subs![0]!.id).toBe(activeSub!.id);
    expect(subs![0]!.plan_id).toBe(professionalPlanId);
    expect(subs![0]!.status).toBe('active');
  });

  it('after cancellation, a fresh checkout is allowed to create a genuinely new current row (reactivation) alongside the cancelled history row', async () => {
    const { error } = await serviceClient.from('organization_subscriptions').insert({
      org_id: orgId,
      plan_id: starterPlanId,
      billing_cycle: 'monthly',
      current_period_start: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      current_period_end: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      status: 'cancelled',
    });
    if (error) throw error;

    await startSubscriptionCheckout(serviceClient, {
      orgId,
      planId: professionalPlanId,
      idempotencyKey: `reactivation-${orgId}`,
    });

    const { data: subs } = await serviceClient
      .from('organization_subscriptions')
      .select('id, status')
      .eq('org_id', orgId);
    expect(subs).toHaveLength(2);
    expect(subs!.filter((s) => s.status === 'cancelled')).toHaveLength(1);
    expect(subs!.filter((s) => s.status === 'trial')).toHaveLength(1);
  });
});
