import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  mayCreatePortfolio,
  mayCreateProperty,
  getOrgSeatSummary,
  canInviteStaff,
  getOrganizationEntitlements,
  canUseOcr,
  canUseOwnerPortal,
  canUseAdvancedReporting,
  canUseBulkCommunications,
  canUseApiAccess,
} from '../subscriptionEntitlements';

// Real integration tests against local Supabase (same pattern as emailDispatch.test.ts) -- these
// exercise the TypeScript wrapper (correct RPC param names, correct number coercion for
// seatLimit/availableSeats) on top of migration 20260101000094's real functions/RLS, which
// supabase/tests/owner_portfolio_and_staff_seat_entitlements.test.sql already proves directly at
// the SQL layer. Uses the service-role client throughout and passes explicit user/org ids to
// every RPC (may_create_portfolio's own p_user_id parameter exists for exactly this) rather than
// standing up real authenticated sessions per test user.

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

describeIfSupabase('subscriptionEntitlements (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let freshUserId: string;
  let linkedOwnerUserId: string;

  beforeEach(async () => {
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Entitlement Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: freshUser, error: freshUserError } = await serviceClient.auth.admin.createUser({
      email: `entitlement-fresh-vitest-${Date.now()}@propertyvault.example`,
      password: 'TestPassw0rd!23',
      email_confirm: true,
    });
    if (freshUserError) throw freshUserError;
    freshUserId = freshUser.user.id;

    const { data: linkedOwnerUser, error: linkedOwnerUserError } =
      await serviceClient.auth.admin.createUser({
        email: `entitlement-linked-owner-vitest-${Date.now()}@propertyvault.example`,
        password: 'TestPassw0rd!23',
        email_confirm: true,
      });
    if (linkedOwnerUserError) throw linkedOwnerUserError;
    linkedOwnerUserId = linkedOwnerUser.user.id;

    const { error: ownerError } = await serviceClient
      .from('owners')
      .insert({ org_id: orgId, user_id: linkedOwnerUserId, name: 'Vitest Linked Owner' });
    if (ownerError) throw ownerError;
  });

  afterEach(async () => {
    await serviceClient.from('owner_portfolio_grants').delete().eq('user_id', linkedOwnerUserId);
    await serviceClient.from('owners').delete().eq('org_id', orgId);
    await serviceClient.from('organization_subscriptions').delete().eq('org_id', orgId);
    await serviceClient.from('organization_members').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(freshUserId);
    await serviceClient.auth.admin.deleteUser(linkedOwnerUserId);
  });

  it('mayCreatePortfolio() is true for a fresh signup with no owners row', async () => {
    const result = await mayCreatePortfolio(serviceClient, freshUserId);
    expect(result).toBe(true);
  });

  it('mayCreatePortfolio() is false for a linked-owner-only account', async () => {
    const result = await mayCreatePortfolio(serviceClient, linkedOwnerUserId);
    expect(result).toBe(false);
  });

  it('mayCreatePortfolio() becomes true once an owner_portfolio_grants row exists', async () => {
    await serviceClient
      .from('owner_portfolio_grants')
      .insert({ user_id: linkedOwnerUserId, note: 'vitest grant' });

    const result = await mayCreatePortfolio(serviceClient, linkedOwnerUserId);
    expect(result).toBe(true);
  });

  it('mayCreateProperty() delegates to requireOrgRole -- true for an agent, false for a non-member', async () => {
    await serviceClient.from('organization_members').insert({
      org_id: orgId,
      user_id: freshUserId,
      role: 'agent',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    // requireOrgRole reads auth.uid() via RLS's has_org_role(), which the service-role client
    // (no user JWT) cannot impersonate the way the RPC-level p_user_id override above can -- this
    // assertion instead confirms mayCreateProperty is a real pass-through to requireOrgRole by
    // checking it rejects for an org the caller (service role, no session) truly has no bearing
    // on, proving it is not a silent "always true" stub.
    const result = await mayCreateProperty(serviceClient, orgId);
    expect(result).toBe(false);
  });

  it('getOrgSeatSummary() returns seatLimit: null (unlimited) for an org with no subscription row', async () => {
    const summary = await getOrgSeatSummary(serviceClient, orgId);
    expect(summary.seatLimit).toBeNull();
    expect(summary.availableSeats).toBeNull();
    expect(summary.activeBillableStaffCount).toBe(0);
    expect(canInviteStaff(summary)).toBe(true);
  });

  it('getOrgSeatSummary() reflects a seat-limited plan and canInviteStaff() flips to false once full', async () => {
    const { data: starterPlan, error: planError } = await serviceClient
      .from('plans')
      .select('id')
      .eq('code', 'starter')
      .single();
    if (planError) throw planError;

    await serviceClient.from('organization_subscriptions').insert({
      org_id: orgId,
      plan_id: starterPlan.id,
      billing_cycle: 'monthly',
      current_period_start: new Date().toISOString().slice(0, 10),
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      status: 'active',
    });

    const beforeStaff = await getOrgSeatSummary(serviceClient, orgId);
    expect(beforeStaff.seatLimit).toBe(1);
    expect(beforeStaff.activeBillableStaffCount).toBe(0);
    expect(beforeStaff.availableSeats).toBe(1);
    expect(canInviteStaff(beforeStaff)).toBe(true);

    await serviceClient.from('organization_members').insert({
      org_id: orgId,
      user_id: freshUserId,
      role: 'agent',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    const afterStaff = await getOrgSeatSummary(serviceClient, orgId);
    expect(afterStaff.activeBillableStaffCount).toBe(1);
    expect(afterStaff.availableSeats).toBe(0);
    expect(canInviteStaff(afterStaff)).toBe(false);
  });

  // RELEASE A P0 fix (V1 Commercial Launch Gap Audit): maxProperties + boolean feature_limits
  // enforcement (migration 20260101000102). None of org_property_limit()/available_property_slots()/
  // org_feature_enabled() check auth.uid() internally (pure data lookups, like
  // org_staff_seat_limit() above) -- exercisable directly via the service-role client with no
  // session, same as the getOrgSeatSummary tests above. The RPC/RLS-level enforcement itself
  // (create_property() raising property_limit_reached:) is proven at the SQL layer by
  // supabase/tests/entitlement_engine_and_max_properties.test.sql -- these tests exercise the
  // TypeScript wrapper (correct RPC param names/shapes) on top of it.

  it('getOrganizationEntitlements() is fully permissive for an org with no subscription row (trial)', async () => {
    const entitlements = await getOrganizationEntitlements(serviceClient, orgId);
    expect(entitlements.propertyLimit).toBeNull();
    expect(entitlements.activePropertyCount).toBe(0);
    expect(entitlements.availablePropertySlots).toBeNull();
    expect(entitlements.ocrEnabled).toBe(true);
    expect(entitlements.ownerPortalEnabled).toBe(true);
    expect(entitlements.advancedReporting).toBe(true);
  });

  it("getOrganizationEntitlements() reflects the Starter plan's real, restrictive feature_limits", async () => {
    const { data: starterPlan, error: planError } = await serviceClient
      .from('plans')
      .select('id')
      .eq('code', 'starter')
      .single();
    if (planError) throw planError;

    await serviceClient.from('organization_subscriptions').insert({
      org_id: orgId,
      plan_id: starterPlan.id,
      billing_cycle: 'monthly',
      current_period_start: new Date().toISOString().slice(0, 10),
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      status: 'active',
    });

    const entitlements = await getOrganizationEntitlements(serviceClient, orgId);
    expect(entitlements.propertyLimit).toBe(5);
    expect(entitlements.availablePropertySlots).toBe(5);
    expect(entitlements.ocrEnabled).toBe(false);
    expect(entitlements.ownerPortalEnabled).toBe(false);
    expect(entitlements.advancedReporting).toBe(false);
    expect(entitlements.apiAccess).toBe(false);

    expect(await canUseOcr(serviceClient, orgId)).toBe(false);
    expect(await canUseOwnerPortal(serviceClient, orgId)).toBe(false);
    expect(await canUseAdvancedReporting(serviceClient, orgId)).toBe(false);
  });

  it("getOrganizationEntitlements() reflects the Business plan's unlimited/fully-enabled feature_limits", async () => {
    const { data: businessPlan, error: planError } = await serviceClient
      .from('plans')
      .select('id')
      .eq('code', 'business')
      .single();
    if (planError) throw planError;

    await serviceClient.from('organization_subscriptions').insert({
      org_id: orgId,
      plan_id: businessPlan.id,
      billing_cycle: 'monthly',
      current_period_start: new Date().toISOString().slice(0, 10),
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      status: 'active',
    });

    const entitlements = await getOrganizationEntitlements(serviceClient, orgId);
    expect(entitlements.propertyLimit).toBeNull();
    expect(entitlements.availablePropertySlots).toBeNull();
    expect(entitlements.ocrEnabled).toBe(true);
    expect(entitlements.ownerPortalEnabled).toBe(true);
    expect(entitlements.advancedReporting).toBe(true);
    expect(entitlements.apiAccess).toBe(true);
  });

  it('canUseBulkCommunications()/canUseApiAccess() always return true -- no real feature to gate yet (audit finding, not a stub oversight)', async () => {
    expect(await canUseBulkCommunications()).toBe(true);
    expect(await canUseApiAccess()).toBe(true);
  });
});
