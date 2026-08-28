import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Landlord/staff launch-hardening pass (WORKLOG.md 2026-08-26), Section 2: an application could be
// created but the applicant never received an invitation -- nothing in the product UI ever called
// this route (the only prior caller in the whole codebase was an e2e test hitting the API
// directly). This route itself was already correct; the P0 fix was wiring a UI button to it plus
// adding this GET handler so staff can see delivery status. No test previously existed for either
// verb. Proves: GET reports "never invited" before any token exists; POST issues a token, writes
// exactly one audit event, and attempts email dispatch when the applicant has an email; a second
// POST (resend) revokes the prior token and GET reflects only the newest one as current.

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

function accessTokensGetRequest(id: string) {
  return new NextRequest(`http://localhost/api/v1/applications/${id}/access-tokens`, { method: 'GET' });
}

function accessTokensPostRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/v1/applications/${id}/access-tokens`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describeIfSupabase('GET/POST /api/v1/applications/:id/access-tokens (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let unitId: string;
  let applicationId: string;
  let managerId: string;

  beforeEach(async () => {
    mockCookieJar.clear();
    const email = `access-tokens-manager-${Date.now()}@propertyvault.example`;
    const password = 'TestPassw0rd!23';
    const created = await adminFetch('/auth/v1/admin/users', { email, password, email_confirm: true });
    managerId = created.id;

    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const tokenBody = await tokenRes.json();
    mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Access Tokens Vitest Org ${Date.now()}`,
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
      .insert({ org_id: orgId, nickname: 'Access Tokens Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
      .select('id')
      .single();
    propertyId = property!.id;

    const { data: unit } = await serviceClient
      .from('units')
      .insert({ property_id: propertyId, org_id: orgId, unit_label: 'U1', status: 'vacant' })
      .select('id')
      .single();
    unitId = unit!.id;

    const { data: application } = await serviceClient
      .from('applications')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        unit_id: unitId,
        applicant_name: 'Access Tokens Applicant',
        applicant_email: 'access-tokens-applicant@example.com',
        status: 'submitted',
      })
      .select('id')
      .single();
    applicationId = application!.id;
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await serviceClient.from('audit_events').delete().eq('org_id', orgId);
    await serviceClient.from('email_messages').delete().eq('org_id', orgId);
    await serviceClient.from('application_access_tokens').delete().eq('application_id', applicationId);
    await serviceClient.from('applications').delete().eq('id', applicationId);
    await serviceClient.from('units').delete().eq('id', unitId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
  });

  it('GET reports no invitation before any token has been issued', async () => {
    const response = await GET(accessTokensGetRequest(applicationId), { params: Promise.resolve({ id: applicationId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accessToken).toBeNull();
    expect(body.email).toBeNull();
  });

  it('POST issues a token, writes exactly one audit event, and attempts email dispatch', async () => {
    const response = await POST(accessTokensPostRequest(applicationId, { deliveryChannel: 'email' }), {
      params: Promise.resolve({ id: applicationId }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.accessToken.token).toBeTruthy();
    expect(body.email).not.toBeNull();

    const { count: auditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', body.accessToken.id)
      .eq('action', 'application.invitation_sent');
    expect(auditCount).toBe(1);

    const { count: tokenCount } = await serviceClient
      .from('application_access_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('application_id', applicationId)
      .is('revoked_at', null);
    expect(tokenCount).toBe(1);
  });

  it('GET reflects the issued token as current, without ever exposing the plaintext token', async () => {
    await POST(accessTokensPostRequest(applicationId, { deliveryChannel: 'email' }), {
      params: Promise.resolve({ id: applicationId }),
    });

    const response = await GET(accessTokensGetRequest(applicationId), { params: Promise.resolve({ id: applicationId }) });
    const body = await response.json();
    expect(body.accessToken.deliveryChannel).toBe('email');
    expect(body.accessToken.isCurrent).toBe(true);
    expect(body.accessToken.token).toBeUndefined();
  });

  it('a second POST (resend) revokes the prior token so GET reports only the newest one as current', async () => {
    const first = await POST(accessTokensPostRequest(applicationId, { deliveryChannel: 'email' }), {
      params: Promise.resolve({ id: applicationId }),
    });
    const firstBody = await first.json();

    const second = await POST(accessTokensPostRequest(applicationId, { deliveryChannel: 'email' }), {
      params: Promise.resolve({ id: applicationId }),
    });
    expect(second.status).toBe(201);
    const secondBody = await second.json();
    expect(secondBody.accessToken.id).not.toBe(firstBody.accessToken.id);

    const { data: firstToken } = await serviceClient
      .from('application_access_tokens')
      .select('revoked_at')
      .eq('id', firstBody.accessToken.id)
      .single();
    expect(firstToken!.revoked_at).not.toBeNull();

    const { count: currentCount } = await serviceClient
      .from('application_access_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('application_id', applicationId)
      .is('revoked_at', null);
    expect(currentCount).toBe(1);

    const response = await GET(accessTokensGetRequest(applicationId), { params: Promise.resolve({ id: applicationId }) });
    const body = await response.json();
    expect(body.accessToken.isCurrent).toBe(true);
  });
});
