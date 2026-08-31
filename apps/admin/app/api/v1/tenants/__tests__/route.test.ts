import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Final completion + security hardening pass (WORKLOG.md this date), P1 "Internal tenant
// invitation investigation" -- the exact real API routes (not a mocked-fetch component test),
// invoked directly with a constructed NextRequest against real local Supabase, same pattern as
// tenant-portal/switch-tenancy's own route test. Proves the reported production bug's core claim
// end-to-end: creating a tenant with email+phone through the actual POST /api/v1/tenants handler
// never creates a tenant_invitations row, and only an explicit POST .../invitations does.

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

const { POST: createTenant } = await import('../route');
const { POST: createInvitation } = await import('../[id]/invitations/route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function postRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describeIfSupabase('POST /api/v1/tenants (real local Supabase integration)', () => {
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    const email = `tenants-route-${Date.now()}@propertyvault.example`;
    const password = 'TestPassw0rd!23';

    const created = await adminFetch('/auth/v1/admin/users', {
      email,
      password,
      email_confirm: true,
    });
    userId = created.id;

    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const tokenBody = await tokenRes.json();
    mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Tenants Route Vitest Org ${Date.now()}`,
      org_type: 'agency',
    });
    orgId = orgRows[0].id;

    await adminFetch('/rest/v1/organization_members', {
      org_id: orgId,
      user_id: userId,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  });

  it('creating a tenant with both email and phone through the real route creates zero tenant_invitations rows', async () => {
    const response = await createTenant(
      postRequest('http://localhost/api/v1/tenants', {
        orgId,
        fullName: 'Real Route Test Tenant',
        email: `real-route-tenant-${Date.now()}@example.invalid`,
        phone: '+27825550100',
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const tenantId = body.tenant.id;

    const invitations = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_invitations?tenant_id=eq.${tenantId}`,
      { headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    ).then((r) => r.json());

    expect(invitations).toHaveLength(0);

    const tenantRow = await fetch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`, {
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }).then((r) => r.json());
    expect(tenantRow[0].user_id).toBeNull();
  });

  it('an explicit POST .../invitations call creates exactly one invitation, and only after being asked', async () => {
    const createResponse = await createTenant(
      postRequest('http://localhost/api/v1/tenants', {
        orgId,
        fullName: 'Explicit Invite Test Tenant',
        email: `explicit-invite-tenant-${Date.now()}@example.invalid`,
      }),
    );
    const tenantId = (await createResponse.json()).tenant.id;

    const preInviteRows = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_invitations?tenant_id=eq.${tenantId}`,
      { headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    ).then((r) => r.json());
    expect(preInviteRows).toHaveLength(0);

    const inviteResponse = await createInvitation(
      postRequest(`http://localhost/api/v1/tenants/${tenantId}/invitations`, {
        deliveryChannel: 'email',
        includeShortCode: false,
      }),
      { params: Promise.resolve({ id: tenantId }) },
    );
    expect(inviteResponse.status).toBe(201);

    const postInviteRows = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_invitations?tenant_id=eq.${tenantId}`,
      { headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    ).then((r) => r.json());
    expect(postInviteRows).toHaveLength(1);
  });
});
