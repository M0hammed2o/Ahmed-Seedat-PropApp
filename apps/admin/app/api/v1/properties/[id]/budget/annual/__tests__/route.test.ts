import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Property/unit financial setup pass (WORKLOG.md this date), §7: the Annual budget panel used to
// fire 12 separate GET /budget?month=X requests per page load. New GET /budget/annual?year=YYYY
// batches the exact same budget_vs_actual() RPC server-side into one response -- this proves it
// returns all 12 months, reflects a distributed annual budget correctly, and enforces the same
// auth/validation the sibling single-month route already has. Same real-local-Supabase integration
// pattern as ../../owners/__tests__/route.test.ts.

let mockAuthorizationHeader: string | null = null;
const mockCookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null),
  }),
  cookies: async () => ({
    get: (name: string) => (mockCookieJar.has(name) ? { value: mockCookieJar.get(name) } : undefined),
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

const { GET, POST } = await import('../route');

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

async function adminFetch(path: string, body: unknown, method = 'POST') {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
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

async function signIn(email: string, password: string) {
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const tokenBody = await tokenRes.json();
  return tokenBody.access_token as string;
}

function getRequest(propertyId: string, year: number | string | null) {
  const qs = year === null ? '' : `?year=${year}`;
  return new NextRequest(`http://localhost/api/v1/properties/${propertyId}/budget/annual${qs}`, {
    method: 'GET',
  });
}

function postRequest(propertyId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/v1/properties/${propertyId}/budget/annual`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describeIfSupabase('GET /api/v1/properties/:id/budget/annual (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let managerId: string;
  let managerToken: string;
  const password = 'TestPassw0rd!23';
  const year = 2031; // far enough from real data that no other test/fixture could collide

  beforeEach(async () => {
    mockCookieJar.clear();
    const suffix = Date.now();

    const managerEmail = `budget-annual-manager-${suffix}@propertyvault.example`;
    const managerCreated = await adminFetch('/auth/v1/admin/users', {
      email: managerEmail,
      password,
      email_confirm: true,
    });
    managerId = managerCreated.id;
    managerToken = await signIn(managerEmail, password);

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Budget Annual Vitest Org ${suffix}`,
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
      .insert({
        org_id: orgId,
        nickname: 'Budget Annual Property',
        address_line1: '1 Test St',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'house',
      })
      .select('id')
      .single();
    propertyId = property!.id;
    await serviceClient
      .from('property_access')
      .upsert(
        { property_id: propertyId, user_id: managerId, property_role: 'administrator', granted_by: managerId },
        { onConflict: 'property_id,user_id' },
      );
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await serviceClient.from('property_budgets').delete().eq('property_id', propertyId);
    await serviceClient.from('property_access').delete().eq('property_id', propertyId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
  });

  it('returns all 12 months, none configured, with a 200 (never a 500 just because nothing is set yet)', async () => {
    mockAuthorizationHeader = `Bearer ${managerToken}`;
    const response = await GET(getRequest(propertyId, year), { params: Promise.resolve({ id: propertyId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.months).toHaveLength(12);
    expect(body.months[0].month).toBe(`${year}-01-01`);
    expect(body.months[11].month).toBe(`${year}-12-01`);
    for (const m of body.months) {
      expect(m.plannedAmount).toBeNull();
      expect(m.actualAmount).toBe(0);
    }
  });

  it('reflects a distributed annual budget across all 12 months in one batched response', async () => {
    mockAuthorizationHeader = `Bearer ${managerToken}`;
    const distributeResponse = await POST(
      postRequest(propertyId, { orgId, year, annualTotal: 12000 }),
      { params: Promise.resolve({ id: propertyId }) },
    );
    expect(distributeResponse.status).toBe(201);

    const response = await GET(getRequest(propertyId, year), { params: Promise.resolve({ id: propertyId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.months).toHaveLength(12);
    for (const m of body.months) {
      expect(m.plannedAmount).toBe(1000);
    }
    // Phase A budget-hierarchy pass: the annual rollup is a pure sum of these same 12 months --
    // 1000 planned x 12 = 12000, zero actual expenses recorded.
    expect(body.annual).toEqual({
      year,
      monthsPlanned: 12,
      annualPlanned: 12000,
      annualActual: 0,
      annualRemaining: 12000,
      annualPercentUsed: 0,
    });
  });

  it('requires authentication', async () => {
    mockAuthorizationHeader = null;
    const response = await GET(getRequest(propertyId, year), { params: Promise.resolve({ id: propertyId }) });
    expect(response.status).toBe(401);
  });

  it('rejects a missing or invalid ?year with 400, not a 500', async () => {
    mockAuthorizationHeader = `Bearer ${managerToken}`;
    const missing = await GET(getRequest(propertyId, null), { params: Promise.resolve({ id: propertyId }) });
    expect(missing.status).toBe(400);

    const invalid = await GET(getRequest(propertyId, 'not-a-year'), { params: Promise.resolve({ id: propertyId }) });
    expect(invalid.status).toBe(400);
  });
});
