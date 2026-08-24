import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Staff security + audit hardening FOLLOW-UP (this date). Two real production findings, both
// fixed here: (1) GET .../activity's actor-name fallback only tried profiles.display_name, never
// email, unlike members/route.ts's already-correct three-tier chain; (2) several staff-
// administration mutation routes surfaced ANY RPC failure as a generic 400 (or, for
// staff-provisions, a stale message match that fell through to 500), when the RPC's own
// principal-only check had already correctly blocked a Manager -- this narrowly remaps ONLY the
// known principal-only denial messages to 403, via lib/staffAuthorizationErrors.ts.

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

const { GET: getActivity } = await import('../activity/route');
const { POST: postRole } = await import('../members/[userId]/role/route');
const { POST: postRevoke } = await import('../members/[userId]/revoke/route');
const { POST: postMode } = await import('../members/[userId]/mode/route');
const { POST: postGrantAccess, DELETE: deleteAccess } = await import(
  '../members/[userId]/property-access/route'
);
const { POST: postProvision } = await import('../staff-provisions/route');

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

function jsonRequest(url: string, body?: unknown, method = 'POST'): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describeIfSupabase(
  'staff auth-status + activity name fallback follow-up (real local Supabase integration)',
  () => {
    const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let orgId: string;
    let principalId: string;
    let principalEmail: string;
    let managerId: string;
    let managerEmail: string;
    let principalToken: string;
    let managerToken: string;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    beforeEach(async () => {
      mockAuthorizationHeader = null;
      principalId = randomUUID();
      managerId = randomUUID();
      createdUserIds.push(principalId, managerId);
      principalEmail = `authstatus-principal-${principalId}@test.propertyvault.example`;
      managerEmail = `authstatus-manager-${managerId}@test.propertyvault.example`;

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

      const { data: org } = await serviceClient
        .from('organizations')
        .insert({ legal_name: `Auth Status Vitest Org ${Date.now()}`, org_type: 'agency' })
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

    describe('Activity actor-name fallback', () => {
      it('an actor WITH a profile display_name shows that name', async () => {
        await serviceClient.from('profiles').update({ display_name: 'Faatimah Moosa' }).eq('id', principalId);
        mockAuthorizationHeader = `Bearer ${principalToken}`;
        const res = await postRole(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/members/${managerId}/role`, { role: 'agent' }),
          { params: Promise.resolve({ orgId, userId: managerId }) },
        );
        expect(res.status).toBe(200);

        const activityRes = await getActivity(
          getRequest(`http://localhost/api/v1/organizations/${orgId}/activity`),
          { params: Promise.resolve({ orgId }) },
        );
        const body = await activityRes.json();
        const row = body.activity.find((a: { action: string }) => a.action === 'staff.role_changed');
        expect(row.actorDisplayName).toBe('Faatimah Moosa');
        expect(row.actorDisplayName).not.toBe(principalId);
      });

      it('an actor with NO display_name but a real email shows the email, never "Unknown user" and never a UUID', async () => {
        // Deliberately leave profiles.display_name unset for the principal (default state for a
        // freshly-created auth user in this test suite).
        mockAuthorizationHeader = `Bearer ${principalToken}`;
        const res = await postRole(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/members/${managerId}/role`, { role: 'agent' }),
          { params: Promise.resolve({ orgId, userId: managerId }) },
        );
        expect(res.status).toBe(200);

        const activityRes = await getActivity(
          getRequest(`http://localhost/api/v1/organizations/${orgId}/activity`),
          { params: Promise.resolve({ orgId }) },
        );
        const body = await activityRes.json();
        const row = body.activity.find((a: { action: string }) => a.action === 'staff.role_changed');
        expect(row.actorDisplayName).toBe(principalEmail);
        expect(row.actorDisplayName).not.toBe(principalId);
        expect(row.actorDisplayName).not.toBe('Unknown user');
      });

      it('an actor with neither a display_name nor a resolvable email shows "Unnamed user", never a raw UUID', async () => {
        // audit_events.actor_user_id has a real FK to auth.users -- a fabricated, never-created id
        // is rejected outright (confirmed live), so the "neither available" case is exercised with
        // a REAL auth identity that genuinely has no email: phone-only signup, no profile
        // display_name ever set. admin.getUserById() returns email: '' for this identity (not
        // null/undefined) -- the route's own `if (authUser.user?.email)` check must treat an empty
        // string as "no email", not truthy, to reach the final "Unnamed user" tier.
        const { data: phoneUser } = await serviceClient.auth.admin.createUser({
          phone: `+2782${Math.floor(1000000 + Math.random() * 8999999)}`,
          phone_confirm: true,
        } as never);
        const phoneUserId = phoneUser!.user!.id;
        createdUserIds.push(phoneUserId);
        await serviceClient.from('organization_members').insert({
          org_id: orgId,
          user_id: phoneUserId,
          role: 'agent',
          status: 'active',
          joined_at: new Date().toISOString(),
        });
        await serviceClient.from('audit_events').insert({
          org_id: orgId,
          actor_user_id: phoneUserId,
          actor_type: 'user',
          action: 'staff.role_changed',
          entity_type: 'organization_members',
          entity_id: managerId,
          before: { role: 'manager' },
          after: { role: 'agent' },
        });

        mockAuthorizationHeader = `Bearer ${principalToken}`;
        const activityRes = await getActivity(
          getRequest(`http://localhost/api/v1/organizations/${orgId}/activity?actorUserId=${phoneUserId}`),
          { params: Promise.resolve({ orgId }) },
        );
        const body = await activityRes.json();
        expect(body.activity.length).toBeGreaterThan(0);
        for (const row of body.activity) {
          expect(row.actorDisplayName).toBe('Unnamed user');
          expect(row.actorDisplayName).not.toBe(phoneUserId);
        }
      });

      it('a real historical actor_display_name snapshot is preserved even if the CURRENT profile name has since changed', async () => {
        // provision_staff_member()/update_organization_member_role() stamp actor_role inline at
        // write time; simulate an already-snapshotted row (as if a future writer also stamped
        // actor_display_name) and confirm the read path never overwrites or ignores it in favour
        // of a fresher lookup.
        await serviceClient.from('audit_events').insert({
          org_id: orgId,
          actor_user_id: principalId,
          actor_type: 'user',
          actor_role: 'principal',
          actor_display_name: 'Historical Snapshot Name',
          action: 'staff.role_changed',
          entity_type: 'organization_members',
          entity_id: managerId,
          before: { role: 'manager' },
          after: { role: 'agent' },
        });
        // Change the CURRENT profile name to something different -- if the fallback logic were
        // wrongly re-resolving instead of trusting the stored snapshot, this would leak through.
        await serviceClient.from('profiles').update({ display_name: 'A Totally Different Current Name' }).eq('id', principalId);

        mockAuthorizationHeader = `Bearer ${principalToken}`;
        const activityRes = await getActivity(
          getRequest(`http://localhost/api/v1/organizations/${orgId}/activity`),
          { params: Promise.resolve({ orgId }) },
        );
        const body = await activityRes.json();
        const row = body.activity.find(
          (a: { action: string; before: { role: string } }) =>
            a.action === 'staff.role_changed' && a.before?.role === 'manager',
        );
        expect(row.actorDisplayName).toBe('Historical Snapshot Name');
      });
    });

    describe('Staff authorization HTTP status', () => {
      it('Manager: role change -> 403 (not 400/500)', async () => {
        mockAuthorizationHeader = `Bearer ${managerToken}`;
        const res = await postRole(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/members/${principalId}/role`, { role: 'viewer' }),
          { params: Promise.resolve({ orgId, userId: principalId }) },
        );
        expect(res.status).toBe(403);
      });

      it('Manager: revoke member -> 403', async () => {
        mockAuthorizationHeader = `Bearer ${managerToken}`;
        const res = await postRevoke(getRequest('http://localhost/revoke'), {
          params: Promise.resolve({ orgId, userId: principalId }),
        });
        expect(res.status).toBe(403);
      });

      it('Manager: property-access mode change -> 403', async () => {
        mockAuthorizationHeader = `Bearer ${managerToken}`;
        const res = await postMode(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/members/${principalId}/mode`, { mode: 'selected' }),
          { params: Promise.resolve({ orgId, userId: principalId }) },
        );
        expect(res.status).toBe(403);
      });

      it('Manager: grant property access -> 403', async () => {
        const { data: property } = await serviceClient
          .from('properties')
          .insert({ org_id: orgId, nickname: 'Auth Status Test Property', address_line1: '1 St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
          .select('id')
          .single();
        mockAuthorizationHeader = `Bearer ${managerToken}`;
        const res = await postGrantAccess(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/members/${managerId}/property-access`, {
            propertyId: property!.id,
            propertyRole: 'read_only',
          }),
          { params: Promise.resolve({ orgId, userId: managerId }) },
        );
        expect(res.status).toBe(403);
      });

      it('Manager: revoke property access -> 403', async () => {
        const { data: property } = await serviceClient
          .from('properties')
          .insert({ org_id: orgId, nickname: 'Auth Status Test Property 2', address_line1: '2 St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
          .select('id')
          .single();
        mockAuthorizationHeader = `Bearer ${managerToken}`;
        const res = await deleteAccess(
          getRequest(
            `http://localhost/api/v1/organizations/${orgId}/members/${managerId}/property-access?propertyId=${property!.id}`,
          ),
          { params: Promise.resolve({ orgId, userId: managerId }) },
        );
        expect(res.status).toBe(403);
      });

      it('Manager: provision staff -> 403', async () => {
        mockAuthorizationHeader = `Bearer ${managerToken}`;
        const res = await postProvision(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/staff-provisions`, {
            fullName: 'Should Be Denied',
            email: `authstatus-denied-${randomUUID()}@test.propertyvault.example`,
            role: 'agent',
            propertyAccessMode: 'all',
            selectedProperties: [],
          }),
          { params: Promise.resolve({ orgId }) },
        );
        expect(res.status).toBe(403);
      });

      it('Principal: the same operations remain allowed', async () => {
        mockAuthorizationHeader = `Bearer ${principalToken}`;
        const roleRes = await postRole(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/members/${managerId}/role`, { role: 'agent' }),
          { params: Promise.resolve({ orgId, userId: managerId }) },
        );
        expect(roleRes.status).toBe(200);

        const modeRes = await postMode(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/members/${managerId}/mode`, { mode: 'selected' }),
          { params: Promise.resolve({ orgId, userId: managerId }) },
        );
        expect(modeRes.status).toBe(200);

        const { data: property } = await serviceClient
          .from('properties')
          .insert({ org_id: orgId, nickname: 'Principal Allowed Property', address_line1: '3 St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
          .select('id')
          .single();
        const grantRes = await postGrantAccess(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/members/${managerId}/property-access`, {
            propertyId: property!.id,
            propertyRole: 'read_only',
          }),
          { params: Promise.resolve({ orgId, userId: managerId }) },
        );
        expect(grantRes.status).toBe(201);

        const revokeRes = await postRevoke(getRequest('http://localhost/revoke'), {
          params: Promise.resolve({ orgId, userId: managerId }),
        });
        expect(revokeRes.status).toBe(200);
      }, 20000);

      it('Principal: an invalid payload still returns 400, never incorrectly mapped to 403', async () => {
        mockAuthorizationHeader = `Bearer ${principalToken}`;
        const res = await postRole(
          jsonRequest(`http://localhost/api/v1/organizations/${orgId}/members/${managerId}/role`, {
            role: 'not-a-real-role',
          }),
          { params: Promise.resolve({ orgId, userId: managerId }) },
        );
        expect(res.status).toBe(400);
      });
    });
  },
);
