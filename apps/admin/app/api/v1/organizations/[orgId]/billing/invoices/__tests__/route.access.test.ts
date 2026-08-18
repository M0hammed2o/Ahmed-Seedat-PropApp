import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// V1 billing invoice pass (WORKLOG.md this date), Phase 9 (invoice RLS/security). pgTAP already
// proves subscription_invoices' table-level RLS in isolation
// (supabase/tests/subscription_invoices.test.sql); this proves the REAL routes a browser actually
// calls -- GET .../billing/invoices and GET .../billing/invoices/:id/pdf -- end-to-end, using each
// caller's own session-bound client throughout, exactly as production does. Same pattern as
// app/api/v1/documents/[id]/__tests__/route.compliance-access.test.ts.

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

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { GET: listInvoices } = await import('../route');
const { GET: getInvoicePdf } = await import('../[invoiceId]/pdf/route');

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

async function adminRpc(fn: string, args: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return res.json();
}

async function adminDelete(path: string) {
  await fetch(`${SUPABASE_URL}${path}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
}

async function signIn(email: string): Promise<string> {
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassw0rd!23' }),
  });
  const body = await tokenRes.json();
  return body.access_token;
}

function invoicesRequest(): NextRequest {
  return new NextRequest('http://localhost/api/v1/organizations/x/billing/invoices', {
    headers: mockAuthorizationHeader ? { Authorization: mockAuthorizationHeader } : {},
  });
}

describeIfSupabase(
  'GET .../billing/invoices and .../billing/invoices/:id/pdf -- cross-org access (real local Supabase integration)',
  () => {
    let orgAId: string;
    let orgBId: string;
    let userAId: string;
    let userBId: string;
    let planId: string;
    let invoiceAId: string;
    let invoiceNumberA: string;

    beforeEach(async () => {
      const stamp = Date.now();
      const emailA = `invoice-access-a-${stamp}@propertyvault.example`;
      const emailB = `invoice-access-b-${stamp}@propertyvault.example`;
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

      const [orgA] = await adminFetch('/rest/v1/organizations', {
        legal_name: `Invoice Access Org A ${stamp}`,
        org_type: 'agency',
        status: 'trial',
      });
      orgAId = orgA.id;
      const [orgB] = await adminFetch('/rest/v1/organizations', {
        legal_name: `Invoice Access Org B ${stamp}`,
        org_type: 'agency',
        status: 'trial',
      });
      orgBId = orgB.id;

      await adminFetch('/rest/v1/organization_members', {
        org_id: orgAId,
        user_id: userAId,
        role: 'principal',
        status: 'active',
        joined_at: new Date().toISOString(),
      });
      await adminFetch('/rest/v1/organization_members', {
        org_id: orgBId,
        user_id: userBId,
        role: 'principal',
        status: 'active',
        joined_at: new Date().toISOString(),
      });

      const [plan] = await adminFetch('/rest/v1/plans', {
        code: `invoice-access-plan-${stamp}`,
        name: 'Invoice Access Plan',
        billing_cycle: 'monthly',
        base_price: 299,
        currency: 'ZAR',
      });
      planId = plan.id;

      const [sub] = await adminFetch('/rest/v1/organization_subscriptions', {
        org_id: orgAId,
        plan_id: planId,
        billing_cycle: 'monthly',
        current_period_start: new Date().toISOString().slice(0, 10),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        status: 'active',
      });

      const [payment] = await adminFetch('/rest/v1/subscription_payments', {
        org_id: orgAId,
        subscription_id: sub.id,
        amount: 299.0,
        currency: 'ZAR',
        status: 'paid',
        paid_at: new Date().toISOString(),
      });

      const invoice = await adminRpc('create_subscription_invoice_for_payment', {
        p_payment_id: payment.id,
      });
      invoiceAId = invoice.id;
      invoiceNumberA = invoice.invoice_number;
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await adminDelete(`/rest/v1/subscription_invoices?org_id=eq.${orgAId}`);
      await adminDelete(`/rest/v1/subscription_payments?org_id=eq.${orgAId}`);
      await adminDelete(`/rest/v1/organization_subscriptions?org_id=eq.${orgAId}`);
      await adminDelete(`/rest/v1/organization_members?org_id=eq.${orgAId}`);
      await adminDelete(`/rest/v1/organization_members?org_id=eq.${orgBId}`);
      await adminDelete(`/rest/v1/organizations?id=eq.${orgAId}`);
      await adminDelete(`/rest/v1/organizations?id=eq.${orgBId}`);
      await adminDelete(`/rest/v1/plans?id=eq.${planId}`);
      await adminDelete(`/auth/v1/admin/users/${userAId}`);
      await adminDelete(`/auth/v1/admin/users/${userBId}`);
    });

    it("Org A's own principal can list Org A's invoices", async () => {
      const emailRow = await adminGet(`/auth/v1/admin/users/${userAId}`);
      mockAuthorizationHeader = `Bearer ${await signIn(emailRow.email)}`;

      const response = await listInvoices(invoicesRequest(), {
        params: Promise.resolve({ orgId: orgAId }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.invoices).toHaveLength(1);
      expect(body.invoices[0].invoiceNumber).toBe(invoiceNumberA);
    });

    it("Org B's principal is forbidden from listing Org A's invoices, even by requesting Org A's own orgId", async () => {
      const emailRow = await adminGet(`/auth/v1/admin/users/${userBId}`);
      mockAuthorizationHeader = `Bearer ${await signIn(emailRow.email)}`;

      const response = await listInvoices(invoicesRequest(), {
        params: Promise.resolve({ orgId: orgAId }),
      });
      expect(response.status).toBe(403);
    });

    it('an unauthenticated caller cannot list any org invoices', async () => {
      mockAuthorizationHeader = null;
      const response = await listInvoices(invoicesRequest(), {
        params: Promise.resolve({ orgId: orgAId }),
      });
      expect(response.status).toBe(401);
    });

    it("Org A's own principal can download their own invoice PDF", async () => {
      const emailRow = await adminGet(`/auth/v1/admin/users/${userAId}`);
      mockAuthorizationHeader = `Bearer ${await signIn(emailRow.email)}`;

      const response = await getInvoicePdf(invoicesRequest(), {
        params: Promise.resolve({ orgId: orgAId, invoiceId: invoiceAId }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      const buf = Buffer.from(await response.arrayBuffer());
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it("Org B's principal cannot download Org A's invoice PDF via Org A's own orgId in the path", async () => {
      const emailRow = await adminGet(`/auth/v1/admin/users/${userBId}`);
      mockAuthorizationHeader = `Bearer ${await signIn(emailRow.email)}`;

      const response = await getInvoicePdf(invoicesRequest(), {
        params: Promise.resolve({ orgId: orgAId, invoiceId: invoiceAId }),
      });
      expect(response.status).toBe(403);
    });
  },
);
