import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Tenant-portal release-gate pass (WORKLOG.md this date), Part A gap 1: dedicated automated
// coverage for the invoice_payment_id proof-of-payment path added to POST /api/v1/documents this
// pass (documents.invoice_payment_id, migration 20260101000158; the cross-org ownership check and
// accountant+ role floor added this pass after a source-review finding). Same
// invoke-the-real-route-handler-directly pattern as
// tenant-portal/maintenance-tickets/[id]/documents/__tests__/route.test.ts -- the route's own
// auth/ownership/upload code genuinely runs, not just a source-level read. Hardcoded to
// 127.0.0.1:54321 -- never touches production.

let mockAuthorizationHeader: string | null = null;

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

// This route's uploads default to sensitive:true (autonomous overnight completion pass,
// WORKLOG.md this date -- lib/uploadScan.ts's own comment explains why: proof-of-payment/lease/
// compliance documents are exactly the kind of upload TD-43's malware-scanning gap should not
// leave completely unscanned in production). This file's own concern is proof-of-payment
// association/role/cross-org logic, not the malware GATE'S OWN logic (dedicated coverage in
// lib/__tests__/uploadScan.test.ts) -- mocked clean here so a real local environment with no
// ClamAV configured (matching today's actual production state) doesn't block every assertion
// below with a 503.
vi.mock('@/lib/uploadScan', () => ({
  scanUploadOrRespond: async () => null,
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { POST, GET } = await import('../route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = 'TestPassw0rd!23';

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
async function adminRpc(name: string, args: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.access_token;
}

function uploadRequest(fields: Record<string, string>): NextRequest {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'synthetic-proof.pdf', {
    type: 'application/pdf',
  });
  form.set('file', file);
  return new NextRequest('http://localhost/api/v1/documents', { method: 'POST', body: form });
}

describeIfSupabase('POST /api/v1/documents -- proof of payment (real local Supabase integration)', () => {
  let orgId: string;
  let orgBId: string;
  let propertyId: string;
  let categoryId: string;
  let invoicePaymentId: string;
  let reversiblePaymentId: string;
  let orgBInvoicePaymentId: string;
  const userIds: string[] = [];

  beforeEach(async () => {
    mockAuthorizationHeader = null;
    const suffix = Date.now();

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Proof Of Payment Vitest Org ${suffix}`,
      org_type: 'agency',
    });
    orgId = orgRows[0].id;
    await adminRpc('seed_chart_of_accounts', { p_org_id: orgId });

    const orgBRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Proof Of Payment Vitest Org B ${suffix}`,
      org_type: 'agency',
    });
    orgBId = orgBRows[0].id;
    await adminRpc('seed_chart_of_accounts', { p_org_id: orgBId });

    const categoryRows = await adminGet('/rest/v1/document_categories?slug=eq.proof_of_payment&select=id');
    categoryId = categoryRows[0].id;

    const propertyRows = await adminFetch('/rest/v1/properties', {
      org_id: orgId,
      nickname: 'Proof Property',
      address_line1: '1 Test St',
      city: 'Cape Town',
      country: 'ZA',
      property_type: 'house',
    });
    propertyId = propertyRows[0].id;
    const unitRows = await adminFetch('/rest/v1/units', {
      org_id: orgId,
      property_id: propertyId,
      unit_label: 'U1',
      status: 'occupied',
    });
    const tenantRows = await adminFetch('/rest/v1/tenants', { org_id: orgId, full_name: 'Proof Tenant' });
    const leaseRows = await adminFetch('/rest/v1/leases', {
      org_id: orgId,
      unit_id: unitRows[0].id,
      start_date: '2026-01-01',
      rent_amount: 1000,
      status: 'active',
      source: 'manual',
    });
    await adminFetch('/rest/v1/lease_tenants', {
      lease_id: leaseRows[0].id,
      tenant_id: tenantRows[0].id,
      is_primary: true,
    });

    // A real, issued invoice + payment via the actual RPCs (never a raw insert -- proves the
    // fixture itself is a genuine payment, not a fabricated row).
    const setupEmail = `proof-setup-${suffix}@test.propertyvault.example`;
    const setupCreated = await adminFetch('/auth/v1/admin/users', {
      email: setupEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    userIds.push(setupCreated.id);
    await adminFetch('/rest/v1/organization_members', {
      org_id: orgId,
      user_id: setupCreated.id,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    const setupToken = await signIn(setupEmail, TEST_PASSWORD);
    mockAuthorizationHeader = `Bearer ${setupToken}`;

    async function makePaidInvoice(reference: string) {
      const invoiceRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_manual_invoice`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, Authorization: mockAuthorizationHeader!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_org_id: orgId,
          p_lease_id: leaseRows[0].id,
          p_tenant_id: tenantRows[0].id,
          p_invoice_date: '2026-08-01',
          p_due_date: '2026-08-08',
          p_reference: reference,
          p_description: reference,
          p_notes: null,
          p_line_items: [{ description: 'Proof test', quantity: 1, unitPrice: 500 }],
        }),
      });
      const invoiceId = await invoiceRes.json();
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/issue_manual_invoice`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, Authorization: mockAuthorizationHeader!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_invoice_id: invoiceId }),
      });
      const paymentRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_invoice_payment`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, Authorization: mockAuthorizationHeader!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_invoice_id: invoiceId,
          p_amount: 500,
          p_paid_at: '2026-08-02',
          p_method: 'eft',
          p_reference: reference,
          p_notes: null,
        }),
      });
      return paymentRes.json();
    }

    invoicePaymentId = await makePaidInvoice('PROOF-REF-1');
    reversiblePaymentId = await makePaidInvoice('PROOF-REF-2');

    // Org B's own payment, for the cross-org refusal test.
    const propertyBRows = await adminFetch('/rest/v1/properties', {
      org_id: orgBId,
      nickname: 'Org B Property',
      address_line1: '2 Other St',
      city: 'Durban',
      country: 'ZA',
      property_type: 'house',
    });
    const unitBRows = await adminFetch('/rest/v1/units', {
      org_id: orgBId,
      property_id: propertyBRows[0].id,
      unit_label: 'B1',
      status: 'occupied',
    });
    const tenantBRows = await adminFetch('/rest/v1/tenants', { org_id: orgBId, full_name: 'Org B Tenant' });
    const leaseBRows = await adminFetch('/rest/v1/leases', {
      org_id: orgBId,
      unit_id: unitBRows[0].id,
      start_date: '2026-01-01',
      rent_amount: 1000,
      status: 'active',
      source: 'manual',
    });
    const invoiceBRows = await adminFetch('/rest/v1/invoices', {
      org_id: orgBId,
      lease_id: leaseBRows[0].id,
      tenant_id: tenantBRows[0].id,
      period: '2026-08-01',
      amount: 500,
      status: 'issued',
      issued_at: new Date().toISOString(),
      source: 'manual',
      description: 'Org B invoice',
      invoice_number: `INV-ORGB-${suffix}`,
    });
    const paymentBRows = await adminFetch('/rest/v1/invoice_payments', {
      org_id: orgBId,
      tenant_id: tenantBRows[0].id,
      invoice_id: invoiceBRows[0].id,
      amount: 500,
      paid_at: '2026-08-02',
      method: 'eft',
      reference: 'ORGB-PROOF',
    });
    orgBInvoicePaymentId = paymentBRows[0].id;

    mockAuthorizationHeader = null;
  });

  afterEach(async () => {
    for (const id of userIds) {
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        });
      } catch {
        // best-effort local cleanup
      }
    }
    await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgBId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    userIds.length = 0;
  });

  async function createRoleUser(role: string): Promise<string> {
    const email = `proof-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.propertyvault.example`;
    const created = await adminFetch('/auth/v1/admin/users', { email, password: TEST_PASSWORD, email_confirm: true });
    userIds.push(created.id);
    await adminFetch('/rest/v1/organization_members', {
      org_id: orgId,
      user_id: created.id,
      role,
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    return signIn(email, TEST_PASSWORD);
  }

  it('an accountant can attach synthetic proof of payment, and the document row carries the correct invoice_payment_id', async () => {
    const token = await createRoleUser('accountant');
    mockAuthorizationHeader = `Bearer ${token}`;

    const response = await POST(
      uploadRequest({
        orgId,
        propertyId,
        categoryId,
        documentType: 'proof_of_payment',
        invoicePaymentId,
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.document.id).toBeTruthy();

    const rows = await adminGet(`/rest/v1/documents?id=eq.${body.document.id}&select=invoice_payment_id,storage_path`);
    expect(rows[0].invoice_payment_id).toBe(invoicePaymentId);
    // A storage path is required (the file has to live somewhere) but must be an internal bucket
    // path, never a raw externally-resolvable URL persisted on the row.
    expect(rows[0].storage_path).not.toMatch(/^https?:\/\//);
  });

  it('a manager can attach proof of payment', async () => {
    const token = await createRoleUser('manager');
    mockAuthorizationHeader = `Bearer ${token}`;
    const response = await POST(
      uploadRequest({ orgId, propertyId, categoryId, documentType: 'proof_of_payment', invoicePaymentId }),
    );
    expect(response.status).toBe(201);
  });

  it('a principal can attach proof of payment', async () => {
    const token = await createRoleUser('principal');
    mockAuthorizationHeader = `Bearer ${token}`;
    const response = await POST(
      uploadRequest({ orgId, propertyId, categoryId, documentType: 'proof_of_payment', invoicePaymentId }),
    );
    expect(response.status).toBe(201);
  });

  it('an agent cannot attach proof of payment', async () => {
    const token = await createRoleUser('agent');
    mockAuthorizationHeader = `Bearer ${token}`;
    const response = await POST(
      uploadRequest({ orgId, propertyId, categoryId, documentType: 'proof_of_payment', invoicePaymentId }),
    );
    expect(response.status).toBe(403);
    const rows = await adminGet(`/rest/v1/documents?invoice_payment_id=eq.${invoicePaymentId}&select=id`);
    expect(rows).toHaveLength(0);
  });

  it('a viewer cannot attach proof of payment', async () => {
    const token = await createRoleUser('viewer');
    mockAuthorizationHeader = `Bearer ${token}`;
    const response = await POST(
      uploadRequest({ orgId, propertyId, categoryId, documentType: 'proof_of_payment', invoicePaymentId }),
    );
    expect(response.status).toBe(403);
  });

  it("refuses a cross-org invoice_payment_id -- an org A accountant cannot attach a document to org B's payment", async () => {
    const token = await createRoleUser('accountant');
    mockAuthorizationHeader = `Bearer ${token}`;
    const response = await POST(
      uploadRequest({
        orgId,
        propertyId,
        categoryId,
        documentType: 'proof_of_payment',
        invoicePaymentId: orgBInvoicePaymentId,
      }),
    );
    expect(response.status).toBe(403);
    const rows = await adminGet(`/rest/v1/documents?invoice_payment_id=eq.${orgBInvoicePaymentId}&select=id`);
    expect(rows).toHaveLength(0);
  });

  it('refuses a nonexistent invoice_payment_id', async () => {
    const token = await createRoleUser('accountant');
    mockAuthorizationHeader = `Bearer ${token}`;
    const response = await POST(
      uploadRequest({
        orgId,
        propertyId,
        categoryId,
        documentType: 'proof_of_payment',
        invoicePaymentId: '00000000-0000-0000-0000-000000000000',
      }),
    );
    expect(response.status).toBe(403);
  });

  it('proof remains associated after the payment is reversed, and reversal never deletes the document', async () => {
    const token = await createRoleUser('accountant');
    mockAuthorizationHeader = `Bearer ${token}`;

    const uploadResponse = await POST(
      uploadRequest({
        orgId,
        propertyId,
        categoryId,
        documentType: 'proof_of_payment',
        invoicePaymentId: reversiblePaymentId,
      }),
    );
    expect(uploadResponse.status).toBe(201);
    const uploaded = await uploadResponse.json();
    const documentId = uploaded.document.id;

    const reverseRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reverse_invoice_payment`, {
      method: 'POST',
      headers: { apikey: ANON_KEY!, Authorization: mockAuthorizationHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_payment_id: reversiblePaymentId, p_reason: 'Testing proof survives reversal' }),
    });
    expect(reverseRes.status).toBe(204);

    const rows = await adminGet(`/rest/v1/documents?id=eq.${documentId}&select=id,invoice_payment_id,deleted_at`);
    expect(rows).toHaveLength(1);
    expect(rows[0].invoice_payment_id).toBe(reversiblePaymentId);
    expect(rows[0].deleted_at).toBeNull();
  });

  it('an authorised user can revisit the document via GET and see its metadata', async () => {
    const token = await createRoleUser('accountant');
    mockAuthorizationHeader = `Bearer ${token}`;

    const uploadResponse = await POST(
      uploadRequest({ orgId, propertyId, categoryId, documentType: 'proof_of_payment', invoicePaymentId }),
    );
    const uploaded = await uploadResponse.json();

    const listRequest = new NextRequest(
      `http://localhost/api/v1/documents?filter[property_id]=${propertyId}`,
    );
    const listResponse = await GET(listRequest);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    const found = listBody.documents.find((d: { id: string }) => d.id === uploaded.document.id);
    expect(found).toBeTruthy();
    expect(found.originalFileName).toBe('synthetic-proof.pdf');
  });
});
