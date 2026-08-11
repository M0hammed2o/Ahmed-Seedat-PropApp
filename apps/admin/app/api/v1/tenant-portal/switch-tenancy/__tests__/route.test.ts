import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Real integration test against local Supabase, same next/headers-mocking pattern as
// lib/supabase/__tests__/server.test.ts / lib/__tests__/tenantSession.test.ts -- this is the
// route handler itself (not a mocked-fetch component test), invoked directly with a constructed
// NextRequest, so the route's own auth/validation/ownership-check code actually runs.

let mockAuthorizationHeader: string | null = null;
const mockCookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null,
  }),
  cookies: async () => ({
    get: (name: string) =>
      mockCookieJar.has(name) ? { value: mockCookieJar.get(name) } : undefined,
    set: (name: string, value: string) => {
      mockCookieJar.set(name, value);
    },
    getAll: () => [],
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { POST } = await import('../route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROUTE_URL = 'http://localhost/api/v1/tenant-portal/switch-tenancy';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

async function adminFetch(path: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(ROUTE_URL, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describeIfSupabase(
  'POST /api/v1/tenant-portal/switch-tenancy (real local Supabase integration)',
  () => {
    let userAId: string;
    let userBId: string;
    let orgId: string;
    let tenantOwnId: string;
    let tenantOtherUserId: string;

    beforeEach(async () => {
      mockCookieJar.clear();

      const emailA = `switch-tenancy-a-${Date.now()}@propertyvault.example`;
      const emailB = `switch-tenancy-b-${Date.now()}@propertyvault.example`;
      const password = 'TestPassw0rd!23';

      const createdA = await adminFetch('/auth/v1/admin/users', {
        email: emailA,
        password,
        email_confirm: true,
      });
      userAId = createdA.id;
      const createdB = await adminFetch('/auth/v1/admin/users', {
        email: emailB,
        password,
        email_confirm: true,
      });
      userBId = createdB.id;

      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailA, password }),
      });
      const tokenBody = await tokenRes.json();
      mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

      const orgRows = await adminFetch('/rest/v1/organizations', {
        legal_name: `Switch Tenancy Vitest Org ${Date.now()}`,
        org_type: 'agency',
      });
      orgId = orgRows[0].id;

      const tenantOwnRows = await adminFetch('/rest/v1/tenants', {
        org_id: orgId,
        user_id: userAId,
        full_name: 'User A Tenancy',
        status: 'active',
      });
      tenantOwnId = tenantOwnRows[0].id;

      const tenantOtherRows = await adminFetch('/rest/v1/tenants', {
        org_id: orgId,
        user_id: userBId,
        full_name: 'User B Tenancy',
        status: 'active',
      });
      tenantOtherUserId = tenantOtherRows[0].id;
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await fetch(`${SUPABASE_URL}/rest/v1/tenants?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userAId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userBId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
    });

    it("accepts the caller's own tenant id and sets the cookie", async () => {
      const response = await POST(postRequest({ tenantId: tenantOwnId }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.tenantId).toBe(tenantOwnId);
      expect(mockCookieJar.get('active_tenant_id')).toBe(tenantOwnId);
    });

    it("rejects another user's tenant id with 403, without setting the cookie", async () => {
      const response = await POST(postRequest({ tenantId: tenantOtherUserId }));
      expect(response.status).toBe(403);
      expect(mockCookieJar.has('active_tenant_id')).toBe(false);
    });

    it('rejects an unauthenticated caller with 401', async () => {
      mockAuthorizationHeader = null;
      const response = await POST(postRequest({ tenantId: tenantOwnId }));
      expect(response.status).toBe(401);
    });

    it('rejects invalid JSON with 400', async () => {
      const response = await POST(postRequest('not-json{'));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('invalid_json');
    });

    it('rejects a non-UUID tenantId with 400', async () => {
      const response = await POST(postRequest({ tenantId: 'not-a-uuid' }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('validation_failed');
    });
  },
);
