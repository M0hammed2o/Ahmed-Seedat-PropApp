import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Task 7 (property compliance completion pass, WORKLOG.md this date): "verify the actual user
// flow... do not rely only on pgTAP if a safe app-level test can verify it." pgTAP already proves
// the table- and storage-object-level RLS in isolation (supabase/tests/property_compliance.test.sql);
// this proves the REAL route a tenant's browser actually calls -- GET /api/v1/documents/:id --
// end-to-end: table read (RLS) AND storage.createSignedUrl() (storage RLS) both happen inside this
// one route, using the caller's own session-bound client throughout, exactly as production does.
// Same real-local-Supabase integration pattern as switch-tenancy's own route test.

let mockAuthorizationHeader: string | null = null;

// getServerSupabaseClient() calls next/headers' headers()/cookies() -- both throw when called
// outside a real Next.js request scope, which a plain vitest run always is. Mocked the same way
// switch-tenancy's own route test already does; this route only ever needs the bearer-token
// branch (headers()), but cookies() is still exercised on the unauthenticated-fallback path, so
// both are mocked to avoid a crash regardless of which branch a given test hits.
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

function getRequest(): NextRequest {
  return new NextRequest('http://localhost/api/v1/documents/x', {
    headers: mockAuthorizationHeader ? { Authorization: mockAuthorizationHeader } : {},
  });
}

describeIfSupabase(
  'GET /api/v1/documents/:id -- tenant compliance-document access (real local Supabase integration)',
  () => {
    let userAId: string;
    let userCId: string;
    let orgId: string;
    let documentId: string;

    beforeEach(async () => {
      const emailA = `doc-access-a-${Date.now()}@propertyvault.example`;
      const emailC = `doc-access-c-${Date.now()}@propertyvault.example`;
      const password = 'TestPassw0rd!23';

      const createdA = await adminFetch('/auth/v1/admin/users', {
        email: emailA,
        password,
        email_confirm: true,
      });
      userAId = createdA.id;
      const createdC = await adminFetch('/auth/v1/admin/users', {
        email: emailC,
        password,
        email_confirm: true,
      });
      userCId = createdC.id;

      const [org] = await adminFetch('/rest/v1/organizations', {
        legal_name: `Doc Access Vitest Org ${Date.now()}`,
        org_type: 'agency',
      });
      orgId = org.id;

      const [property] = await adminFetch('/rest/v1/properties', {
        org_id: orgId,
        nickname: 'Doc Access Property',
        address_line1: '1 Test St',
        city: 'Durban',
        country: 'ZA',
        property_type: 'apartment',
      });

      const [unit] = await adminFetch('/rest/v1/units', {
        property_id: property.id,
        org_id: orgId,
        unit_label: 'Unit 1',
        status: 'occupied',
      });

      const [tenantA] = await adminFetch('/rest/v1/tenants', {
        org_id: orgId,
        user_id: userAId,
        full_name: 'Tenant A',
        status: 'active',
      });
      // Tenant C is deliberately NOT given any tenancy on this property at all -- an outsider by
      // direct id, not merely a co-tenant without a requirement (the tighter, more realistic case
      // an attacker guessing a document id would actually be in).

      const [lease] = await adminFetch('/rest/v1/leases', {
        org_id: orgId,
        unit_id: unit.id,
        start_date: '2026-01-01',
        rent_amount: 9000,
        status: 'active',
        source: 'manual',
      });
      await adminFetch('/rest/v1/lease_tenants', {
        lease_id: lease.id,
        tenant_id: tenantA.id,
        is_primary: true,
      });

      const categories = await adminGet(
        '/rest/v1/document_categories?slug=eq.compliance_documents&select=id',
      );
      const categoryId = categories[0].id;

      const [document] = await adminFetch('/rest/v1/documents', {
        owner_user_id: userAId,
        org_id: orgId,
        property_id: property.id,
        category_id: categoryId,
        document_type: 'other',
        storage_path: `${orgId}/doc-access-test-${Date.now()}.pdf`,
        original_file_name: 'conduct-rules.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 1000,
        checksum_sha256: 'test-checksum',
      });
      documentId = document.id;

      const [rule] = await adminFetch('/rest/v1/property_rules', {
        org_id: orgId,
        property_id: property.id,
        category: 'conduct_rules',
        title: 'Conduct Rules',
        created_by: userAId,
      });

      const [version] = await adminFetch('/rest/v1/property_rule_versions', {
        rule_id: rule.id,
        org_id: orgId,
        document_id: documentId,
        version_number: 1,
        status: 'active',
        effective_date: '2026-01-01',
        created_by: userAId,
      });

      await adminFetch('/rest/v1/compliance_requirements', {
        org_id: orgId,
        property_id: property.id,
        rule_version_id: version.id,
        tenant_id: tenantA.id,
        status: 'pending',
      });

      // A real object row so storage.createSignedUrl() has something to actually sign, exactly
      // matching what the real upload pipeline would have written.
      await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${document.storage_path}`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/pdf',
        },
        body: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]), // "%PDF" magic bytes, minimal
      });
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await adminDelete(`/rest/v1/compliance_requirements?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/property_rule_versions?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/property_rules?org_id=eq.${orgId}`);
      // lease_tenants has no org_id of its own -- deleting `leases` (next line) cascades to it
      // (lease_tenants.lease_id references leases(id) on delete cascade), no separate delete needed.
      await adminDelete(`/rest/v1/leases?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/tenants?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/documents?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/units?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/properties?org_id=eq.${orgId}`);
      await adminDelete(`/rest/v1/organizations?id=eq.${orgId}`);
      await adminDelete(`/auth/v1/admin/users/${userAId}`);
      await adminDelete(`/auth/v1/admin/users/${userCId}`);
    });

    it('an authorized tenant (has a compliance requirement for this document) gets a real signed URL', async () => {
      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: (await adminGet(`/auth/v1/admin/users/${userAId}`)).email,
          password: 'TestPassw0rd!23',
        }),
      });
      const tokenBody = await tokenRes.json();
      mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

      const response = await GET(getRequest(), { params: Promise.resolve({ id: documentId }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.document.id).toBe(documentId);
      expect(typeof body.signedUrl).toBe('string');
      expect(body.signedUrl.length).toBeGreaterThan(0);
    });

    it('an unauthorized tenant (no compliance requirement, no tenancy at all on this property) cannot read the row or get a signed URL', async () => {
      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: (await adminGet(`/auth/v1/admin/users/${userCId}`)).email,
          password: 'TestPassw0rd!23',
        }),
      });
      const tokenBody = await tokenRes.json();
      mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

      const response = await GET(getRequest(), { params: Promise.resolve({ id: documentId }) });
      // The route's own RLS-scoped SELECT returns no row for an unauthorized caller -- it never
      // even reaches the storage.createSignedUrl() call, matching "not found" rather than
      // disclosing that a document with this id exists but is forbidden.
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('not_found');
    });

    it('an unauthenticated caller cannot read the document either', async () => {
      mockAuthorizationHeader = null;
      const response = await GET(getRequest(), { params: Promise.resolve({ id: documentId }) });
      expect(response.status).toBe(401);
    });
  },
);
