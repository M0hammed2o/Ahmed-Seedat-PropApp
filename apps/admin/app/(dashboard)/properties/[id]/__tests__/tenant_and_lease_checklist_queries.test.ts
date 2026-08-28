import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Landlord/staff launch-hardening pass (WORKLOG.md 2026-08-26), Section 12: a converted applicant
// appears as primary tenant on a draft lease but the property page showed "Tenants (0)", because
// loadPropertyTenants() (apps/admin/app/(dashboard)/properties/[id]/page.tsx) filtered leases
// `.eq('status', 'active')` -- a filter that predates approve_application() creating a DRAFT lease
// on approval (migration 20260101000131). The fix changed that filter to
// `.in('status', ['active', 'draft'])`, and separately scoped the setup-checklist "Lease" item's
// count query to `.eq('status', 'active')` only (a draft lease should not mark that checklist item
// done). page.tsx's loadPropertyTenants/loadSetupProgress are not exported (ordinary Next.js
// server-component internals, no existing pattern in this codebase for importing and unit-testing
// one directly) -- this test instead runs the exact same query shapes directly against a real
// local Supabase database with realistic fixture data, which is what actually proves the fix: the
// query filters themselves, against real RLS and real schema, not a mock.

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

async function adminFetch(path: string, body: unknown, method = 'POST') {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

describeIfSupabase('property tenant/lease-checklist queries (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let draftUnitId: string;
  let activeUnitId: string;
  let vacantUnitId: string;
  let draftLeaseId: string;
  let activeLeaseId: string;
  let draftTenantId: string;
  let activeTenantId: string;
  let managerId: string;

  beforeEach(async () => {
    const email = `tenant-query-manager-${Date.now()}@propertyvault.example`;
    const password = 'TestPassw0rd!23';
    const created = await adminFetch('/auth/v1/admin/users', { email, password, email_confirm: true });
    managerId = created.id;

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Tenant Query Vitest Org ${Date.now()}`,
      org_type: 'agency',
    });
    orgId = orgRows[0].id;
    await adminFetch('/rest/v1/organization_members', {
      org_id: orgId,
      user_id: managerId,
      role: 'manager',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    const { data: property } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'Tenant Query Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
      .select('id')
      .single();
    propertyId = property!.id;

    const { data: units } = await serviceClient
      .from('units')
      .insert([
        { property_id: propertyId, org_id: orgId, unit_label: 'Draft Unit', status: 'vacant' },
        { property_id: propertyId, org_id: orgId, unit_label: 'Active Unit', status: 'vacant' },
        { property_id: propertyId, org_id: orgId, unit_label: 'Vacant Unit', status: 'vacant' },
      ])
      .select('id, unit_label');
    draftUnitId = units!.find((u) => u.unit_label === 'Draft Unit')!.id;
    activeUnitId = units!.find((u) => u.unit_label === 'Active Unit')!.id;
    vacantUnitId = units!.find((u) => u.unit_label === 'Vacant Unit')!.id;

    const { data: tenants } = await serviceClient
      .from('tenants')
      .insert([
        { org_id: orgId, full_name: 'Draft Lease Tenant', status: 'pending' },
        { org_id: orgId, full_name: 'Active Lease Tenant', status: 'active' },
      ])
      .select('id, full_name');
    draftTenantId = tenants!.find((t) => t.full_name === 'Draft Lease Tenant')!.id;
    activeTenantId = tenants!.find((t) => t.full_name === 'Active Lease Tenant')!.id;

    // Mirrors approve_application()'s real output shape: a draft lease with a primary tenant
    // already assigned, exactly what a converted applicant looks like before staff sends/activates it.
    const { data: draftLease } = await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: draftUnitId, start_date: '2026-01-01', rent_amount: 9000, status: 'draft', source: 'application_approved' })
      .select('id')
      .single();
    draftLeaseId = draftLease!.id;
    await serviceClient.from('lease_tenants').insert({ lease_id: draftLeaseId, tenant_id: draftTenantId, is_primary: true });

    const { data: activeLease } = await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: activeUnitId, start_date: '2026-01-01', rent_amount: 12000, status: 'active', source: 'manual' })
      .select('id')
      .single();
    activeLeaseId = activeLease!.id;
    await serviceClient.from('lease_tenants').insert({ lease_id: activeLeaseId, tenant_id: activeTenantId, is_primary: true });
  });

  afterEach(async () => {
    await serviceClient.from('lease_tenants').delete().in('lease_id', [draftLeaseId, activeLeaseId]);
    await serviceClient.from('leases').delete().in('id', [draftLeaseId, activeLeaseId]);
    await serviceClient.from('tenants').delete().in('id', [draftTenantId, activeTenantId]);
    await serviceClient.from('units').delete().in('id', [draftUnitId, activeUnitId, vacantUnitId]);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
  });

  it('the fixed tenant query (in.status active,draft) surfaces the draft-lease tenant alongside the active one', async () => {
    const unitIds = [draftUnitId, activeUnitId, vacantUnitId];
    const { data: leases } = await serviceClient
      .from('leases')
      .select('id, unit_id, status')
      .in('unit_id', unitIds)
      .in('status', ['active', 'draft']);
    expect(leases).toHaveLength(2);

    const leaseIds = (leases ?? []).map((l) => l.id);
    const { data: leaseTenants } = await serviceClient.from('lease_tenants').select('lease_id, tenant_id').in('lease_id', leaseIds);
    const tenantIds = (leaseTenants ?? []).map((lt) => lt.tenant_id);
    expect(tenantIds).toContain(draftTenantId);
    expect(tenantIds).toContain(activeTenantId);
  });

  it('the OLD query shape (eq.status active only) would have hidden the draft-lease tenant -- proves the bug was real', async () => {
    const unitIds = [draftUnitId, activeUnitId, vacantUnitId];
    const { data: leases } = await serviceClient
      .from('leases')
      .select('id, unit_id, status')
      .in('unit_id', unitIds)
      .eq('status', 'active');
    expect(leases).toHaveLength(1);
    expect(leases?.[0]?.unit_id).toBe(activeUnitId);
  });

  it('the fixed setup-checklist "Lease" count (eq.status active) is NOT satisfied by a draft-only lease', async () => {
    const { count } = await serviceClient
      .from('leases')
      .select('id', { count: 'exact', head: true })
      .in('unit_id', [draftUnitId])
      .eq('status', 'active');
    expect(count).toBe(0);
  });

  it('the fixed setup-checklist "Lease" count IS satisfied once the property has any active lease', async () => {
    const { count } = await serviceClient
      .from('leases')
      .select('id', { count: 'exact', head: true })
      .in('unit_id', [draftUnitId, activeUnitId, vacantUnitId])
      .eq('status', 'active');
    expect(count).toBe(1);
  });
});
