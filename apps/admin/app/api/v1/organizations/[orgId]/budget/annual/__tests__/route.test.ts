import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Phase A budget-hierarchy pass (WORKLOG.md this date): "portfolio budget = sum of property
// budgets" was already true at the RPC level (owner_portfolio_financial_summary sums
// property_budgets.planned_amount for the org), but had no annual counterpart -- this proves the
// new GET .../budget/annual route sums 12 already-authoritative months correctly, matches a
// live sum(property annual budgets) hand-computation, and enforces the same
// authorization/validation the sibling property-level route already has.

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

const { GET } = await import('../route');

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

function getRequest(orgId: string, year: number | string | null) {
  const qs = year === null ? '' : `?year=${year}`;
  return new NextRequest(`http://localhost/api/v1/organizations/${orgId}/budget/annual${qs}`, { method: 'GET' });
}

describeIfSupabase('GET /api/v1/organizations/:orgId/budget/annual (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let managerId: string;
  let managerToken: string;
  let propertyAId: string;
  let propertyBId: string;
  const password = 'TestPassw0rd!23';
  const year = 2032; // far from real data, avoids collisions with other tests/fixtures

  beforeEach(async () => {
    mockCookieJar.clear();
    const suffix = Date.now();

    const managerEmail = `portfolio-annual-manager-${suffix}@propertyvault.example`;
    const managerCreated = await adminFetch('/auth/v1/admin/users', {
      email: managerEmail,
      password,
      email_confirm: true,
    });
    managerId = managerCreated.id;
    managerToken = await signIn(managerEmail, password);

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Portfolio Annual Vitest Org ${suffix}`,
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

    const { data: propA } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'Portfolio Annual Property A', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
      .select('id')
      .single();
    propertyAId = propA!.id;
    const { data: propB } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'Portfolio Annual Property B', address_line1: '2 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
      .select('id')
      .single();
    propertyBId = propB!.id;

    await serviceClient
      .from('property_access')
      .upsert(
        [
          { property_id: propertyAId, user_id: managerId, property_role: 'administrator', granted_by: managerId },
          { property_id: propertyBId, user_id: managerId, property_role: 'administrator', granted_by: managerId },
        ],
        { onConflict: 'property_id,user_id' },
      );

    // Property A: R10,000/mo for Jan+Feb. Property B: R4,000/mo for Jan only.
    // set_monthly_budget() checks has_org_role() via auth.uid() -- must be called as the real
    // authenticated manager, not the service-role client (which has no auth.uid() at all).
    const managerClient = createClient(SUPABASE_URL, ANON_KEY!);
    await managerClient.auth.signInWithPassword({ email: managerEmail, password });
    for (const [propertyId, month, amount] of [
      [propertyAId, `${year}-01-01`, 10000],
      [propertyAId, `${year}-02-01`, 10000],
      [propertyBId, `${year}-01-01`, 4000],
    ] as const) {
      const { error } = await managerClient.rpc('set_monthly_budget', {
        p_org_id: orgId,
        p_property_id: propertyId,
        p_month: month,
        p_planned_amount: amount,
      });
      if (error) throw error;
    }

    await serviceClient.from('expenses').insert([
      { org_id: orgId, property_id: propertyAId, category: 'other', category_code: 'other', amount: 3000, invoice_date: `${year}-01-15` },
      { org_id: orgId, property_id: propertyBId, category: 'other', category_code: 'other', amount: 1000, invoice_date: `${year}-01-20` },
    ]);
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await serviceClient.from('expenses').delete().eq('org_id', orgId);
    await serviceClient.from('property_budgets').delete().eq('org_id', orgId);
    await serviceClient.from('property_access').delete().in('property_id', [propertyAId, propertyBId]);
    await serviceClient.from('properties').delete().eq('org_id', orgId);
    await serviceClient.from('organization_members').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
  });

  // A generous per-test timeout: this route fans out to 12 owner_portfolio_financial_summary()
  // calls against real local Supabase, which can run slower than the 5s default under concurrent
  // load from other integration test files hitting the same local instance at once (observed:
  // fast/reliable in isolation, occasionally slow only when several *.test.ts files run together).
  it('sums both properties correctly: January planned = 14000 (10000+4000), actual = 4000 (3000+1000)', async () => {
    mockAuthorizationHeader = `Bearer ${managerToken}`;
    const response = await GET(getRequest(orgId, year), { params: Promise.resolve({ orgId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    const jan = body.months.find((m: { month: string }) => m.month === `${year}-01-01`);
    expect(jan.plannedAmount).toBe(14000);
    expect(jan.actualAmount).toBe(4000);
    const feb = body.months.find((m: { month: string }) => m.month === `${year}-02-01`);
    expect(feb.plannedAmount).toBe(10000);
  }, 20000);

  it('annual rollup matches a hand sum of the same 12 months: planned 24000, actual 4000', async () => {
    mockAuthorizationHeader = `Bearer ${managerToken}`;
    const response = await GET(getRequest(orgId, year), { params: Promise.resolve({ orgId }) });
    const body = await response.json();
    expect(body.annual).toEqual({
      year,
      monthsPlanned: 2,
      annualPlanned: 24000,
      annualActual: 4000,
      annualRemaining: 20000,
      annualPercentUsed: 16.7,
    });
  }, 20000);

  it('requires authentication', async () => {
    mockAuthorizationHeader = null;
    const response = await GET(getRequest(orgId, year), { params: Promise.resolve({ orgId }) });
    expect(response.status).toBe(401);
  });

  it('rejects a missing or invalid ?year with 400, not a 500', async () => {
    mockAuthorizationHeader = `Bearer ${managerToken}`;
    const missing = await GET(getRequest(orgId, null), { params: Promise.resolve({ orgId }) });
    expect(missing.status).toBe(400);
    const invalid = await GET(getRequest(orgId, 'not-a-year'), { params: Promise.resolve({ orgId }) });
    expect(invalid.status).toBe(400);
  });

  it('rejects an outsider with 403, never leaking the real numbers', async () => {
    const outsiderSuffix = Date.now();
    const outsiderEmail = `portfolio-annual-outsider-${outsiderSuffix}@propertyvault.example`;
    const outsiderCreated = await adminFetch('/auth/v1/admin/users', { email: outsiderEmail, password, email_confirm: true });
    const outsiderToken = await signIn(outsiderEmail, password);
    mockAuthorizationHeader = `Bearer ${outsiderToken}`;
    const response = await GET(getRequest(orgId, year), { params: Promise.resolve({ orgId }) });
    expect(response.status).toBe(403);
    await serviceClient.auth.admin.deleteUser(outsiderCreated.id);
  });
});
