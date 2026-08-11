import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real integration tests against local Supabase, mirroring
// lib/supabase/__tests__/server.test.ts's own established pattern for testing a next/headers-
// dependent server utility: mock next/headers (Bearer-token auth header + a controllable, mutable
// cookie jar), authenticate as a real user via a real access token, exercise the real RLS-scoped
// reads underneath. resolveTenantSession()'s multi-tenancy selection (WORKLOG.md this date) is
// pure TypeScript on top of a real DB read -- not something the pgTAP suite (which tests
// may_create_portfolio()/available_staff_seats(), not this cookie-selection logic) covers.

let mockAuthorizationHeader: string | null = null;
let mockCookieJar = new Map<string, string>();

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

const { resolveTenantSession } = await import('../tenantSession');

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

describeIfSupabase('resolveTenantSession (real local Supabase integration)', () => {
  let userId: string;
  let orgId: string;
  let tenantAId: string;
  let tenantBId: string;

  beforeEach(async () => {
    mockCookieJar = new Map();
    const email = `tenant-session-vitest-${Date.now()}@propertyvault.example`;
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
      legal_name: `Tenant Session Vitest Org ${Date.now()}`,
      org_type: 'agency',
    });
    orgId = orgRows[0].id;

    const tenantARows = await adminFetch('/rest/v1/tenants', {
      org_id: orgId,
      user_id: userId,
      full_name: 'Tenancy A',
      status: 'active',
    });
    tenantAId = tenantARows[0].id;
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
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  });

  it('returns null for an unauthenticated caller', async () => {
    mockAuthorizationHeader = null;
    const session = await resolveTenantSession();
    expect(session).toBeNull();
  });

  it('resolves a single tenancy with an empty otherTenancyIds list', async () => {
    const session = await resolveTenantSession();
    expect(session?.tenantId).toBe(tenantAId);
    expect(session?.otherTenancyIds).toEqual([]);
  });

  it('defaults to the most recently created tenancy when no cookie is set and there are two', async () => {
    const tenantBRows = await adminFetch('/rest/v1/tenants', {
      org_id: orgId,
      user_id: userId,
      full_name: 'Tenancy B',
      status: 'active',
    });
    tenantBId = tenantBRows[0].id;

    const session = await resolveTenantSession();
    expect(session?.tenantId).toBe(tenantBId);
    expect(session?.otherTenancyIds).toEqual([tenantAId]);
  });

  it("switches to the cookie-selected tenancy when it is genuinely one of the caller's own", async () => {
    const tenantBRows = await adminFetch('/rest/v1/tenants', {
      org_id: orgId,
      user_id: userId,
      full_name: 'Tenancy B',
      status: 'active',
    });
    tenantBId = tenantBRows[0].id;

    mockCookieJar.set('active_tenant_id', tenantAId);
    const session = await resolveTenantSession();
    expect(session?.tenantId).toBe(tenantAId);
    expect(session?.otherTenancyIds).toEqual([tenantBId]);
  });

  it("ignores a cookie value that does not match any of the caller's own tenancies", async () => {
    mockCookieJar.set('active_tenant_id', '00000000-0000-0000-0000-000000000000');
    const session = await resolveTenantSession();
    expect(session?.tenantId).toBe(tenantAId);
  });
});
