import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Real integration test against local Supabase, same pattern as
// tenant-portal/switch-tenancy/__tests__/route.test.ts and lib/__tests__/tenantSession.test.ts --
// the route handler itself invoked directly with a constructed NextRequest, so the route's own
// auth/ownership-check/upload code actually runs. Android V1 last local blocker pass (WORKLOG.md
// this date).

let mockAuthorizationHeader: string | null = null;
const mockCookieJar = new Map<string, string>();

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

function uploadRequest(ticketId: string, file: File | null): NextRequest {
  const form = new FormData();
  if (file) form.set('file', file);
  return new NextRequest(
    `http://localhost/api/v1/tenant-portal/maintenance-tickets/${ticketId}/documents`,
    { method: 'POST', body: form },
  );
}

describeIfSupabase(
  'POST /api/v1/tenant-portal/maintenance-tickets/:id/documents (real local Supabase integration)',
  () => {
    let userAId: string;
    let userBId: string;
    let orgId: string;
    let ticketAId: string;
    let ticketBId: string;

    async function createPropertyUnitLease(nickname: string) {
      const propertyRows = await adminFetch('/rest/v1/properties', {
        org_id: orgId,
        nickname,
        address_line1: '1 Test St',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'house',
      });
      const propertyId = propertyRows[0].id;
      const unitRows = await adminFetch('/rest/v1/units', {
        property_id: propertyId,
        org_id: orgId,
        unit_label: 'Unit 1',
        status: 'occupied',
      });
      const leaseRows = await adminFetch('/rest/v1/leases', {
        org_id: orgId,
        unit_id: unitRows[0].id,
        start_date: '2026-01-01',
        rent_amount: 5000,
        status: 'active',
        source: 'manual',
      });
      return { propertyId, unitId: unitRows[0].id, leaseId: leaseRows[0].id };
    }

    beforeEach(async () => {
      mockCookieJar.clear();

      const emailA = `maint-doc-a-${Date.now()}@propertyvault.example`;
      const emailB = `maint-doc-b-${Date.now()}@propertyvault.example`;
      const password = 'TestPassw0rd!23';

      const createdA = await adminFetch('/auth/v1/admin/users', {
        email: emailA,
        password,
        email_confirm: true,
      });
      userAId = createdA.id;
      const createdB = await adminFetch('/auth/v1/admin/users', {
        email: emailB,
        password,
        email_confirm: true,
      });
      userBId = createdB.id;

      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailA, password }),
      });
      const tokenBody = await tokenRes.json();
      mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

      const orgRows = await adminFetch('/rest/v1/organizations', {
        legal_name: `Maint Doc Vitest Org ${Date.now()}`,
        org_type: 'agency',
      });
      orgId = orgRows[0].id;

      const propA = await createPropertyUnitLease('Property A');
      const propB = await createPropertyUnitLease('Property B');

      const tenantARows = await adminFetch('/rest/v1/tenants', {
        org_id: orgId,
        user_id: userAId,
        full_name: 'Tenant A',
        status: 'active',
      });
      const tenantAId = tenantARows[0].id;
      const tenantBRows = await adminFetch('/rest/v1/tenants', {
        org_id: orgId,
        user_id: userBId,
        full_name: 'Tenant B',
        status: 'active',
      });
      const tenantBId = tenantBRows[0].id;

      await adminFetch('/rest/v1/lease_tenants', { lease_id: propA.leaseId, tenant_id: tenantAId });
      await adminFetch('/rest/v1/lease_tenants', { lease_id: propB.leaseId, tenant_id: tenantBId });

      const ticketARows = await adminFetch('/rest/v1/maintenance_tickets', {
        org_id: orgId,
        property_id: propA.propertyId,
        unit_id: propA.unitId,
        lease_id: propA.leaseId,
        tenant_id: tenantAId,
        submitted_by_tenant_id: tenantAId,
        summary: "Tenant A's ticket",
        priority: 'medium',
      });
      ticketAId = ticketARows[0].id;

      const ticketBRows = await adminFetch('/rest/v1/maintenance_tickets', {
        org_id: orgId,
        property_id: propB.propertyId,
        unit_id: propB.unitId,
        lease_id: propB.leaseId,
        tenant_id: tenantBId,
        submitted_by_tenant_id: tenantBId,
        summary: "Tenant B's ticket",
        priority: 'medium',
      });
      ticketBId = ticketBRows[0].id;
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await fetch(`${SUPABASE_URL}/rest/v1/documents?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/maintenance_tickets?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/tenants?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/leases?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/properties?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userAId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userBId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
    });

    it('lets a tenant attach a photo to their own maintenance ticket', async () => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' });
      const response = await POST(uploadRequest(ticketAId, file), {
        params: Promise.resolve({ id: ticketAId }),
      });
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.document.originalFileName).toBe('photo.png');
      expect(body.document.mimeType).toBe('image/png');
    });

    it("rejects a tenant attaching to another tenant's ticket with 404", async () => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' });
      const response = await POST(uploadRequest(ticketBId, file), {
        params: Promise.resolve({ id: ticketBId }),
      });
      expect(response.status).toBe(404);
    });

    it('rejects an unauthenticated caller with 401', async () => {
      mockAuthorizationHeader = null;
      const file = new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' });
      const response = await POST(uploadRequest(ticketAId, file), {
        params: Promise.resolve({ id: ticketAId }),
      });
      expect(response.status).toBe(401);
    });

    it('rejects a missing file with 400', async () => {
      const response = await POST(uploadRequest(ticketAId, null), {
        params: Promise.resolve({ id: ticketAId }),
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('validation_failed');
    });

    it('rejects an unsupported MIME type with 400', async () => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], 'script.js', {
        type: 'application/javascript',
      });
      const response = await POST(uploadRequest(ticketAId, file), {
        params: Promise.resolve({ id: ticketAId }),
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('unsupported_mime_type');
    });

    it('a non-existent ticket id returns 404, never 403 (does not confirm existence)', async () => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' });
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await POST(uploadRequest(fakeId, file), {
        params: Promise.resolve({ id: fakeId }),
      });
      expect(response.status).toBe(404);
    });

    it('the uploaded document is readable back via GET /api/v1/documents?filter[maintenance_ticket_id]', async () => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' });
      const uploadResponse = await POST(uploadRequest(ticketAId, file), {
        params: Promise.resolve({ id: ticketAId }),
      });
      expect(uploadResponse.status).toBe(201);
      const uploaded = await uploadResponse.json();

      const { GET } = await import('../../../../../documents/route');
      const listResponse = await GET(
        new NextRequest(
          `http://localhost/api/v1/documents?filter[maintenance_ticket_id]=${ticketAId}`,
        ),
      );
      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json();
      expect(listBody.documents.map((d: { id: string }) => d.id)).toContain(uploaded.document.id);
    });
  },
);
