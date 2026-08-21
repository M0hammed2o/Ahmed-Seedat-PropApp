import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { setAddonCapacity } from '../addons';
import { MockBillingGatewayProvider } from '../providers/billing';

// Real integration test against the local Supabase instance, same pattern as
// billing.paymentMethodUpdate.test.ts -- covers V1 commercial UX pass add-on purchasing:
// server-derived pricing (never a client-supplied amount), the PayFast subscription amendment
// being called with base + BOTH add-on categories, annual billing NOT discounting the add-on
// price, and plan/removal validation.

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

describeIfSupabase('setAddonCapacity (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let principalUserId: string;
  let subscriptionId: string;
  const TOKEN = 'addon-test-token';

  async function createOrgOnPlan(planCode: string, billingCycle: 'monthly' | 'annual') {
    principalUserId = randomUUID();
    await serviceClient.auth.admin.createUser({
      user_metadata: {},
      email: `addon-${principalUserId}@test.propertyvault.example`,
      email_confirm: true,
      id: principalUserId,
    } as never);

    const { data: org } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Addon Vitest Org ${Date.now()}`, org_type: 'agency', status: 'active' })
      .select('id')
      .single();
    orgId = org!.id;

    await serviceClient.from('organization_members').insert({
      org_id: orgId,
      user_id: principalUserId,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    const { data: plan } = await serviceClient
      .from('plans')
      .select('id')
      .eq('code', planCode)
      .eq('billing_cycle', billingCycle)
      .single();

    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: sub } = await serviceClient
      .from('organization_subscriptions')
      .insert({
        org_id: orgId,
        plan_id: plan!.id,
        billing_cycle: billingCycle,
        current_period_start: new Date().toISOString().slice(0, 10),
        current_period_end: periodEnd,
        status: 'active',
        provider_subscription_token: TOKEN,
      })
      .select('id')
      .single();
    subscriptionId = sub!.id;
  }

  afterEach(async () => {
    await serviceClient.from('audit_events').delete().eq('org_id', orgId);
    await serviceClient.from('organization_members').delete().eq('org_id', orgId);
    await serviceClient.from('organization_subscriptions').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(principalUserId);
    vi.restoreAllMocks();
  });

  it('purchasing 1 extra property amends the subscription to base + addon and grants capacity only after success', async () => {
    await createOrgOnPlan('professional_monthly', 'monthly');
    const spy = vi.spyOn(MockBillingGatewayProvider.prototype, 'updateSubscriptionAmount');

    const result = await setAddonCapacity(serviceClient, {
      orgId,
      resourceType: 'property',
      targetQuantity: 1,
      actorUserId: principalUserId,
      idempotencyKey: `test-addon-${orgId}`,
    });

    expect(spy).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ amount: 699 + 99 }));
    expect(result.newQuantity).toBe(1);
    expect(result.newRecurringAmount).toBe(798);

    const { data: sub } = await serviceClient
      .from('organization_subscriptions')
      .select('purchased_extra_properties')
      .eq('id', subscriptionId)
      .single();
    expect(sub!.purchased_extra_properties).toBe(1);
  });

  it('an annual subscriber is charged the plain monthly add-on price times 12, never the 15% base discount', async () => {
    await createOrgOnPlan('professional_annual', 'annual');
    const spy = vi.spyOn(MockBillingGatewayProvider.prototype, 'updateSubscriptionAmount');

    const result = await setAddonCapacity(serviceClient, {
      orgId,
      resourceType: 'property',
      targetQuantity: 1,
      actorUserId: principalUserId,
      idempotencyKey: `test-addon-${orgId}`,
    });

    // professional_annual base is 7130; the add-on is R99/month, annualized as 99*12=1188, NOT
    // discounted the way the base plan's own annual price already is.
    expect(spy).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ amount: 7130 + 1188 }));
    expect(result.newRecurringAmount).toBe(8318);
  });

  it('combines BOTH add-on categories into one total when purchasing owner capacity on top of an existing property add-on', async () => {
    await createOrgOnPlan('professional_monthly', 'monthly');
    await serviceClient
      .from('organization_subscriptions')
      .update({ purchased_extra_properties: 2 })
      .eq('id', subscriptionId);
    const spy = vi.spyOn(MockBillingGatewayProvider.prototype, 'updateSubscriptionAmount');

    await setAddonCapacity(serviceClient, {
      orgId,
      resourceType: 'owner',
      targetQuantity: 1,
      actorUserId: principalUserId,
      idempotencyKey: `test-addon-${orgId}`,
    });

    // base 699 + 2 existing property slots (2*99=198) + 1 new owner slot (199) = 1096.
    expect(spy).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ amount: 1096 }));
  });

  it('a Starter org is rejected for either add-on -- capacity is never granted', async () => {
    await createOrgOnPlan('starter_monthly', 'monthly');
    const spy = vi.spyOn(MockBillingGatewayProvider.prototype, 'updateSubscriptionAmount');

    await expect(
      setAddonCapacity(serviceClient, {
        orgId,
        resourceType: 'property',
        targetQuantity: 1,
        actorUserId: principalUserId,
        idempotencyKey: `test-addon-${orgId}`,
      }),
    ).rejects.toThrow(/addon_not_supported_by_plan/);
    expect(spy).not.toHaveBeenCalled();

    const { data: sub } = await serviceClient
      .from('organization_subscriptions')
      .select('purchased_extra_properties')
      .eq('id', subscriptionId)
      .single();
    expect(sub!.purchased_extra_properties).toBe(0);
  });

  it('removing capacity that would put the org over its usage is rejected without calling the gateway', async () => {
    await createOrgOnPlan('professional_monthly', 'monthly');
    await serviceClient
      .from('organization_subscriptions')
      .update({ purchased_extra_properties: 1 })
      .eq('id', subscriptionId);
    // 16 properties in use (15 base + 1 purchased) -- removing the 1 purchased slot would leave
    // only 15 capacity for 16 properties.
    const rows = Array.from({ length: 16 }, (_, i) => ({
      org_id: orgId,
      nickname: `Prop ${i}`,
      address_line1: `${i} St`,
      city: 'Cape Town',
      country: 'ZA',
      property_type: 'house',
    }));
    await serviceClient.from('properties').insert(rows);
    const spy = vi.spyOn(MockBillingGatewayProvider.prototype, 'updateSubscriptionAmount');

    await expect(
      setAddonCapacity(serviceClient, {
        orgId,
        resourceType: 'property',
        targetQuantity: 0,
        actorUserId: principalUserId,
        idempotencyKey: `test-addon-${orgId}`,
      }),
    ).rejects.toThrow(/addon_removal_requires_selection/);
    // Rejected BEFORE the gateway is ever called -- an over-limit removal must never leave PayFast's
    // recurring amount already lowered while local capacity (what the org is actually allowed to
    // use) never followed.
    expect(spy).not.toHaveBeenCalled();

    const { data: sub } = await serviceClient
      .from('organization_subscriptions')
      .select('purchased_extra_properties')
      .eq('id', subscriptionId)
      .single();
    expect(sub!.purchased_extra_properties).toBe(1);

    await serviceClient.from('properties').delete().eq('org_id', orgId);
  });

  it('an org with no active PayFast subscription token is rejected before any gateway call', async () => {
    await createOrgOnPlan('professional_monthly', 'monthly');
    await serviceClient
      .from('organization_subscriptions')
      .update({ provider_subscription_token: null })
      .eq('id', subscriptionId);
    const spy = vi.spyOn(MockBillingGatewayProvider.prototype, 'updateSubscriptionAmount');

    await expect(
      setAddonCapacity(serviceClient, {
        orgId,
        resourceType: 'property',
        targetQuantity: 1,
        actorUserId: principalUserId,
        idempotencyKey: `test-addon-${orgId}`,
      }),
    ).rejects.toThrow(/no_active_subscription_token/);
    expect(spy).not.toHaveBeenCalled();
  });
});
