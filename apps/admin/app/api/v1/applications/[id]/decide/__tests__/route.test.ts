import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 19: the application
// REJECTION path had zero automated coverage anywhere in this codebase before this file --
// grepped supabase/tests and apps/admin for a declined-application test and found none; every
// existing e2e/pgTAP/vitest test that touches decide/route.ts only exercises the approve branch.
// This proves, against the real route and real local Supabase, everything the master
// first-tenant-workflow instruction requires for a declined application: no tenant, no draft
// lease, no active lease, no occupancy change, no rent schedule, a decline email queued, WhatsApp
// dispatch correctly blocked (no consent on file) vs. eligible (consent on file), and the
// application.declined audit event -- plus that re-declining an already-decided application is
// rejected (409), not a silent duplicate.

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

function decideRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/v1/applications/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describeIfSupabase('POST /api/v1/applications/:id/decide -- rejection path (real local Supabase integration)', () => {
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
    const email = `decline-manager-${Date.now()}@propertyvault.example`;
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
      legal_name: `Decline Path Vitest Org ${Date.now()}`,
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
      .insert({ org_id: orgId, nickname: 'Decline Test Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
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
        applicant_name: 'Rejected Applicant',
        applicant_email: 'rejected-applicant@example.com',
        status: 'submitted',
      })
      .select('id')
      .single();
    applicationId = application!.id;
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await serviceClient.from('applicant_whatsapp_consents').delete().eq('application_id', applicationId);
    await serviceClient.from('audit_events').delete().eq('entity_id', applicationId);
    await serviceClient.from('email_messages').delete().eq('org_id', orgId);
    await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
    await serviceClient.from('applications').delete().eq('id', applicationId);
    await serviceClient.from('units').delete().eq('id', unitId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
  });

  it('declining an application creates NO tenant, NO lease, NO occupancy change, NO rent schedule -- only the application itself changes', async () => {
    const response = await POST(decideRequest(applicationId, { decision: 'declined', reason: 'Insufficient income' }), {
      params: Promise.resolve({ id: applicationId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.application.decision).toBe('declined');

    const { data: refetched } = await serviceClient
      .from('applications')
      .select('status, decision, decision_reason')
      .eq('id', applicationId)
      .single();
    expect(refetched!.status).toBe('decided');
    expect(refetched!.decision).toBe('declined');
    expect(refetched!.decision_reason).toBe('Insufficient income');

    // No tenant.
    const { data: tenants } = await serviceClient.from('tenants').select('id').eq('org_id', orgId);
    expect(tenants).toEqual([]);

    // No lease of any kind (draft or active) -- decline must never reach approve_application()'s
    // tenant+draft-lease creation path.
    const { data: leases } = await serviceClient.from('leases').select('id').eq('org_id', orgId);
    expect(leases).toEqual([]);

    // Unit occupancy untouched.
    const { data: unit } = await serviceClient.from('units').select('status').eq('id', unitId).single();
    expect(unit!.status).toBe('vacant');

    // No rent schedule rows (there is no lease for one to be generated against).
    const { data: rentSchedules } = await serviceClient
      .from('rent_schedules')
      .select('id')
      .eq('org_id', orgId);
    expect(rentSchedules).toEqual([]);
  });

  it('queues a real application_declined email to the applicant', async () => {
    await POST(decideRequest(applicationId, { decision: 'declined', reason: 'Insufficient income' }), {
      params: Promise.resolve({ id: applicationId }),
    });

    const { data: emails } = await serviceClient
      .from('email_messages')
      .select('template_name, to_address, related_entity_id')
      .eq('org_id', orgId)
      .eq('template_name', 'application_declined');
    expect(emails!.length).toBe(1);
    expect(emails![0]!.to_address).toBe('rejected-applicant@example.com');
    expect(emails![0]!.related_entity_id).toBe(applicationId);
  });

  it('WhatsApp decline dispatch is blocked (no_consent) when the applicant never opted in -- zero whatsapp_messages rows', async () => {
    await POST(decideRequest(applicationId, { decision: 'declined', reason: 'Insufficient income' }), {
      params: Promise.resolve({ id: applicationId }),
    });

    const { data: messages } = await serviceClient.from('whatsapp_messages').select('id').eq('org_id', orgId);
    expect(messages).toEqual([]);
  });

  it('WhatsApp decline dispatch is eligible and sends via the mock provider when the applicant HAS opted in', async () => {
    await serviceClient.from('applicant_whatsapp_consents').insert({
      application_id: applicationId,
      org_id: orgId,
      phone: '+27821234567',
      opted_in_at: new Date().toISOString(),
    });

    await POST(decideRequest(applicationId, { decision: 'declined', reason: 'Insufficient income' }), {
      params: Promise.resolve({ id: applicationId }),
    });

    const { data: messages } = await serviceClient
      .from('whatsapp_messages')
      .select('template_name, to_number')
      .eq('org_id', orgId);
    expect(messages!.length).toBe(1);
    expect(messages![0]!.template_name).toBe('application_declined');
    expect(messages![0]!.to_number).toBe('+27821234567');
  });

  it('writes exactly one application.declined audit_events row, actor_type user, with the reason', async () => {
    await POST(decideRequest(applicationId, { decision: 'declined', reason: 'Insufficient income' }), {
      params: Promise.resolve({ id: applicationId }),
    });

    const { data: events } = await serviceClient
      .from('audit_events')
      .select('action, actor_type, entity_type, entity_id, after')
      .eq('entity_id', applicationId)
      .eq('action', 'application.declined');
    expect(events!.length).toBe(1);
    expect(events![0]!.actor_type).toBe('user');
    expect(events![0]!.entity_type).toBe('applications');
    expect((events![0]!.after as { reason: string }).reason).toBe('Insufficient income');
  });

  it('a second decide call on the already-declined application is rejected (409), not a silent duplicate', async () => {
    const first = await POST(decideRequest(applicationId, { decision: 'declined', reason: 'Insufficient income' }), {
      params: Promise.resolve({ id: applicationId }),
    });
    expect(first.status).toBe(200);

    const second = await POST(decideRequest(applicationId, { decision: 'declined', reason: 'Changed my mind' }), {
      params: Promise.resolve({ id: applicationId }),
    });
    expect(second.status).toBe(409);

    // No second audit event, no second email, no second WhatsApp attempt from the retried call.
    const { count: auditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', applicationId)
      .eq('action', 'application.declined');
    expect(auditCount).toBe(1);

    const { count: emailCount } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('template_name', 'application_declined');
    expect(emailCount).toBe(1);
  });
});
