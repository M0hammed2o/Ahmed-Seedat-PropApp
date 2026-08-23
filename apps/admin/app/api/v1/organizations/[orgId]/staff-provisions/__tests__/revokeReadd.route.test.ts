import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Provisioned-staff account model, predeploy hardening pass (this date). Exercises the REAL
// route handlers end-to-end (not just the underlying RPCs) for the full lifecycle: add -> set
// password -> activate -> remove staff access -> re-add -> re-activate immediately -- same
// next/headers-mocking pattern as tenant-portal/switch-tenancy/__tests__/route.test.ts, so the
// routes' own auth/validation/error-mapping code actually runs, not just the SQL underneath it.
// Covers BOTH property-access modes as required: 'selected' on first add, 'all' on re-add.

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

const { POST: postStaffProvisions } = await import('../route');
const { POST: postActivate } = await import('@/app/api/v1/staff/activate/route');
const { POST: postActivateFinish } = await import('@/app/api/v1/staff/activate/finish/route');
const { POST: postMemberRevoke } = await import(
  '@/app/api/v1/organizations/[orgId]/members/[userId]/revoke/route'
);

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function adminFetch(path: string, body: unknown, method = 'POST') {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  return res.json();
}

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

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describeIfSupabase(
  'staff provisioning revoke -> re-add (real route handlers, real local Supabase integration)',
  () => {
    let orgId: string;
    let principalId: string;
    let principalEmail: string;
    const principalPassword = 'TestPassw0rd!23';
    let propertyId: string;
    const createdUserIds: string[] = [];

    beforeEach(async () => {
      mockAuthorizationHeader = null;
      principalEmail = `revokereadd-principal-${Date.now()}@propertyvault.example`;
      const principal = await adminFetch('/auth/v1/admin/users', {
        email: principalEmail,
        password: principalPassword,
        email_confirm: true,
      });
      principalId = principal.id;
      createdUserIds.push(principalId);

      const orgRows = await adminFetch('/rest/v1/organizations', {
        legal_name: `Revoke Readd Vitest Org ${Date.now()}`,
        org_type: 'agency',
      });
      orgId = orgRows[0].id;

      await adminFetch('/rest/v1/organization_members', {
        org_id: orgId,
        user_id: principalId,
        role: 'principal',
        status: 'active',
        joined_at: new Date().toISOString(),
      });

      const propertyRows = await adminFetch('/rest/v1/properties', {
        org_id: orgId,
        nickname: 'Revoke Readd Unit',
        address_line1: '3 Readd St',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'house',
      });
      propertyId = propertyRows[0].id;
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await fetch(`${SUPABASE_URL}/rest/v1/organization_staff_provisions?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/organization_members?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/properties?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      for (const id of createdUserIds) {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        });
      }
      createdUserIds.length = 0;
    });

    it('provision (selected) -> activate -> remove staff access -> re-add (all) reuses the same auth user, reactivates the same membership row, and preserves audit history', async () => {
      const employeeEmail = `revokereadd-employee-${Date.now()}@propertyvault.example`;

      // 1) Principal adds the employee with SELECTED property access, via the real POST route.
      const principalToken = await passwordGrantToken(principalEmail, principalPassword);
      mockAuthorizationHeader = `Bearer ${principalToken}`;
      const addResponse = await postStaffProvisions(
        jsonRequest(`http://localhost/api/v1/organizations/${orgId}/staff-provisions`, {
          fullName: 'Revoke Readd Employee',
          email: employeeEmail,
          role: 'agent',
          propertyAccessMode: 'selected',
          selectedProperties: [{ propertyId, propertyRole: 'read_only' }],
        }),
        { params: Promise.resolve({ orgId }) },
      );
      expect(addResponse.status).toBe(201);
      const addBody = await addResponse.json();
      expect(addBody.isExistingActiveUser).toBe(false);

      const provisionRow = await adminFetch(
        `/rest/v1/organization_staff_provisions?id=eq.${addBody.provisionId}&select=auth_user_id,token_hash`,
        {},
        'GET',
      );
      const employeeId = provisionRow[0].auth_user_id as string;
      const tokenHash = provisionRow[0].token_hash as string;
      createdUserIds.push(employeeId);

      // 2) The employee sets their own password via the real, unauthenticated activation route.
      mockAuthorizationHeader = null;
      const employeePassword = 'EmployeeFirstPassw0rd!1';
      const activateResponse = await postActivate(
        jsonRequest('http://localhost/api/v1/staff/activate', {
          tokenHash,
          password: employeePassword,
          confirmPassword: employeePassword,
        }),
      );
      expect(activateResponse.status).toBe(200);

      // 3) The employee finishes activation (real membership creation) via the real finish route,
      // authenticated with their own freshly-set password.
      const employeeToken = await passwordGrantToken(employeeEmail, employeePassword);
      mockAuthorizationHeader = `Bearer ${employeeToken}`;
      const finishResponse = await postActivateFinish();
      expect(finishResponse.status).toBe(200);
      const finishBody = await finishResponse.json();
      expect(finishBody.orgId).toBe(orgId);

      const membershipAfterActivate = await adminFetch(
        `/rest/v1/organization_members?org_id=eq.${orgId}&user_id=eq.${employeeId}&select=*`,
        {},
        'GET',
      );
      expect(membershipAfterActivate[0].status).toBe('active');
      expect(membershipAfterActivate[0].role).toBe('agent');
      expect(membershipAfterActivate[0].property_access_mode).toBe('selected');
      const firstMembershipCreatedAt = membershipAfterActivate[0].joined_at;

      const grantsAfterActivate = await adminFetch(
        `/rest/v1/property_access?user_id=eq.${employeeId}&select=property_id`,
        {},
        'GET',
      );
      expect(grantsAfterActivate.length).toBe(1);
      expect(grantsAfterActivate[0].property_id).toBe(propertyId);

      const seatCountAfterActivate = await adminFetch(
        `/rest/v1/rpc/org_active_billable_staff_count`,
        { p_org_id: orgId },
      );
      expect(seatCountAfterActivate).toBe(1);

      // 4) Principal removes staff access via the real, existing "remove staff access" route.
      mockAuthorizationHeader = `Bearer ${principalToken}`;
      const revokeResponse = await postMemberRevoke(new NextRequest('http://localhost/revoke'), {
        params: Promise.resolve({ orgId, userId: employeeId }),
      });
      expect(revokeResponse.status).toBe(200);

      const membershipAfterRevoke = await adminFetch(
        `/rest/v1/organization_members?org_id=eq.${orgId}&user_id=eq.${employeeId}&select=status`,
        {},
        'GET',
      );
      expect(membershipAfterRevoke[0].status).toBe('revoked');

      const grantsAfterRevoke = await adminFetch(
        `/rest/v1/property_access?user_id=eq.${employeeId}&select=property_id`,
        {},
        'GET',
      );
      expect(grantsAfterRevoke.length).toBe(0);

      const seatCountAfterRevoke = await adminFetch(`/rest/v1/rpc/org_active_billable_staff_count`, {
        p_org_id: orgId,
      });
      expect(seatCountAfterRevoke).toBe(0);

      // 5) Principal re-adds the SAME email, this time with ALL-properties access and a
      // different role -- the employee now has a real password, so this is the existing-user
      // branch: immediate reactivation, no second auth identity, no new activation email.
      mockAuthorizationHeader = `Bearer ${principalToken}`;
      const readdResponse = await postStaffProvisions(
        jsonRequest(`http://localhost/api/v1/organizations/${orgId}/staff-provisions`, {
          fullName: 'Revoke Readd Employee',
          email: employeeEmail,
          role: 'manager',
          propertyAccessMode: 'all',
          selectedProperties: [],
        }),
        { params: Promise.resolve({ orgId }) },
      );
      expect(readdResponse.status).toBe(201);
      const readdBody = await readdResponse.json();
      expect(readdBody.isExistingActiveUser).toBe(true);
      expect(readdBody.membershipActivated).toBe(true);

      // Same auth user reused -- no duplicate identity for this email.
      const { data: authUsersAfterReadd } = await serviceClient.auth.admin.listUsers();
      const matchingIdentities = authUsersAfterReadd.users.filter((u) => u.email === employeeEmail);
      expect(matchingIdentities.length).toBe(1);
      expect(matchingIdentities[0]!.id).toBe(employeeId);

      // Same organization_members ROW reactivated (same joined_at-tracked row, not a new one --
      // there is exactly one row for this (org, user) pair, now active again with the new role).
      const membershipRowsAfterReadd = await adminFetch(
        `/rest/v1/organization_members?org_id=eq.${orgId}&user_id=eq.${employeeId}&select=*`,
        {},
        'GET',
      );
      expect(membershipRowsAfterReadd.length).toBe(1);
      expect(membershipRowsAfterReadd[0].status).toBe('active');
      expect(membershipRowsAfterReadd[0].role).toBe('manager');
      expect(membershipRowsAfterReadd[0].property_access_mode).toBe('all');
      // joined_at is refreshed on reactivation (matches the RPC's own ON CONFLICT ... SET
      // joined_at = now() behaviour) -- confirms this really went through the update path, not a
      // silently-failed insert.
      expect(new Date(membershipRowsAfterReadd[0].joined_at).getTime()).toBeGreaterThanOrEqual(
        new Date(firstMembershipCreatedAt).getTime(),
      );

      // Seat consumed again.
      const seatCountAfterReadd = await adminFetch(`/rest/v1/rpc/org_active_billable_staff_count`, {
        p_org_id: orgId,
      });
      expect(seatCountAfterReadd).toBe(1);

      // Audit history preserved across the whole lifecycle -- never deleted, includes the
      // revocation event among the earlier provisioning/activation events.
      const auditEvents = await adminFetch(
        `/rest/v1/audit_events?org_id=eq.${orgId}&order=created_at.asc&select=action`,
        {},
        'GET',
      );
      const actions = auditEvents.map((e: { action: string }) => e.action);
      expect(actions).toContain('staff.provision_created');
      expect(actions).toContain('staff.activated');
      expect(actions).toContain('staff.removed');
      expect(actions).toContain('staff.provisioned_existing_user');
      expect(actions.length).toBeGreaterThanOrEqual(4);
    }, 30000);
  },
);
