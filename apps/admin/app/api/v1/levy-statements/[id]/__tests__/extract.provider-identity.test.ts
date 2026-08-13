import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Infrastructure hardening pass (WORKLOG.md this date): proves the real, previously-disclosed gap
// is closed -- extraction_jobs.provider_name existed as a column but nothing ever wrote it, and
// extraction_results had no such column at all. This test calls the REAL POST
// /api/v1/levy-statements/:id/extract route handler (same real-local-Supabase integration pattern
// as documents/[id]/__tests__/route.compliance-access.test.ts), not a mock of the route, so a
// passing test proves the actual persisted row, not just that the code compiles.

let mockAuthorizationHeader: string | null = null;

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null,
  }),
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { POST } = await import('../extract/route');

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
async function adminGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  return res.json();
}
async function adminDelete(path: string) {
  await fetch(`${SUPABASE_URL}${path}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
}

function postRequest(): NextRequest {
  return new NextRequest('http://localhost/api/v1/levy-statements/x/extract', {
    method: 'POST',
    headers: mockAuthorizationHeader ? { Authorization: mockAuthorizationHeader } : {},
  });
}

describeIfSupabase(
  'POST /api/v1/levy-statements/:id/extract -- provider identity persistence (real local Supabase integration)',
  () => {
    let staffId: string;
    let orgId: string;
    let statementId: string;
    let documentId: string;

    beforeEach(async () => {
      const email = `provider-identity-${Date.now()}@propertyvault.example`;
      const created = await adminFetch('/auth/v1/admin/users', {
        email,
        password: 'TestPassw0rd!23',
        email_confirm: true,
      });
      staffId = created.id;

      const [org] = await adminFetch('/rest/v1/organizations', {
        legal_name: `Provider Identity Vitest Org ${Date.now()}`,
        org_type: 'agency',
      });
      orgId = org.id;
      await adminFetch('/rest/v1/organization_members', {
        org_id: orgId,
        user_id: staffId,
        role: 'principal',
        status: 'active',
        joined_at: new Date().toISOString(),
      });

      const [property] = await adminFetch('/rest/v1/properties', {
        org_id: orgId,
        nickname: 'Provider Identity Property',
        address_line1: '1 Test St',
        city: 'Durban',
        country: 'ZA',
        property_type: 'apartment',
      });

      const categories = await adminGet('/rest/v1/document_categories?slug=eq.levies&select=id');
      const categoryId = categories[0].id;

      const storagePath = `${orgId}/provider-identity-test-${Date.now()}.pdf`;
      const [document] = await adminFetch('/rest/v1/documents', {
        owner_user_id: staffId,
        org_id: orgId,
        property_id: property.id,
        category_id: categoryId,
        document_type: 'statement',
        storage_path: storagePath,
        original_file_name: 'levy-statement.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 313,
        checksum_sha256: 'test-checksum',
      });
      documentId = document.id;

      await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${storagePath}`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/pdf',
        },
        body: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]),
      });

      const [statement] = await adminFetch('/rest/v1/levy_statements', {
        org_id: orgId,
        property_id: property.id,
        document_id: documentId,
        status: 'uploaded',
        created_by: staffId,
      });
      statementId = statement.id;

      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'TestPassw0rd!23' }),
      });
      const tokenBody = await tokenRes.json();
      mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await adminDelete(`/rest/v1/levy_statement_line_items?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/levy_statements?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/extraction_results?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/extraction_jobs?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/documents?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/properties?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/organization_members?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/organizations?id=eq.${orgId}`);
      await adminDelete(`/auth/v1/admin/users/${staffId}`);
    });

    it('a successful extraction persists provider_name on BOTH extraction_jobs and extraction_results (never "unknown", never client-suppliable)', async () => {
      const response = await POST(postRequest(), { params: Promise.resolve({ id: statementId }) });
      expect(response.status).toBe(200);

      const [statement] = await adminGet(
        `/rest/v1/levy_statements?id=eq.${statementId}&select=extraction_job_id`,
      );
      expect(statement.extraction_job_id).toBeTruthy();

      const [job] = await adminGet(
        `/rest/v1/extraction_jobs?id=eq.${statement.extraction_job_id}&select=status,provider_name`,
      );
      expect(job.status).toBe('succeeded');
      // Local/CI has no real AWS/Google credentials configured -- MockDocumentIntelligenceProvider
      // is what genuinely resolves here, so 'mock' is the CORRECT expected value, not a stand-in.
      expect(job.provider_name).toBe('mock');

      const [result] = await adminGet(
        `/rest/v1/extraction_results?extraction_job_id=eq.${statement.extraction_job_id}&select=provider_name`,
      );
      expect(result.provider_name).toBe('mock');
    });

    it('provider_name cannot be forged by request body -- the route never reads a client-supplied value for it', async () => {
      // The route takes no request body for this endpoint at all (POST with no fields read from
      // it) -- this test documents that guarantee explicitly by sending a body claiming a
      // different provider and asserting it has zero effect.
      const request = new NextRequest('http://localhost/api/v1/levy-statements/x/extract', {
        method: 'POST',
        headers: { Authorization: mockAuthorizationHeader!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerName: 'google-document-ai',
          provider_name: 'google-document-ai',
        }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: statementId }) });
      expect(response.status).toBe(200);

      const [statement] = await adminGet(
        `/rest/v1/levy_statements?id=eq.${statementId}&select=extraction_job_id`,
      );
      const [job] = await adminGet(
        `/rest/v1/extraction_jobs?id=eq.${statement.extraction_job_id}&select=provider_name`,
      );
      expect(job.provider_name).toBe('mock'); // unaffected by the forged body field
    });
  },
);
