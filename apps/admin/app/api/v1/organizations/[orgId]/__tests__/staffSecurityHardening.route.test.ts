import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Staff security + audit hardening pass (this date). Exercises the REAL route handlers (not just
// the underlying RPCs/RLS, already proven by the companion pgTAP file) end-to-end: a Manager is
// denied by /members, /staff-provisions, and the new /activity route; the Principal is allowed on
// all three; and the UUID-display-bug fix (profiles lookup via service-role, not the RLS-blocked
// session client) is proven by asserting a REAL resolved name comes back, not null/undefined/a
// raw UUID. Same next/headers-mocking + bearer-auth pattern as
// tenant-portal/switch-tenancy/__tests__/route.test.ts.

let mockAuthorizationHeader: string | null = null;

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null,
  }),
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    getAll: () => [],
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { GET: getMembers } = await import('../members/route');
const { GET: getStaffProvisions } = await import('../staff-provisions/route');
const { GET: getActivity } = await import('../activity/route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TEST_PASSWORD = 'TestPassw0rd!23';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

async function passwordGrantToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`password grant failed: ${JSON.stringify(body)}`);
  return body.access_token as string;
}

function getRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describeIfSupabase(
  'staff security hardening: principal-only routes + name resolution (real local Supabase integration)',
  () => {
    const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let orgId: string;
    let principalId: string;
    let principalEmail: string;
    let managerId: string;
    let managerEmail: string;
    let managerToken: string;
    let principalToken: string;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    beforeEach(async () => {
      mockAuthorizationHeader = null;
      principalId = randomUUID();
      managerId = randomUUID();
      createdUserIds.push(principalId, managerId);
      principalEmail = `hardening-principal-${principalId}@test.propertyvault.example`;
      managerEmail = `hardening-manager-${managerId}@test.propertyvault.example`;

      await serviceClient.auth.admin.createUser({
        id: principalId,
        email: principalEmail,
        email_confirm: true,
        password: TEST_PASSWORD,
      } as never);
      await serviceClient.auth.admin.createUser({
        id: managerId,
        email: managerEmail,
        email_confirm: true,
        password: TEST_PASSWORD,
      } as never);
      // The manager's own profile has a real display_name -- this is the identity whose name
      // resolution is being proven (previously blocked by profiles' own-row-only RLS when read
      // via the session client).
      await serviceClient
        .from('profiles')
        .update({ display_name: 'Hardening Test Manager' })
        .eq('id', managerId);

      const { data: org } = await serviceClient
        .from('organizations')
        .insert({ legal_name: `Staff Hardening Vitest Org ${Date.now()}`, org_type: 'agency' })
        .select('id')
        .single();
      orgId = org!.id;
      createdOrgIds.push(orgId);

      await serviceClient.from('organization_members').insert([
        { org_id: orgId, user_id: principalId, role: 'principal', status: 'active', joined_at: new Date().toISOString() },
        { org_id: orgId, user_id: managerId, role: 'manager', status: 'active', joined_at: new Date().toISOString() },
      ]);

      principalToken = await passwordGrantToken(principalEmail, TEST_PASSWORD);
      managerToken = await passwordGrantToken(managerEmail, TEST_PASSWORD);
    });

    afterEach(async () => {
      for (const id of createdOrgIds) {
        try {
          await serviceClient.from('organization_members').delete().eq('org_id', id);
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

    it('GET .../members: a Manager is denied (403); the Principal is allowed and sees the Manager\'s REAL name, not null or a raw UUID', async () => {
      mockAuthorizationHeader = `Bearer ${managerToken}`;
      const deniedResponse = await getMembers(getRequest(`http://localhost/api/v1/organizations/${orgId}/members`), {
        params: Promise.resolve({ orgId }),
      });
      expect(deniedResponse.status).toBe(403);

      mockAuthorizationHeader = `Bearer ${principalToken}`;
      const allowedResponse = await getMembers(getRequest(`http://localhost/api/v1/organizations/${orgId}/members`), {
        params: Promise.resolve({ orgId }),
      });
      expect(allowedResponse.status).toBe(200);
      const body = await allowedResponse.json();
      const managerRow = body.members.find((m: { userId: string }) => m.userId === managerId);
      expect(managerRow).toBeDefined();
      expect(managerRow.displayName).toBe('Hardening Test Manager');
      expect(managerRow.displayName).not.toBe(managerId);
      expect(managerRow.displayName).not.toBeNull();
    });

    it('GET .../staff-provisions: a Manager is denied (403); the Principal is allowed', async () => {
      mockAuthorizationHeader = `Bearer ${managerToken}`;
      const deniedResponse = await getStaffProvisions(
        getRequest(`http://localhost/api/v1/organizations/${orgId}/staff-provisions`),
        { params: Promise.resolve({ orgId }) },
      );
      expect(deniedResponse.status).toBe(403);

      mockAuthorizationHeader = `Bearer ${principalToken}`;
      const allowedResponse = await getStaffProvisions(
        getRequest(`http://localhost/api/v1/organizations/${orgId}/staff-provisions`),
        { params: Promise.resolve({ orgId }) },
      );
      expect(allowedResponse.status).toBe(200);
    });

    it('GET .../activity: a Manager is denied (403); the Principal is allowed, sees the real audit trail, and the staff-member filter narrows results', async () => {
      // Generate a real audited action to filter on: the principal changes their own org's
      // settings is not staff-scoped, so instead directly write a real audit_events row via the
      // already-proven RPC path -- update the manager's own role is blocked (self target n/a
      // here, manager isn't self), so use revoke+re-add via a THIRD member to get a genuine
      // staff.* audit row attributable to the manager -- simpler: the principal changes the
      // manager's role, which is attributable to the PRINCIPAL as actor, then filter by that.
      mockAuthorizationHeader = `Bearer ${principalToken}`;
      const principalSessionClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${principalToken}` } },
      });
      const { error: roleChangeError } = await principalSessionClient.rpc(
        'update_organization_member_role',
        { p_org_id: orgId, p_user_id: managerId, p_role: 'agent' },
      );
      expect(roleChangeError).toBeNull();

      mockAuthorizationHeader = `Bearer ${managerToken}`;
      const deniedResponse = await getActivity(
        getRequest(`http://localhost/api/v1/organizations/${orgId}/activity`),
        { params: Promise.resolve({ orgId }) },
      );
      expect(deniedResponse.status).toBe(403);

      mockAuthorizationHeader = `Bearer ${principalToken}`;
      const allResponse = await getActivity(
        getRequest(`http://localhost/api/v1/organizations/${orgId}/activity`),
        { params: Promise.resolve({ orgId }) },
      );
      expect(allResponse.status).toBe(200);
      const allBody = await allResponse.json();
      expect(
        allBody.activity.some((a: { action: string }) => a.action === 'staff.role_changed'),
      ).toBe(true);

      const filteredResponse = await getActivity(
        getRequest(
          `http://localhost/api/v1/organizations/${orgId}/activity?actorUserId=${principalId}&category=staff`,
        ),
        { params: Promise.resolve({ orgId }) },
      );
      expect(filteredResponse.status).toBe(200);
      const filteredBody = await filteredResponse.json();
      expect(filteredBody.activity.length).toBeGreaterThan(0);
      for (const row of filteredBody.activity) {
        expect(row.actorUserId).toBe(principalId);
      }
      // Actor snapshot columns are populated by the RPC itself for this action.
      const roleChangeRow = filteredBody.activity.find(
        (a: { action: string }) => a.action === 'staff.role_changed',
      );
      expect(roleChangeRow.actorRole).toBe('principal');
    }, 20000);
  },
);
