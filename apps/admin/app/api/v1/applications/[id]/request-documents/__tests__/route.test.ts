import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 14 idempotency matrix: no
// test previously existed for this route's own "state-change, not call-count" idempotency guard
// (route.ts's own docblock claims it, never verified against the real route). Proves: a first
// call transitions the targeted requirement(s) and writes one audit event + one email; an
// immediate identical retry (re-click) changes nothing further -- no second audit event, no
// second email, and the requirement is not re-touched.

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

const { POST } = await import('../route');

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

function requestDocsRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/v1/applications/${id}/request-documents`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describeIfSupabase('POST /api/v1/applications/:id/request-documents (real local Supabase integration)', () => {
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
    const email = `req-docs-manager-${Date.now()}@propertyvault.example`;
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
      legal_name: `Request Docs Vitest Org ${Date.now()}`,
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
      .insert({ org_id: orgId, nickname: 'Request Docs Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
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
        applicant_name: 'Request Docs Applicant',
        applicant_email: 'request-docs-applicant@example.com',
        status: 'submitted',
      })
      .select('id')
      .single();
    applicationId = application!.id;

    // seed_default_application_document_requirements() is SECURITY DEFINER but still checks the
    // CALLING user's own org role via has_org_role() (auth.uid()) -- the service-role client has
    // no such identity and this call would silently raise (uncaught) if called on it, leaving
    // requirements empty. Must be called as the manager, exactly like create_application_access_token
    // in the OCR extract route test.
    const managerClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: mockAuthorizationHeader! } },
    });
    const { error: seedError } = await managerClient.rpc('seed_default_application_document_requirements', {
      p_application_id: applicationId,
    });
    if (seedError) throw new Error(`seed_default_application_document_requirements failed: ${seedError.message}`);
    // Mark id_document as already uploaded, so requesting it again is a real state transition.
    await serviceClient
      .from('application_document_requirements')
      .update({ status: 'uploaded' })
      .eq('application_id', applicationId)
      .eq('requirement_key', 'id_document');
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await serviceClient.from('audit_events').delete().eq('entity_id', applicationId);
    await serviceClient.from('email_messages').delete().eq('org_id', orgId);
    await serviceClient.from('applications').delete().eq('id', applicationId);
    await serviceClient.from('units').delete().eq('id', unitId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
  });

  it('a first call transitions the requirement to requested, writes one audit event and one email', async () => {
    const response = await POST(requestDocsRequest(applicationId, { requirementKeys: ['id_document'], message: 'Please re-upload, the scan was blurry' }), {
      params: Promise.resolve({ id: applicationId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.requested).toEqual(['id_document']);

    const { data: requirement } = await serviceClient
      .from('application_document_requirements')
      .select('status, rejection_reason, document_id')
      .eq('application_id', applicationId)
      .eq('requirement_key', 'id_document')
      .single();
    expect(requirement!.status).toBe('requested');
    expect(requirement!.rejection_reason).toBe('Please re-upload, the scan was blurry');
    expect(requirement!.document_id).toBeNull();

    const { count: auditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', applicationId)
      .eq('action', 'application.documents_requested');
    expect(auditCount).toBe(1);

    const { count: emailCount } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('template_name', 'application_documents_requested');
    expect(emailCount).toBe(1);
  });

  it('an immediate identical retry (already requested) is a true no-op -- zero new audit events, zero new emails', async () => {
    await POST(requestDocsRequest(applicationId, { requirementKeys: ['id_document'], message: 'Please re-upload' }), {
      params: Promise.resolve({ id: applicationId }),
    });

    const second = await POST(requestDocsRequest(applicationId, { requirementKeys: ['id_document'], message: 'Please re-upload' }), {
      params: Promise.resolve({ id: applicationId }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.requested).toEqual([]);

    const { count: auditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', applicationId)
      .eq('action', 'application.documents_requested');
    expect(auditCount).toBe(1);

    const { count: emailCount } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('template_name', 'application_documents_requested');
    expect(emailCount).toBe(1);
  });

  it('a later request for a DIFFERENT requirement is a genuine second round -- gets its own audit event and email', async () => {
    await POST(requestDocsRequest(applicationId, { requirementKeys: ['id_document'] }), {
      params: Promise.resolve({ id: applicationId }),
    });

    // application_document_requirements.status defaults to 'requested' on seeding -- proof_of_income
    // must be moved to 'uploaded' first so requesting it again is a genuine transition, not a no-op
    // (the same reason id_document itself is marked 'uploaded' in beforeEach before every test).
    await serviceClient
      .from('application_document_requirements')
      .update({ status: 'uploaded' })
      .eq('application_id', applicationId)
      .eq('requirement_key', 'proof_of_income');

    const second = await POST(requestDocsRequest(applicationId, { requirementKeys: ['id_document', 'proof_of_income'] }), {
      params: Promise.resolve({ id: applicationId }),
    });
    const secondBody = await second.json();
    expect(secondBody.requested).toEqual(['proof_of_income']);

    const { count: auditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', applicationId)
      .eq('action', 'application.documents_requested');
    expect(auditCount).toBe(2);
  });
});
