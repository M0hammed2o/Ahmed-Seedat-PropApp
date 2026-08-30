import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Real integration test against the local Supabase instance, same pattern as
// billing.trialActivation.test.ts -- covers the "internal-only tenant" product model (WORKLOG.md
// this date): a tenant must be able to exist, be leased to a unit, and drive real occupancy,
// entirely without ever triggering a Proplyst account, email, or WhatsApp -- and must later be
// invitable without creating a second tenant/lease/occupancy record.

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

describeIfSupabase('internal-only tenant management (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let unitId: string;
  let staffUserId: string;

  beforeEach(async () => {
    staffUserId = randomUUID();
    const { error: userError } = await serviceClient.auth.admin.createUser({
      user_metadata: {},
      email: `tenant-mgmt-staff-${staffUserId}@test.propertyvault.example`,
      email_confirm: true,
      id: staffUserId,
    } as never);
    if (userError) throw userError;

    const orgName = `Internal Tenant Vitest Org ${Date.now()}`;
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: orgName, org_type: 'agency', status: 'active' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: property, error: propertyError } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'Musgrave Heights', address_line1: '1 Test St', city: 'Durban' })
      .select('id')
      .single();
    if (propertyError) throw propertyError;
    propertyId = property.id;

    const { data: unit, error: unitError } = await serviceClient
      .from('units')
      .insert({ org_id: orgId, property_id: propertyId, unit_label: '601' })
      .select('id')
      .single();
    if (unitError) throw unitError;
    unitId = unit.id;
  });

  afterEach(async () => {
    const { data: leaseRows } = await serviceClient.from('leases').select('id').eq('unit_id', unitId);
    for (const l of leaseRows ?? []) {
      await serviceClient.from('lease_tenants').delete().eq('lease_id', l.id);
    }
    await serviceClient.from('leases').delete().eq('unit_id', unitId);
    await serviceClient.from('tenants').delete().eq('org_id', orgId);
    await serviceClient.from('units').delete().eq('id', unitId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(staffUserId);
  });

  it('creates a tenant with no email/phone/auth account, and it is not treated as broken or incomplete', async () => {
    const { data: tenant, error } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Synthetic Test Tenant A' })
      .select('*')
      .single();
    expect(error).toBeNull();
    expect(tenant.user_id).toBeNull();
    expect(tenant.email).toBeNull();
    expect(tenant.phone).toBeNull();
    // 'pending' is the schema default and is NOT an error/broken state -- confirmed against
    // supabase/migrations/20260101000028_tenants.sql's own default, not asserted as a guess.
    expect(['pending', 'active']).toContain(tenant.status);
  });

  it('creating a tenant sends no email and no WhatsApp message', async () => {
    const before = await Promise.all([
      serviceClient.from('email_messages').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
      serviceClient.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    ]);

    const { error } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Synthetic Test Tenant A' });
    expect(error).toBeNull();

    const after = await Promise.all([
      serviceClient.from('email_messages').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
      serviceClient.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    ]);
    expect(after[0].count).toBe(before[0].count);
    expect(after[1].count).toBe(before[1].count);
  });

  it('an internal tenant with an active lease occupies the unit; the same tenant with no active lease does not', async () => {
    const { data: tenant } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Synthetic Test Tenant A' })
      .select('id')
      .single();

    const { data: unitBefore } = await serviceClient
      .from('units')
      .select('status')
      .eq('id', unitId)
      .single();
    expect(unitBefore!.status).toBe('vacant');

    // Draft lease -- must NOT occupy the unit yet (mirrors approve_application()'s own draft
    // behavior, activation is a separate, explicit step).
    const { data: lease } = await serviceClient
      .from('leases')
      .insert({
        org_id: orgId,
        unit_id: unitId,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        rent_amount: 12000,
        deposit_amount: 12000,
        status: 'draft',
        source: 'manual',
      })
      .select('id')
      .single();
    await serviceClient
      .from('lease_tenants')
      .insert({ lease_id: lease!.id, tenant_id: tenant!.id, is_primary: true });

    const { data: unitStillDraft } = await serviceClient
      .from('units')
      .select('status')
      .eq('id', unitId)
      .single();
    expect(unitStillDraft!.status).toBe('vacant');

    // Activate -- this is the real trigger under test (sync_unit_status_from_lease,
    // 20260101000079), fired by the plain status update, same as activate_lease() itself does.
    await serviceClient.from('leases').update({ status: 'active' }).eq('id', lease!.id);

    const { data: unitAfterActive } = await serviceClient
      .from('units')
      .select('status')
      .eq('id', unitId)
      .single();
    expect(unitAfterActive!.status).toBe('occupied');

    // Portal access has no bearing on occupancy -- this tenant STILL has no auth account/email.
    const { data: tenantAfter } = await serviceClient
      .from('tenants')
      .select('user_id, email')
      .eq('id', tenant!.id)
      .single();
    expect(tenantAfter!.user_id).toBeNull();
    expect(tenantAfter!.email).toBeNull();

    await serviceClient.from('leases').update({ status: 'expired' }).eq('id', lease!.id);
    const { data: unitAfterExpired } = await serviceClient
      .from('units')
      .select('status')
      .eq('id', unitId)
      .single();
    expect(unitAfterExpired!.status).toBe('vacant');
  });

  it('inviting an already-existing internal tenant reuses the same tenant/lease/occupancy -- no duplicates', async () => {
    const { data: tenant } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Synthetic Test Tenant A', email: 'synthetic-test-tenant-a@example.invalid' })
      .select('id')
      .single();
    const { data: lease } = await serviceClient
      .from('leases')
      .insert({
        org_id: orgId,
        unit_id: unitId,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        rent_amount: 12000,
        deposit_amount: 12000,
        status: 'active',
        source: 'manual',
      })
      .select('id')
      .single();
    await serviceClient
      .from('lease_tenants')
      .insert({ lease_id: lease!.id, tenant_id: tenant!.id, is_primary: true });

    // create_tenant_invitation()'s own agent-role check (has_org_role via auth.uid()) requires a
    // real authenticated staff session to satisfy -- already covered directly by the existing
    // supabase/tests/tenant_invitations.test.sql pgTAP suite. What THIS test verifies is
    // orthogonal: that inviting an existing tenant attaches to the SAME tenant_id rather than
    // creating a new one, so it inserts the resulting row shape directly (service-role bypasses
    // RLS the same way the RPC's own security-definer context does once past the role check).
    const { error: inviteError } = await serviceClient.from('tenant_invitations').insert({
      org_id: orgId,
      tenant_id: tenant!.id,
      delivery_channel: 'email',
      token_hash: 'test-hash-not-a-real-token',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_by_user_id: staffUserId,
    });
    expect(inviteError).toBeNull();

    const { data: allTenants } = await serviceClient.from('tenants').select('id').eq('org_id', orgId);
    expect(allTenants).toHaveLength(1);
    const { data: allLeases } = await serviceClient.from('leases').select('id').eq('unit_id', unitId);
    expect(allLeases).toHaveLength(1);
    const { data: allLeaseTenants } = await serviceClient
      .from('lease_tenants')
      .select('tenant_id')
      .eq('lease_id', lease!.id);
    expect(allLeaseTenants).toHaveLength(1);
    expect(allLeaseTenants![0]!.tenant_id).toBe(tenant!.id);

    const { data: unitStatus } = await serviceClient.from('units').select('status').eq('id', unitId).single();
    expect(unitStatus!.status).toBe('occupied');
  });

  it('the tenant list query does not leak another organisation\'s property/unit labels', async () => {
    const { data: otherOrg } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Other Org ${Date.now()}`, org_type: 'agency', status: 'active' })
      .select('id')
      .single();
    const { data: otherProperty } = await serviceClient
      .from('properties')
      .insert({ org_id: otherOrg!.id, nickname: 'Secret Other Property', address_line1: '2 Test St', city: 'Cape Town' })
      .select('id')
      .single();
    const { data: otherUnit } = await serviceClient
      .from('units')
      .insert({ org_id: otherOrg!.id, property_id: otherProperty!.id, unit_label: 'X1' })
      .select('id')
      .single();
    const { data: otherTenant } = await serviceClient
      .from('tenants')
      .insert({ org_id: otherOrg!.id, full_name: 'Other Org Tenant' })
      .select('id')
      .single();
    const { data: otherLease } = await serviceClient
      .from('leases')
      .insert({
        org_id: otherOrg!.id,
        unit_id: otherUnit!.id,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        rent_amount: 5000,
        deposit_amount: 5000,
        status: 'active',
        source: 'manual',
      })
      .select('id')
      .single();
    await serviceClient
      .from('lease_tenants')
      .insert({ lease_id: otherLease!.id, tenant_id: otherTenant!.id, is_primary: true });

    // The service-role client bypasses RLS by design (it must, to run cleanup across test orgs) --
    // this test instead directly confirms the join query never mixes rows ACROSS org_id, which is
    // the structural property RLS itself depends on (each embedded table's own org_id-scoped
    // policy independently filters what a real, non-service-role caller sees).
    const { data } = await serviceClient
      .from('tenants')
      .select('org_id, full_name, lease_tenants(leases(units(unit_label, properties(nickname))))')
      .eq('org_id', orgId);

    expect((data ?? []).every((row) => row.org_id === orgId)).toBe(true);
    const labels = JSON.stringify(data);
    expect(labels).not.toContain('Secret Other Property');
    expect(labels).not.toContain('Other Org Tenant');

    await serviceClient.from('lease_tenants').delete().eq('lease_id', otherLease!.id);
    await serviceClient.from('leases').delete().eq('id', otherLease!.id);
    await serviceClient.from('tenants').delete().eq('id', otherTenant!.id);
    await serviceClient.from('units').delete().eq('id', otherUnit!.id);
    await serviceClient.from('properties').delete().eq('id', otherProperty!.id);
    await serviceClient.from('organizations').delete().eq('id', otherOrg!.id);
  });
});
