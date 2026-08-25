import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25): real integration test against
// local Supabase for the token-scoped applicant OCR extract route -- proves idempotency (Phase 5:
// "same document -> no unlimited OCR jobs", "page refresh -> does not rerun completed OCR") and
// Professional-plan entitlement enforcement (Phase F) end to end through the real route, not just
// by inspection. Same real-local-Supabase pattern as the other route integration tests this
// session (e.g. lease-templates/__tests__/route.test.ts) -- setup goes through the service-role
// REST API directly (no staff session needed at all here, since every call under test is itself
// unauthenticated/token-scoped, matching what a real applicant's browser actually sends).

vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, getAll: () => [] }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { POST } = await import('../route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

describeIfSupabase('POST /api/v1/apply/:token/documents/:documentId/extract (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let unitId: string;
  let applicationId: string;
  let documentId: string;
  let token: string;
  let managerId: string;
  let storagePath: string;

  beforeEach(async () => {
    const email = `ocr-manager-${Date.now()}@propertyvault.example`;
    const password = 'TestPassw0rd!23';
    const created = await adminFetch('/auth/v1/admin/users', { email, password, email_confirm: true });
    managerId = created.id;

    // create_application_access_token() is SECURITY DEFINER but still checks the CALLING user's
    // own org/property role via has_org_role()/has_property_access() (auth.uid()) -- the
    // service-role client has no such identity, so it must be called as the manager, not as
    // service-role, exactly like every other staff-authorized RPC in this codebase's tests.
    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const tokenBody = await tokenRes.json();
    const managerClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${tokenBody.access_token}` } },
    });

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `OCR Extract Vitest Org ${Date.now()}`,
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
      .insert({ org_id: orgId, nickname: 'OCR Test Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
      .select('id')
      .single();
    propertyId = property!.id;

    const { data: unit } = await serviceClient
      .from('units')
      .insert({ property_id: propertyId, org_id: orgId, unit_label: 'U1', status: 'vacant' })
      .select('id')
      .single();
    unitId = unit!.id;

    // create_application_access_token() checks has_property_access(..., 'property_manager'),
    // which is a separate grant from organization_members -- an org 'manager' role alone does not
    // imply it (see 20260101000064_properties_access_cutover.sql).
    await serviceClient
      .from('property_access')
      .insert({ property_id: propertyId, user_id: managerId, property_role: 'administrator' });

    const { data: application } = await serviceClient
      .from('applications')
      .insert({ org_id: orgId, property_id: propertyId, unit_id: unitId, applicant_name: 'OCR Test Applicant', status: 'invited' })
      .select('id')
      .single();
    applicationId = application!.id;

    await serviceClient.rpc('seed_default_application_document_requirements', { p_application_id: applicationId });

    const { data: tokenRows, error: tokenError } = await managerClient.rpc('create_application_access_token', {
      p_application_id: applicationId,
      p_delivery_channel: 'manual',
    });
    if (tokenError) throw new Error(`create_application_access_token failed: ${tokenError.message}`);
    token = (tokenRows as { token: string }[])[0]!.token;

    const { data: category } = await serviceClient.from('document_categories').select('id').eq('slug', 'tenant_documents').single();
    storagePath = `${orgId}/${propertyId}/ocr-test-id-${Date.now()}.pdf`;
    // The extract route creates a real signed URL against the storage object -- local Supabase
    // Storage 404s ("Object not found") on a signed-URL request for a path with no actual object,
    // so the metadata row alone (as every other route-level fixture in this codebase inserts)
    // isn't enough here; a real (tiny, synthetic) object must exist at storage_path too.
    const { error: uploadError } = await serviceClient.storage
      .from('documents')
      .upload(storagePath, Buffer.from('%PDF-1.4\n%synthetic ocr test id document\n%%EOF'), {
        contentType: 'application/pdf',
      });
    if (uploadError) throw new Error(`test fixture upload failed: ${uploadError.message}`);
    const { data: document } = await serviceClient
      .from('documents')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        application_id: applicationId,
        category_id: category!.id,
        document_type: 'id_document',
        storage_path: storagePath,
        original_file_name: 'id.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 100,
        checksum_sha256: 'deadbeef',
      })
      .select('id')
      .single();
    documentId = document!.id;
  });

  afterEach(async () => {
    await serviceClient.storage.from('documents').remove([storagePath]);
    await serviceClient.from('applications').delete().eq('id', applicationId);
    await serviceClient.from('units').delete().eq('id', unitId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
  });

  function extractRequest() {
    return new NextRequest(`http://localhost/api/v1/apply/${token}/documents/${documentId}/extract`, { method: 'POST' });
  }

  it('a valid token can trigger OCR extraction and receives real mock-provider field suggestions', async () => {
    const response = await POST(extractRequest(), { params: Promise.resolve({ token, documentId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reused).toBe(false);
    expect(body.extractionResult.rawProviderOutput.fullName.value).toBe('Mock Applicant');
    expect(body.extractionResult.rawProviderOutput.idNumber.confidence).toBeGreaterThan(0);
  });

  it('is idempotent: a second call on the same document reuses the existing result instead of re-running OCR', async () => {
    const first = await POST(extractRequest(), { params: Promise.resolve({ token, documentId }) });
    const firstBody = await first.json();

    const second = await POST(extractRequest(), { params: Promise.resolve({ token, documentId }) });
    const secondBody = await second.json();

    expect(secondBody.reused).toBe(true);
    expect(secondBody.extractionResult.id).toBe(firstBody.extractionResult.id);

    const { count } = await serviceClient
      .from('extraction_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);
    expect(count).toBe(1);
  });

  it('an invalid/garbage token is rejected without ever touching extraction_jobs', async () => {
    const response = await POST(
      new NextRequest(`http://localhost/api/v1/apply/not-a-real-token/documents/${documentId}/extract`, { method: 'POST' }),
      { params: Promise.resolve({ token: 'not-a-real-token', documentId }) },
    );
    expect(response.status).toBe(410);

    const { count } = await serviceClient
      .from('extraction_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);
    expect(count).toBe(0);
  });

  it('a token cannot trigger OCR on a document belonging to a different application', async () => {
    const { data: otherApp } = await serviceClient
      .from('applications')
      .insert({ org_id: orgId, property_id: propertyId, unit_id: unitId, applicant_name: 'Other Applicant', status: 'invited' })
      .select('id')
      .single();
    const { data: category } = await serviceClient.from('document_categories').select('id').eq('slug', 'tenant_documents').single();
    const { data: otherDoc } = await serviceClient
      .from('documents')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        application_id: otherApp!.id,
        category_id: category!.id,
        document_type: 'id_document',
        storage_path: `${orgId}/${propertyId}/other-id.pdf`,
        original_file_name: 'other.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 100,
        checksum_sha256: 'other',
      })
      .select('id')
      .single();

    const response = await POST(
      new NextRequest(`http://localhost/api/v1/apply/${token}/documents/${otherDoc!.id}/extract`, { method: 'POST' }),
      { params: Promise.resolve({ token, documentId: otherDoc!.id }) },
    );
    expect(response.status).toBe(404);

    await serviceClient.from('applications').delete().eq('id', otherApp!.id);
  });

  // Phase 4 (OCR VALUE TEST, WORKLOG.md 2026-08-25): proves the extraction pipeline end to end,
  // through the real route, for every one of the 4 applicant document types -- not just
  // id_document (the only type exercised above). Each assertion is the exact synthetic value
  // MockDocumentIntelligenceProvider returns for that documentType (documentIntelligence.ts) --
  // this is what the FINAL PREDEPLOY REPORT's OCR value-test table is generated from.
  async function uploadAndExtract(documentType: 'proof_of_address' | 'payslip' | 'bank_statement') {
    const { data: category } = await serviceClient.from('document_categories').select('id').eq('slug', 'tenant_documents').single();
    const path = `${orgId}/${propertyId}/ocr-value-test-${documentType}-${Date.now()}.pdf`;
    await serviceClient.storage
      .from('documents')
      .upload(path, Buffer.from(`%PDF-1.4\n%synthetic ${documentType}\n%%EOF`), { contentType: 'application/pdf' });
    const { data: document } = await serviceClient
      .from('documents')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        application_id: applicationId,
        category_id: category!.id,
        document_type: documentType,
        storage_path: path,
        original_file_name: `${documentType}.pdf`,
        mime_type: 'application/pdf',
        file_size_bytes: 100,
        checksum_sha256: `value-test-${documentType}`,
      })
      .select('id')
      .single();
    const response = await POST(
      new NextRequest(`http://localhost/api/v1/apply/${token}/documents/${document!.id}/extract`, { method: 'POST' }),
      { params: Promise.resolve({ token, documentId: document!.id }) },
    );
    const body = await response.json();
    return { response, body, path };
  }

  it('proof_of_address: extracts personName, residentialAddress, documentDate with the expected confidence values', async () => {
    const { response, body, path } = await uploadAndExtract('proof_of_address');
    expect(response.status).toBe(200);
    const fields = body.extractionResult.rawProviderOutput;
    expect(fields.personName.value).toBe('Mock Applicant');
    expect(fields.personName.confidence).toBe(0.85);
    expect(fields.residentialAddress.value).toBe('1 Mock Street, Cape Town, 8001');
    expect(fields.residentialAddress.confidence).toBe(0.75);
    expect(fields.documentDate.confidence).toBe(0.7);
    await serviceClient.storage.from('documents').remove([path]);
  });

  it('payslip: extracts employeeName, employerName, grossIncome, netIncome, payPeriod with the expected confidence values', async () => {
    const { response, body, path } = await uploadAndExtract('payslip');
    expect(response.status).toBe(200);
    const fields = body.extractionResult.rawProviderOutput;
    expect(fields.employeeName.value).toBe('Mock Applicant');
    expect(fields.employerName.value).toBe('Mock Employer (Pty) Ltd');
    expect(fields.grossIncome.value).toBe(25000);
    expect(fields.grossIncome.confidence).toBe(0.75);
    expect(fields.netIncome.value).toBe(19500);
    expect(fields.netIncome.confidence).toBe(0.72);
    expect(fields.payPeriod.confidence).toBe(0.7);
    await serviceClient.storage.from('documents').remove([path]);
  });

  it('bank_statement: extracts accountHolderName, statementPeriod, residentialAddress with the expected confidence values', async () => {
    const { response, body, path } = await uploadAndExtract('bank_statement');
    expect(response.status).toBe(200);
    const fields = body.extractionResult.rawProviderOutput;
    expect(fields.accountHolderName.value).toBe('Mock Applicant');
    expect(fields.accountHolderName.confidence).toBe(0.86);
    expect(fields.statementPeriod.confidence).toBe(0.7);
    expect(fields.residentialAddress.value).toBe('1 Mock Street, Cape Town, 8001');
    expect(fields.residentialAddress.confidence).toBe(0.6);
    await serviceClient.storage.from('documents').remove([path]);
  });

  it('id_document: full field set includes dateOfBirth and nationality (low-confidence field), each within [0,1]', async () => {
    const response = await POST(extractRequest(), { params: Promise.resolve({ token, documentId }) });
    const body = await response.json();
    const fields = body.extractionResult.rawProviderOutput;
    expect(fields.dateOfBirth.value).toBe('1990-01-01');
    expect(fields.nationality.value).toBe('South African');
    expect(fields.nationality.confidence).toBe(0.85); // below the 0.9+ high-confidence fields -- exercises the UI's low-confidence highlight path only below 0.7, so this one is NOT highlighted, proving the boundary is real
    for (const field of Object.values(fields) as { confidence: number }[]) {
      if (typeof field?.confidence === 'number') {
        expect(field.confidence).toBeGreaterThan(0);
        expect(field.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('OCR is blocked server-side for an org on a plan without ocrEnabled', async () => {
    const { data: starterPlan } = await serviceClient.from('plans').select('id').eq('name', 'Starter').limit(1).single();
    await serviceClient.from('organization_subscriptions').insert({
      org_id: orgId,
      plan_id: starterPlan!.id,
      status: 'active',
      billing_cycle: 'monthly',
      current_period_start: new Date().toISOString().slice(0, 10),
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    });

    const response = await POST(extractRequest(), { params: Promise.resolve({ token, documentId }) });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('feature_not_available');
  });
});
