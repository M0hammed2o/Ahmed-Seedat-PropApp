import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Property edit/archive/delete lifecycle pass (WORKLOG.md this date). Real integration test
// against the local Supabase instance, same pattern as tenantInternalManagement.test.ts /
// staffProvisioning.test.ts -- covers migrations 20260101000148 (get_property_deletion_blockers /
// hard_delete_property) and 20260101000149 (archive_property / restore_property).

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

describeIfSupabase('property edit/archive/delete lifecycle (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let principalId: string;
  let principalEmail: string;
  let agentId: string;
  let agentEmail: string;
  let viewerId: string;
  let viewerEmail: string;
  let orgBId: string;
  let outsiderId: string;
  let outsiderEmail: string;
  const createdUserIds: string[] = [];

  beforeEach(async () => {
    const suffix = randomUUID();
    principalId = randomUUID();
    agentId = randomUUID();
    viewerId = randomUUID();
    outsiderId = randomUUID();
    createdUserIds.push(principalId, agentId, viewerId, outsiderId);

    principalEmail = `proplifecycle-principal-${suffix}@test.propertyvault.example`;
    agentEmail = `proplifecycle-agent-${suffix}@test.propertyvault.example`;
    viewerEmail = `proplifecycle-viewer-${suffix}@test.propertyvault.example`;
    outsiderEmail = `proplifecycle-outsider-${suffix}@test.propertyvault.example`;

    for (const [id, email] of [
      [principalId, principalEmail],
      [agentId, agentEmail],
      [viewerId, viewerEmail],
      [outsiderId, outsiderEmail],
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
      .insert({ legal_name: `Property Lifecycle Vitest Org ${suffix}`, org_type: 'agency', status: 'active' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: orgB, error: orgBError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Property Lifecycle Vitest Org B ${suffix}`, org_type: 'agency', status: 'active' })
      .select('id')
      .single();
    if (orgBError) throw orgBError;
    orgBId = orgB.id;

    await serviceClient.from('organization_members').insert([
      { org_id: orgId, user_id: principalId, role: 'principal', status: 'active', joined_at: new Date().toISOString() },
      { org_id: orgId, user_id: agentId, role: 'agent', status: 'active', joined_at: new Date().toISOString() },
      { org_id: orgId, user_id: viewerId, role: 'viewer', status: 'active', joined_at: new Date().toISOString() },
      { org_id: orgBId, user_id: outsiderId, role: 'principal', status: 'active', joined_at: new Date().toISOString() },
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
    await serviceClient.from('organizations').delete().eq('id', orgBId);
  });

  async function insertProperty(nickname: string) {
    const { data, error } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname, address_line1: '1 Test St', city: 'Durban' })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function insertUnit(propertyId: string, unitLabel: string) {
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

  // 1. Edit.
  it('an agent can edit a property, and the edit preserves its id/created_at and its units', async () => {
    const property = await insertProperty('Musgrave Heights');
    const unit = await insertUnit(property.id, '601');
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);

    const { data: updated, error } = await agentClient
      .from('properties')
      .update({ nickname: 'Musgrave Heights (renamed)', suburb: 'Musgrave' })
      .eq('id', property.id)
      .select('*')
      .single();

    expect(error).toBeNull();
    expect(updated.id).toBe(property.id);
    expect(updated.created_at).toBe(property.created_at);
    expect(updated.nickname).toBe('Musgrave Heights (renamed)');

    const { data: units } = await serviceClient.from('units').select('id').eq('property_id', property.id);
    expect(units).toHaveLength(1);
    expect(units?.[0]?.id).toBe(unit.id);
  });

  // 2. Unauthorized staff (viewer) cannot edit.
  it('a viewer-role staff member cannot edit a property', async () => {
    const property = await insertProperty('Musgrave Heights');
    const viewerClient = await signedInClient(viewerEmail, TEST_PASSWORD);

    const { data: updated } = await viewerClient
      .from('properties')
      .update({ nickname: 'Hacked' })
      .eq('id', property.id)
      .select('*');

    // RLS silently returns zero affected rows rather than an error -- the property must be
    // provably unchanged, not just "no rows came back."
    expect(updated).toEqual([]);
    const { data: unchanged } = await serviceClient.from('properties').select('nickname').eq('id', property.id).single();
    expect(unchanged!.nickname).toBe('Musgrave Heights');
  });

  // 3. Cross-org isolation (read path).
  it('a property in another org is invisible to an outsider (RLS, read path)', async () => {
    const property = await insertProperty('Musgrave Heights');
    const outsiderClient = await signedInClient(outsiderEmail, TEST_PASSWORD);

    const { data } = await outsiderClient.from('properties').select('*').eq('id', property.id).maybeSingle();
    expect(data).toBeNull();
  });

  // 4. Cross-org isolation (write/RPC path).
  it('a cross-org caller cannot archive or hard-delete a property that is not theirs', async () => {
    const property = await insertProperty('Musgrave Heights');
    const outsiderClient = await signedInClient(outsiderEmail, TEST_PASSWORD);

    const { error: archiveError } = await outsiderClient.rpc('archive_property', { p_property_id: property.id });
    expect(archiveError).not.toBeNull();

    const { error: deleteError } = await outsiderClient.rpc('hard_delete_property', { p_property_id: property.id });
    expect(deleteError).not.toBeNull();

    const { data: stillActive } = await serviceClient.from('properties').select('status').eq('id', property.id).single();
    expect(stillActive!.status).toBe('active');
  });

  // 5. An empty property (never had units/activity) is hard-delete eligible, and deletion works.
  it('a brand-new property with no units or activity is hard-delete eligible, and hard delete removes it', async () => {
    const property = await insertProperty('Empty Test Property');
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { data: blockers, error: blockersError } = await principalClient.rpc('get_property_deletion_blockers', {
      p_property_id: property.id,
    });
    expect(blockersError).toBeNull();
    expect(blockers).toEqual([]);

    const { error: deleteError } = await principalClient.rpc('hard_delete_property', { p_property_id: property.id });
    expect(deleteError).toBeNull();

    const { data: gone } = await serviceClient.from('properties').select('id').eq('id', property.id).maybeSingle();
    expect(gone).toBeNull();
  });

  // 6. Only a principal (not an agent) may hard-delete.
  it('an agent (not a principal) cannot hard-delete a property, even an empty one', async () => {
    const property = await insertProperty('Empty Test Property');
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);

    const { error } = await agentClient.rpc('hard_delete_property', { p_property_id: property.id });
    expect(error).not.toBeNull();

    const { data: stillThere } = await serviceClient.from('properties').select('id').eq('id', property.id).maybeSingle();
    expect(stillThere).not.toBeNull();
  });

  // 7. A property that ever had a unit is permanently blocked from hard delete (audit_events FK),
  // even after that unit is later removed -- the empirically-discovered permanent-block condition.
  it('a property that ever had a unit is permanently blocked from hard delete, even after the unit is removed', async () => {
    const property = await insertProperty('Test Property');
    const unit = await insertUnit(property.id, '101');
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    await principalClient.rpc('hard_delete_unit', { p_unit_id: unit.id });
    const { data: unitGone } = await serviceClient.from('units').select('id').eq('id', unit.id).maybeSingle();
    expect(unitGone).toBeNull();

    const { data: blockers } = await principalClient.rpc('get_property_deletion_blockers', {
      p_property_id: property.id,
    });
    expect(blockers.length).toBeGreaterThan(0);

    const { error: deleteError } = await principalClient.rpc('hard_delete_property', { p_property_id: property.id });
    expect(deleteError).not.toBeNull();
  });

  // 8. Financial history (expenses) blocks hard delete.
  it('a property with recorded expenses is blocked from hard delete', async () => {
    const property = await insertProperty('Financial History Property');
    await serviceClient.from('expenses').insert({ org_id: orgId, property_id: property.id, category: 'Repairs', amount: 500 });
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { data: blockers } = await principalClient.rpc('get_property_deletion_blockers', {
      p_property_id: property.id,
    });
    expect(blockers.length).toBeGreaterThan(0);

    const { error: deleteError } = await principalClient.rpc('hard_delete_property', { p_property_id: property.id });
    expect(deleteError).not.toBeNull();
  });

  // 9. A property with an active lease cannot be archived; leases/units are untouched.
  it('a property with an active lease cannot be archived, and the lease/unit are left alone', async () => {
    const property = await insertProperty('Musgrave Heights');
    const unit = await insertUnit(property.id, '601');
    const lease = await insertActiveLease(unit.id);
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);

    const { error } = await agentClient.rpc('archive_property', { p_property_id: property.id });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Musgrave Heights');
    expect(error?.message).toContain('601');
    expect(error?.message).toContain('active lease');

    const { data: stillActiveProperty } = await serviceClient.from('properties').select('status').eq('id', property.id).single();
    expect(stillActiveProperty!.status).toBe('active');
    const { data: stillActiveLease } = await serviceClient.from('leases').select('status').eq('id', lease.id).single();
    expect(stillActiveLease!.status).toBe('active');
    const { data: stillOccupiedUnit } = await serviceClient.from('units').select('status').eq('id', unit.id).single();
    expect(stillOccupiedUnit!.status).toBe('occupied');
  });

  // 10. A property with historical (non-active) activity CAN be archived even though it cannot be
  // hard-deleted.
  it('a property with historical (non-active) lease activity can be archived, though it cannot be hard-deleted', async () => {
    const property = await insertProperty('Historical Property');
    const unit = await insertUnit(property.id, '101');
    await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: unit.id, start_date: '2025-01-01', end_date: '2025-06-01', rent_amount: 8000, status: 'expired' });
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { error: archiveError } = await agentClient.rpc('archive_property', { p_property_id: property.id });
    expect(archiveError).toBeNull();
    const { data: archived } = await serviceClient.from('properties').select('status').eq('id', property.id).single();
    expect(archived!.status).toBe('archived');

    const { error: deleteError } = await principalClient.rpc('hard_delete_property', { p_property_id: property.id });
    expect(deleteError).not.toBeNull();
  });

  // 11. An archived property's units/history remain readable by an authorized staff member.
  it("an archived property's units and history remain readable", async () => {
    const property = await insertProperty('Historical Property');
    await insertUnit(property.id, '101');
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);
    await agentClient.rpc('archive_property', { p_property_id: property.id });

    const { data: readBack, error } = await agentClient.from('properties').select('*, units(*)').eq('id', property.id).single();
    expect(error).toBeNull();
    expect(readBack.status).toBe('archived');
    expect(readBack.units).toHaveLength(1);
  });

  // 12. Archived properties are excluded from the default active-only listing, but included when
  // explicitly requesting archived/all -- same server-side filter the /properties page's
  // loadProperties() applies.
  it('an archived property does not appear in the default active-only listing, but does when explicitly requested', async () => {
    const active = await insertProperty('Active Property');
    const property = await insertProperty('Historical Property');
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);
    await agentClient.rpc('archive_property', { p_property_id: property.id });

    const { data: activeOnly } = await agentClient.from('properties').select('id').eq('status', 'active').eq('org_id', orgId);
    expect(activeOnly?.map((p) => p.id)).toEqual([active.id]);

    const { data: archivedOnly } = await agentClient.from('properties').select('id').eq('status', 'archived').eq('org_id', orgId);
    expect(archivedOnly?.map((p) => p.id)).toEqual([property.id]);

    const { data: all } = await agentClient.from('properties').select('id').eq('org_id', orgId);
    expect(all).toHaveLength(2);
  });

  // 13. Restoring an archived property sets it back to active and it reappears in the default
  // listing.
  it('restoring an archived property sets it back to active', async () => {
    const property = await insertProperty('Historical Property');
    const agentClient = await signedInClient(agentEmail, TEST_PASSWORD);
    await agentClient.rpc('archive_property', { p_property_id: property.id });

    const { error: restoreError } = await agentClient.rpc('restore_property', { p_property_id: property.id });
    expect(restoreError).toBeNull();

    const { data: restored } = await serviceClient.from('properties').select('status').eq('id', property.id).single();
    expect(restored!.status).toBe('active');
  });

  // 14. A viewer cannot archive.
  it('a viewer-role staff member cannot archive a property', async () => {
    const property = await insertProperty('Musgrave Heights');
    const viewerClient = await signedInClient(viewerEmail, TEST_PASSWORD);

    const { error } = await viewerClient.rpc('archive_property', { p_property_id: property.id });
    expect(error).not.toBeNull();

    const { data: stillActive } = await serviceClient.from('properties').select('status').eq('id', property.id).single();
    expect(stillActive!.status).toBe('active');
  });

  // 15. Deletion eligibility check itself is read-only and matches the actual hard-delete outcome
  // (no drift between the display-only eligibility endpoint and the real enforcement).
  it('deletion eligibility reporting matches the actual hard-delete outcome for both an eligible and an ineligible property', async () => {
    const emptyProperty = await insertProperty('Empty Test Property');
    const propertyWithUnit = await insertProperty('Test Property');
    await insertUnit(propertyWithUnit.id, '101');
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { data: eligibleBlockers } = await principalClient.rpc('get_property_deletion_blockers', {
      p_property_id: emptyProperty.id,
    });
    expect(eligibleBlockers).toEqual([]);
    const { error: eligibleDeleteError } = await principalClient.rpc('hard_delete_property', {
      p_property_id: emptyProperty.id,
    });
    expect(eligibleDeleteError).toBeNull();

    const { data: ineligibleBlockers } = await principalClient.rpc('get_property_deletion_blockers', {
      p_property_id: propertyWithUnit.id,
    });
    expect(ineligibleBlockers.length).toBeGreaterThan(0);
    const { error: ineligibleDeleteError } = await principalClient.rpc('hard_delete_property', {
      p_property_id: propertyWithUnit.id,
    });
    expect(ineligibleDeleteError).not.toBeNull();
  });
});
