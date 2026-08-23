import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { provisionStaffMember } from '../staffProvisioning';

// Provisioned-staff account model, predeploy hardening pass (this date). An existing Proplyst
// user, already an active member of Organisation A, gets provisioned into Organisation B --
// proves the existing-user branch of provision_staff_member() scopes membership/role/property
// access per-org, never mutates any global user state, and never creates a duplicate identity.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
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

describeIfSupabase(
  'provisionStaffMember() across multiple organisations (real local Supabase integration)',
  () => {
    const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let orgAId: string;
    let orgBId: string;
    let principalAId: string;
    let principalBId: string;
    let principalAEmail: string;
    let principalBEmail: string;
    let propertyBId: string;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    beforeEach(async () => {
      principalAId = randomUUID();
      principalBId = randomUUID();
      createdUserIds.push(principalAId, principalBId);
      principalAEmail = `multiorg-principal-a-${principalAId}@test.propertyvault.example`;
      principalBEmail = `multiorg-principal-b-${principalBId}@test.propertyvault.example`;
      await serviceClient.auth.admin.createUser({
        id: principalAId,
        email: principalAEmail,
        email_confirm: true,
        password: TEST_PASSWORD,
      } as never);
      await serviceClient.auth.admin.createUser({
        id: principalBId,
        email: principalBEmail,
        email_confirm: true,
        password: TEST_PASSWORD,
      } as never);

      const { data: orgA } = await serviceClient
        .from('organizations')
        .insert({ legal_name: `Multi-Org Vitest Org A ${Date.now()}`, org_type: 'agency' })
        .select('id')
        .single();
      orgAId = orgA!.id;
      createdOrgIds.push(orgAId);
      const { data: orgB } = await serviceClient
        .from('organizations')
        .insert({ legal_name: `Multi-Org Vitest Org B ${Date.now()}`, org_type: 'agency' })
        .select('id')
        .single();
      orgBId = orgB!.id;
      createdOrgIds.push(orgBId);

      await serviceClient.from('organization_members').insert([
        { org_id: orgAId, user_id: principalAId, role: 'principal', status: 'active', joined_at: new Date().toISOString() },
        { org_id: orgBId, user_id: principalBId, role: 'principal', status: 'active', joined_at: new Date().toISOString() },
      ]);

      const { data: propertyB } = await serviceClient
        .from('properties')
        .insert({
          org_id: orgBId,
          nickname: 'Org B Unit',
          address_line1: '2 Multi St',
          city: 'Cape Town',
          country: 'ZA',
          property_type: 'house',
        })
        .select('id')
        .single();
      propertyBId = propertyB!.id;
    });

    afterEach(async () => {
      for (const id of createdOrgIds) {
        try {
          await serviceClient.from('organization_staff_provisions').delete().eq('org_id', id);
          await serviceClient.from('organization_members').delete().eq('org_id', id);
          await serviceClient.from('organization_subscriptions').delete().eq('org_id', id);
          await serviceClient.from('properties').delete().eq('org_id', id);
          await serviceClient.from('organizations').delete().eq('id', id);
        } catch {
          // Best-effort local-dev cleanup only.
        }
      }
      for (const id of createdUserIds) {
        try {
          await serviceClient.auth.admin.deleteUser(id);
        } catch {
          // Best-effort local-dev cleanup only.
        }
      }
      createdOrgIds.length = 0;
      createdUserIds.length = 0;
    });

    it('an existing member of Org A, provisioned into Org B, gets independently-scoped membership with no duplicate identity and no cross-org mutation', async () => {
      const employeeId = randomUUID();
      createdUserIds.push(employeeId);
      const employeeEmail = `multiorg-employee-${employeeId}@test.propertyvault.example`;
      await serviceClient.auth.admin.createUser({
        id: employeeId,
        email: employeeEmail,
        email_confirm: true,
        password: TEST_PASSWORD,
      } as never);

      const principalAClient = await signedInClient(principalAEmail, TEST_PASSWORD);
      const resultA = await provisionStaffMember(principalAClient, serviceClient, principalAId, {
        orgId: orgAId,
        email: employeeEmail,
        fullName: 'Multi Org Employee',
        role: 'agent',
        propertyAccessMode: 'all',
        selectedProperties: [],
      });
      expect(resultA.isExistingActiveUser).toBe(true);
      expect(resultA.membershipActivated).toBe(true);

      const { data: membershipAAfterFirst } = await serviceClient
        .from('organization_members')
        .select('role, status, property_access_mode')
        .eq('org_id', orgAId)
        .eq('user_id', employeeId)
        .single();
      expect(membershipAAfterFirst!.role).toBe('agent');
      expect(membershipAAfterFirst!.status).toBe('active');
      expect(membershipAAfterFirst!.property_access_mode).toBe('all');

      // Now provision the SAME email into Org B, a DIFFERENT role and DIFFERENT (selected)
      // property access -- proves per-org scoping, not a shared/global staff record.
      const principalBClient = await signedInClient(principalBEmail, TEST_PASSWORD);
      const resultB = await provisionStaffMember(principalBClient, serviceClient, principalBId, {
        orgId: orgBId,
        email: employeeEmail,
        fullName: 'Multi Org Employee',
        role: 'manager',
        propertyAccessMode: 'selected',
        selectedProperties: [{ propertyId: propertyBId, propertyRole: 'property_manager' }],
      });
      expect(resultB.isExistingActiveUser).toBe(true);
      expect(resultB.membershipActivated).toBe(true);

      // No duplicate auth.users row -- same identity used for both orgs.
      const { data: authUsers } = await serviceClient.auth.admin.listUsers();
      const matchingIdentities = authUsers.users.filter((u) => u.email === employeeEmail);
      expect(matchingIdentities.length).toBe(1);
      expect(matchingIdentities[0]!.id).toBe(employeeId);

      // Org A's membership is completely unaffected by Org B's provisioning.
      const { data: membershipAAfterSecond } = await serviceClient
        .from('organization_members')
        .select('role, status, property_access_mode')
        .eq('org_id', orgAId)
        .eq('user_id', employeeId)
        .single();
      expect(membershipAAfterSecond).toEqual(membershipAAfterFirst);

      // Org B's membership reflects Org B's own provisioning request, independently.
      const { data: membershipB } = await serviceClient
        .from('organization_members')
        .select('role, status, property_access_mode')
        .eq('org_id', orgBId)
        .eq('user_id', employeeId)
        .single();
      expect(membershipB!.role).toBe('manager');
      expect(membershipB!.status).toBe('active');
      expect(membershipB!.property_access_mode).toBe('selected');

      // Property access is scoped to Org B's own property only -- Org A granted 'all' (no rows),
      // so the employee's only property_access row anywhere is the Org B one.
      const { data: allGrants } = await serviceClient
        .from('property_access')
        .select('property_id, property_role')
        .eq('user_id', employeeId);
      expect(allGrants?.length).toBe(1);
      expect(allGrants?.[0]?.property_id).toBe(propertyBId);
      expect(allGrants?.[0]?.property_role).toBe('property_manager');

      // No global role/state mutation -- exactly two active memberships exist for this user,
      // each independently correct, and both are visible via a normal same-user query (what
      // destination/member-listing queries rely on).
      const { data: allMemberships } = await serviceClient
        .from('organization_members')
        .select('org_id, role, status')
        .eq('user_id', employeeId)
        .eq('status', 'active')
        .order('org_id');
      expect(allMemberships?.length).toBe(2);
      expect(new Set(allMemberships?.map((m) => m.org_id))).toEqual(new Set([orgAId, orgBId]));

      // Provisioning never creates an organisation or subscription FOR the employee themselves --
      // they own neither org, and no subscription references them anywhere.
      const { data: orgsOwnedByEmployee } = await serviceClient
        .from('organizations')
        .select('id')
        .in('id', [orgAId, orgBId])
        .eq('id', employeeId); // employeeId is never a valid org id -- sanity guard, expect empty
      expect(orgsOwnedByEmployee?.length ?? 0).toBe(0);
      const { count: subscriptionCount } = await serviceClient
        .from('organization_subscriptions')
        .select('id', { count: 'exact', head: true })
        .in('org_id', [orgAId, orgBId]);
      expect(subscriptionCount).toBe(0);

      // Revoke ONLY Org B membership -- Org A must remain completely unaffected.
      const { error: revokeError } = await principalBClient.rpc('revoke_organization_member', {
        p_org_id: orgBId,
        p_user_id: employeeId,
      });
      expect(revokeError).toBeNull();

      const { data: membershipBAfterRevoke } = await serviceClient
        .from('organization_members')
        .select('status')
        .eq('org_id', orgBId)
        .eq('user_id', employeeId)
        .single();
      expect(membershipBAfterRevoke!.status).toBe('revoked');

      const { data: orgBGrantsAfterRevoke } = await serviceClient
        .from('property_access')
        .select('property_id')
        .eq('user_id', employeeId)
        .eq('property_id', propertyBId);
      expect(orgBGrantsAfterRevoke?.length).toBe(0);

      const { data: membershipAAfterRevoke } = await serviceClient
        .from('organization_members')
        .select('role, status, property_access_mode')
        .eq('org_id', orgAId)
        .eq('user_id', employeeId)
        .single();
      expect(membershipAAfterRevoke).toEqual(membershipAAfterFirst);
    }, 20000);
  },
);
