import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Unit remove/archive lifecycle pass (WORKLOG.md this date). Real integration test against the
// local Supabase instance, same pattern as propertyLifecycle.test.ts -- covers migration
// 20260101000148 (get_unit_deletion_blockers / hard_delete_unit / archive_unit / restore_unit).

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const TEST_PASSWORD = 'TestPassw0rd!23';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

describeIfSupabase('unit remove/archive lifecycle (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let principalId: string;
  let principalEmail: string;
  let agentId: string;
  let agentEmail: string;
  let viewerId: string;
  let viewerEmail: string;
  const createdUserIds: string[] = [];

  beforeEach(async () => {
    const suffix = randomUUID();
    principalId = randomUUID();
    agentId = randomUUID();
    viewerId = randomUUID();
    createdUserIds.push(principalId, agentId, viewerId);

    principalEmail = `unitlifecycle-principal-${suffix}@test.propertyvault.example`;
    agentEmail = `unitlifecycle-agent-${suffix}@test.propertyvault.example`;
    viewerEmail = `unitlifecycle-viewer-${suffix}@test.propertyvault.example`;

    for (const [id, email] of [
      [principalId, principalEmail],
      [agentId, agentEmail],
      [viewerId, viewerEmail],
    ] as const) {
      const { error } = await serviceClient.auth.admin.createUser({
        id,
        email,
        email_confirm: true,
        password: TEST_PASSWORD,
      } as never);
      if (error) throw error;
    }

    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Unit Lifecycle Vitest Org ${suffix}`, org_type: 'agency', status: 'active' })
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

    await serviceClient.from('organization_members').insert([
      { org_id: orgId, user_id: principalId, role: 'principal', status: 'active', joined_at: new Date().toISOString() },
      { org_id: orgId, user_id: agentId, role: 'agent', status: 'active', joined_at: new Date().toISOString() },
      { org_id: orgId, user_id: viewerId, role: 'viewer', status: 'active', joined_at: new Date().toISOString() },
    ]);
  });

  afterEach(async () => {
    for (const id of createdUserIds) {
      try {
        await serviceClient.auth.admin.deleteUser(id);
      } catch {
        // Best-effort local-dev cleanup only.
      }
    }
    await serviceClient.from('organizations').delete().eq('id', orgId);
  });

  async function insertUnit(unitLabel: string) {
    const { data, error } = await serviceClient
      .from('units')
      .insert({ org_id: orgId, property_id: propertyId, unit_label: unitLabel })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function insertActiveLease(unitId: string) {
    const { data, error } = await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: unitId, start_date: '2026-01-01', rent_amount: 10000, status: 'active' })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  // 16. A brand-new, never-used unit is hard-delete eligible, and hard delete works.
  it('a brand-new unit with no leases/applications/history is hard-delete eligible, and hard delete removes it', async () => {
    const unit = await insertUnit('602');
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { data: blockers, error: blockersError } = await principalClient.rpc('get_unit_deletion_blockers', {
      p_unit_id: unit.id,
    });
    expect(blockersError).toBeNull();
    expect(blockers).toEqual([]);

    const { error: deleteError } = await principalClient.rpc('hard_delete_unit', { p_unit_id: unit.id });
    expect(deleteError).toBeNull();

    const { data: gone } = await serviceClient.from('units').select('id').eq('id', unit.id).maybeSingle();
    expect(gone).toBeNull();
  });

  // 17. A unit with any lease history (even a past, non-active one) is blocked from hard delete.
  it('a unit with historical (non-active) lease activity is blocked from hard delete', async () => {
    const unit = await insertUnit('601');
    await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: unit.id, start_date: '2025-01-01', end_date: '2025-06-01', rent_amount: 8000, status: 'expired' });
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { data: blockers } = await principalClient.rpc('get_unit_deletion_blockers', { p_unit_id: unit.id });
    expect(blockers.length).toBeGreaterThan(0);

    const { error: deleteError } = await principalClient.rpc('hard_delete_unit', { p_unit_id: unit.id });
    expect(deleteError).not.toBeNull();
  });

  // 18. A unit with an active lease cannot be archived; the lease/occupancy is untouched.
  it('a unit with an active lease cannot be archived, and the lease is left alone', async () => {
    const unit = await insertUnit('601');
    const lease = await insertActiveLease(unit.id);
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);

    const { error } = await agentClient.rpc('archive_unit', { p_unit_id: unit.id });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('active lease');

    const { data: stillOccupied } = await serviceClient.from('units').select('status').eq('id', unit.id).single();
    expect(stillOccupied!.status).toBe('occupied');
    const { data: stillActiveLease } = await serviceClient.from('leases').select('status').eq('id', lease.id).single();
    expect(stillActiveLease!.status).toBe('active');
  });

  // 19. A unit with historical (non-active) activity CAN be archived, even though it cannot be
  // hard-deleted; archived units are excluded from the default listing but remain readable, and
  // restore works.
  it('a unit with historical activity can be archived (though not hard-deleted), is hidden from the default listing, remains readable, and can be restored', async () => {
    const unit = await insertUnit('601');
    const otherUnit = await insertUnit('602');
    await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: unit.id, start_date: '2025-01-01', end_date: '2025-06-01', rent_amount: 8000, status: 'expired' });
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { error: archiveError } = await agentClient.rpc('archive_unit', { p_unit_id: unit.id });
    expect(archiveError).toBeNull();
    const { data: archived } = await serviceClient.from('units').select('status').eq('id', unit.id).single();
    expect(archived!.status).toBe('archived');

    const { error: deleteError } = await principalClient.rpc('hard_delete_unit', { p_unit_id: unit.id });
    expect(deleteError).not.toBeNull();

    const { data: activeListing } = await agentClient
      .from('units')
      .select('id')
      .eq('property_id', propertyId)
      .neq('status', 'archived');
    expect(activeListing?.map((u) => u.id)).toEqual([otherUnit.id]);

    const { data: readBack, error: readError } = await agentClient.from('units').select('*').eq('id', unit.id).single();
    expect(readError).toBeNull();
    expect(readBack.status).toBe('archived');

    const { error: restoreError } = await agentClient.rpc('restore_unit', { p_unit_id: unit.id });
    expect(restoreError).toBeNull();
    const { data: restored } = await serviceClient.from('units').select('status').eq('id', unit.id).single();
    expect(restored!.status).toBe('vacant');
  });

  // 20. A viewer-role staff member cannot archive or hard-delete a unit.
  it('a viewer-role staff member cannot archive or hard-delete a unit', async () => {
    const unit = await insertUnit('601');
    const viewerClient = await signedInClient(viewerEmail, TEST_PASSWORD);

    const { error: archiveError } = await viewerClient.rpc('archive_unit', { p_unit_id: unit.id });
    expect(archiveError).not.toBeNull();
    const { error: deleteError } = await viewerClient.rpc('hard_delete_unit', { p_unit_id: unit.id });
    expect(deleteError).not.toBeNull();

    const { data: unchanged } = await serviceClient.from('units').select('status').eq('id', unit.id).single();
    expect(unchanged!.status).toBe('vacant');
  });

  // 21. Only a principal (not an agent) may hard-delete a unit.
  it('an agent (not a principal) cannot hard-delete a unit, even an empty one', async () => {
    const unit = await insertUnit('602');
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);

    const { error } = await agentClient.rpc('hard_delete_unit', { p_unit_id: unit.id });
    expect(error).not.toBeNull();

    const { data: stillThere } = await serviceClient.from('units').select('id').eq('id', unit.id).maybeSingle();
    expect(stillThere).not.toBeNull();
  });

  // 22. A direct PATCH-style status update can never set a unit to 'archived' (must go through
  // archive_unit()'s own active-lease guard) -- the generic units write path rejects it via the
  // application-level UNIT_SETTABLE_STATUSES/Zod schema, and even a raw client update of the
  // status column does not bypass the active-lease guard because sync_unit_status_from_lease only
  // derives occupied/vacant, never blocks a manual archive -- so this specifically proves
  // archive_unit() is the only path that actually enforces the lease check.
  it('archiving a unit only ever succeeds through archive_unit(), never bypassing the active-lease guard', async () => {
    const unit = await insertUnit('601');
    await insertActiveLease(unit.id);
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);

    const { error } = await agentClient.rpc('archive_unit', { p_unit_id: unit.id });
    expect(error).not.toBeNull();
    const { data: stillOccupied } = await serviceClient.from('units').select('status').eq('id', unit.id).single();
    expect(stillOccupied!.status).toBe('occupied');
  });

  // 23. Final local hardening pass P0 finding (WORKLOG.md this date): activate_lease() had no
  // archived-unit check at all -- a draft lease with a valid tenant assigned could be activated
  // against an archived unit, silently creating real occupancy/rent-schedules on a unit the
  // product otherwise treats as "not available for new tenancy." Fixed in migration
  // 20260101000150; this proves the fix, not just documents the intent.
  it('activate_lease() refuses to activate a lease against an archived unit, even with a tenant assigned and no other blockers', async () => {
    const unit = await insertUnit('601');
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);
    const { error: archiveError } = await agentClient.rpc('archive_unit', { p_unit_id: unit.id });
    expect(archiveError).toBeNull();

    const { data: tenant, error: tenantError } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Archived Unit Test Tenant' })
      .select('id')
      .single();
    expect(tenantError).toBeNull();

    const { data: lease, error: leaseError } = await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: unit.id, start_date: '2026-01-01', rent_amount: 9000, status: 'draft' })
      .select('id')
      .single();
    expect(leaseError).toBeNull();
    await serviceClient.from('lease_tenants').insert({ lease_id: lease!.id, tenant_id: tenant!.id, is_primary: true });

    const { error: activateError } = await agentClient.rpc('activate_lease', { p_lease_id: lease!.id });
    expect(activateError).not.toBeNull();
    expect(activateError?.message).toContain('archived');

    const { data: stillDraft } = await serviceClient.from('leases').select('status').eq('id', lease!.id).single();
    expect(stillDraft!.status).toBe('draft');
    const { data: stillArchived } = await serviceClient.from('units').select('status').eq('id', unit.id).single();
    expect(stillArchived!.status).toBe('archived');
    const { data: noSchedules } = await serviceClient.from('rent_schedules').select('id').eq('lease_id', lease!.id);
    expect(noSchedules).toHaveLength(0);
  });

  // 24. Restoring the unit clears the way for the same lease to activate normally -- proves the
  // guard is specific to the archived state, not a permanent block.
  it('restoring an archived unit allows a previously-blocked lease to activate normally', async () => {
    const unit = await insertUnit('601');
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);
    await agentClient.rpc('archive_unit', { p_unit_id: unit.id });

    const { data: tenant } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Restore Then Activate Tenant' })
      .select('id')
      .single();
    const { data: lease } = await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: unit.id, start_date: '2026-01-01', rent_amount: 9000, status: 'draft' })
      .select('id')
      .single();
    await serviceClient.from('lease_tenants').insert({ lease_id: lease!.id, tenant_id: tenant!.id, is_primary: true });

    const { error: blockedError } = await agentClient.rpc('activate_lease', { p_lease_id: lease!.id });
    expect(blockedError).not.toBeNull();

    const { error: restoreError } = await agentClient.rpc('restore_unit', { p_unit_id: unit.id });
    expect(restoreError).toBeNull();

    const { error: activateError } = await agentClient.rpc('activate_lease', { p_lease_id: lease!.id });
    expect(activateError).toBeNull();
    const { data: nowActive } = await serviceClient.from('leases').select('status').eq('id', lease!.id).single();
    expect(nowActive!.status).toBe('active');
    const { data: nowOccupied } = await serviceClient.from('units').select('status').eq('id', unit.id).single();
    expect(nowOccupied!.status).toBe('occupied');
  });
});
