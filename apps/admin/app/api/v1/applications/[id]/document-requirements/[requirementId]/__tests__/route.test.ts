import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Landlord/staff launch-hardening pass (WORKLOG.md 2026-08-26), Section 3: the staff UI had no
// clear applicant-document review action (view/accept/needs-correction). This route is the new
// server-side half of that fix. Proves: reviewing a requirement with no document yet uploaded is
// rejected (409); accepting an uploaded requirement clears any prior rejection reason and writes
// an "accepted" audit event; rejecting one requires/stores a reason and writes a "reviewed" audit
// event; a requirement belonging to a DIFFERENT application is never visible through this route
// (404, not a cross-tenant leak).

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

const { PATCH } = await import('../route');

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

function reviewRequest(applicationId: string, requirementId: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/v1/applications/${applicationId}/document-requirements/${requirementId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

describeIfSupabase('PATCH /api/v1/applications/:id/document-requirements/:requirementId (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let unitId: string;
  let applicationId: string;
  let managerId: string;
  let requirementId: string;
  let documentId: string;

  beforeEach(async () => {
    mockCookieJar.clear();
    const email = `doc-review-manager-${Date.now()}@propertyvault.example`;
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
      legal_name: `Doc Review Vitest Org ${Date.now()}`,
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
      .insert({ org_id: orgId, nickname: 'Doc Review Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
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
        applicant_name: 'Doc Review Applicant',
        applicant_email: 'doc-review-applicant@example.com',
        status: 'submitted',
      })
      .select('id')
      .single();
    applicationId = application!.id;

    // Go through the real applicant-facing path (seed requirements -> issue a token -> record an
    // upload against it) instead of hand-inserting into `documents`/`application_document_requirements`
    // directly -- both tables have several NOT NULL/FK columns (category_id, document_type,
    // storage_path, checksum...) whose correct values are owned by record_application_document_upload()
    // itself; reproducing its insert by hand here would silently drift from the real schema.
    const managerClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: mockAuthorizationHeader! } },
    });
    const { error: seedError } = await managerClient.rpc('seed_default_application_document_requirements', {
      p_application_id: applicationId,
    });
    if (seedError) throw new Error(`seed_default_application_document_requirements failed: ${seedError.message}`);

    const { data: tokenRow, error: tokenError } = await managerClient
      .rpc('create_application_access_token', { p_application_id: applicationId, p_delivery_channel: 'manual' })
      .single();
    if (tokenError) throw new Error(`create_application_access_token failed: ${tokenError.message}`);
    const { token } = tokenRow as { token_id: string; token: string; expires_at: string };

    const { data: uploadRow, error: uploadError } = await serviceClient
      .rpc('record_application_document_upload', {
        p_token: token,
        p_requirement_key: 'id_document',
        p_storage_path: `applications/${applicationId}/id-document.pdf`,
        p_original_file_name: 'id-document.pdf',
        p_mime_type: 'application/pdf',
        p_file_size_bytes: 1024,
        p_checksum_sha256: 'a'.repeat(64),
      })
      .single();
    if (uploadError) throw new Error(`record_application_document_upload failed: ${uploadError.message}`);
    const upload = uploadRow as { success: boolean; error_code: string | null; document_id: string | null };
    if (!upload.success) throw new Error(`record_application_document_upload did not succeed: ${upload.error_code}`);
    documentId = upload.document_id!;

    const { data: requirement } = await serviceClient
      .from('application_document_requirements')
      .select('id')
      .eq('application_id', applicationId)
      .eq('requirement_key', 'id_document')
      .single();
    requirementId = requirement!.id;
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await serviceClient.from('audit_events').delete().eq('org_id', orgId);
    await serviceClient.from('application_document_requirements').delete().eq('application_id', applicationId);
    await serviceClient.from('documents').delete().eq('id', documentId);
    await serviceClient.from('applications').delete().eq('id', applicationId);
    await serviceClient.from('units').delete().eq('id', unitId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
  });

  it('rejects reviewing a requirement with nothing uploaded yet (409, no_document)', async () => {
    await serviceClient.from('application_document_requirements').update({ document_id: null, status: 'requested' }).eq('id', requirementId);

    const response = await PATCH(reviewRequest(applicationId, requirementId, { status: 'accepted' }), {
      params: Promise.resolve({ id: applicationId, requirementId }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('no_document');
  });

  it('accepts an uploaded requirement, clears any prior rejection reason, and writes one accepted audit event', async () => {
    await serviceClient
      .from('application_document_requirements')
      .update({ document_id: documentId, status: 'rejected', rejection_reason: 'blurry scan' })
      .eq('id', requirementId);

    const response = await PATCH(reviewRequest(applicationId, requirementId, { status: 'accepted' }), {
      params: Promise.resolve({ id: applicationId, requirementId }),
    });
    expect(response.status).toBe(200);

    const { data: updated } = await serviceClient
      .from('application_document_requirements')
      .select('status, rejection_reason, reviewed_by')
      .eq('id', requirementId)
      .single();
    expect(updated!.status).toBe('accepted');
    expect(updated!.rejection_reason).toBeNull();
    expect(updated!.reviewed_by).toBe(managerId);

    const { count: auditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', requirementId)
      .eq('action', 'application.document_accepted');
    expect(auditCount).toBe(1);
  });

  it('rejects an uploaded requirement with a reason and writes one reviewed audit event', async () => {
    await serviceClient.from('application_document_requirements').update({ document_id: documentId, status: 'uploaded' }).eq('id', requirementId);

    const response = await PATCH(
      reviewRequest(applicationId, requirementId, { status: 'rejected', rejectionReason: 'ID number does not match' }),
      { params: Promise.resolve({ id: applicationId, requirementId }) },
    );
    expect(response.status).toBe(200);

    const { data: updated } = await serviceClient
      .from('application_document_requirements')
      .select('status, rejection_reason')
      .eq('id', requirementId)
      .single();
    expect(updated!.status).toBe('rejected');
    expect(updated!.rejection_reason).toBe('ID number does not match');

    const { count: auditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', requirementId)
      .eq('action', 'application.document_reviewed');
    expect(auditCount).toBe(1);
  });

  it('404s a requirement id that does not belong to the given application (no cross-tenant leak)', async () => {
    const { data: otherApplication } = await serviceClient
      .from('applications')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        unit_id: unitId,
        applicant_name: 'Other Applicant',
        applicant_email: 'other-applicant@example.com',
        status: 'submitted',
      })
      .select('id')
      .single();

    const response = await PATCH(reviewRequest(otherApplication!.id, requirementId, { status: 'accepted' }), {
      params: Promise.resolve({ id: otherApplication!.id, requirementId }),
    });
    expect(response.status).toBe(404);

    await serviceClient.from('applications').delete().eq('id', otherApplication!.id);
  });
});
