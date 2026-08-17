import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// WhatsApp V1 final pre-production pass, Phase 7 (WORKLOG.md this date). End-to-end HTTP-route
// coverage for the full tenant -> staff -> tenant-status payment-reporting workflow, via
// MockWhatsAppProvider only (no WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID configured in this test
// environment -- deliveryConfigured is false, so the Phase K approval gate never applies here and
// dispatchWhatsApp genuinely calls the Mock provider and writes a real whatsapp_messages row).
// Same real-session HTTP-level pattern as tenant-portal/switch-tenancy's own route test -- these
// are the actual route handlers, invoked with constructed NextRequests carrying a real Supabase
// Auth access token, not a mocked-fetch component test.

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

const { POST: reportPayment } = await import('../../tenant-portal/payment-reports/route');
const { GET: listReports } = await import('../route');
const { POST: confirmReport } = await import('../[id]/confirm/route');
const { POST: rejectReport } = await import('../[id]/reject/route');

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

async function admin(path: string, method: string, body?: unknown) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return method === 'DELETE' ? null : res.json();
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

describeIfSupabase(
  'Payment-reporting workflow, real routes end-to-end (Mock WhatsApp provider only)',
  () => {
    const password = 'TestPassw0rd!23';
    let tenantUserId: string;
    let staffUserId: string;
    let tenantToken: string;
    let staffToken: string;
    let orgId: string;
    let propertyId: string;
    let leaseId: string;

    beforeEach(async () => {
      mockCookieJar.clear();
      const stamp = Date.now();

      const tenantEmail = `pr-workflow-tenant-${stamp}@propertyvault.example`;
      const staffEmail = `pr-workflow-staff-${stamp}@propertyvault.example`;

      const tenantAuth = await admin('/auth/v1/admin/users', 'POST', {
        email: tenantEmail,
        password,
        email_confirm: true,
      });
      tenantUserId = tenantAuth.id;
      const staffAuth = await admin('/auth/v1/admin/users', 'POST', {
        email: staffEmail,
        password,
        email_confirm: true,
      });
      staffUserId = staffAuth.id;

      tenantToken = await signIn(tenantEmail, password);
      staffToken = await signIn(staffEmail, password);

      const orgRows = await admin('/rest/v1/organizations', 'POST', {
        legal_name: `PR Workflow Vitest Org ${stamp}`,
        org_type: 'agency',
      });
      orgId = orgRows[0].id;

      await admin('/rest/v1/organization_members', 'POST', {
        org_id: orgId,
        user_id: staffUserId,
        role: 'manager',
        status: 'active',
        joined_at: new Date().toISOString(),
      });

      const propertyRows = await admin('/rest/v1/properties', 'POST', {
        org_id: orgId,
        owner_user_id: staffUserId,
        nickname: 'PR Workflow Property',
        address_line1: '1 Workflow St',
        city: 'Cape Town',
      });
      propertyId = propertyRows[0].id;

      const unitRows = await admin('/rest/v1/units', 'POST', {
        property_id: propertyId,
        org_id: orgId,
        unit_label: 'W1',
      });
      const unitId = unitRows[0].id;

      const leaseRows = await admin('/rest/v1/leases', 'POST', {
        org_id: orgId,
        unit_id: unitId,
        start_date: '2025-01-01',
        rent_amount: 5000,
        status: 'active',
      });
      leaseId = leaseRows[0].id;

      const tenantRows = await admin('/rest/v1/tenants', 'POST', {
        org_id: orgId,
        user_id: tenantUserId,
        full_name: 'PR Workflow Tenant',
        phone: '+27821234567',
        status: 'active',
      });
      const tenantId = tenantRows[0].id;

      await admin('/rest/v1/lease_tenants', 'POST', {
        lease_id: leaseId,
        tenant_id: tenantId,
        is_primary: true,
      });
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await admin(`/rest/v1/whatsapp_messages?org_id=eq.${orgId}`, 'DELETE');
      await admin(`/rest/v1/payment_reports?org_id=eq.${orgId}`, 'DELETE');
      await admin(`/rest/v1/lease_tenants?lease_id=eq.${leaseId}`, 'DELETE');
      await admin(`/rest/v1/leases?org_id=eq.${orgId}`, 'DELETE');
      await admin(`/rest/v1/units?org_id=eq.${orgId}`, 'DELETE');
      await admin(`/rest/v1/tenants?org_id=eq.${orgId}`, 'DELETE');
      await admin(`/rest/v1/properties?org_id=eq.${orgId}`, 'DELETE');
      await admin(`/rest/v1/organization_members?org_id=eq.${orgId}`, 'DELETE');
      await admin(`/rest/v1/organizations?id=eq.${orgId}`, 'DELETE');
      await admin(`/auth/v1/admin/users/${tenantUserId}`, 'DELETE');
      await admin(`/auth/v1/admin/users/${staffUserId}`, 'DELETE');
    });

    it('tenant reports a cash payment -> staff sees + confirms it -> tenant sees it confirmed -> tenant is notified via WhatsApp', async () => {
      mockAuthorizationHeader = `Bearer ${tenantToken}`;
      const form = new FormData();
      form.set('amount', '5000');
      form.set('paymentMethod', 'cash');
      form.set('paymentDate', '2026-03-15');
      const reportResponse = await reportPayment(
        new NextRequest('http://localhost/api/v1/tenant-portal/payment-reports', {
          method: 'POST',
          body: form,
        }),
      );
      expect(reportResponse.status).toBe(201);
      const reportBody = await reportResponse.json();
      const reportId = reportBody.paymentReport.id;
      expect(reportBody.paymentReport.status).toBe('reported');

      // Staff sees it in the review queue.
      mockAuthorizationHeader = `Bearer ${staffToken}`;
      const listResponse = await listReports(
        new NextRequest(`http://localhost/api/v1/payment-reports?filter[status]=reported`),
      );
      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json();
      expect(listBody.paymentReports.some((r: { id: string }) => r.id === reportId)).toBe(true);

      // Staff confirms it.
      const confirmResponse = await confirmReport(
        new NextRequest(`http://localhost/api/v1/payment-reports/${reportId}/confirm`, {
          method: 'POST',
        }),
        { params: Promise.resolve({ id: reportId }) },
      );
      expect(confirmResponse.status).toBe(200);

      // Tenant, re-querying their own report, now sees it confirmed.
      mockAuthorizationHeader = `Bearer ${tenantToken}`;
      const afterConfirm = await listReports(
        new NextRequest(`http://localhost/api/v1/payment-reports`),
      );
      const afterConfirmBody = await afterConfirm.json();
      const confirmedReport = afterConfirmBody.paymentReports.find(
        (r: { id: string }) => r.id === reportId,
      );
      expect(confirmedReport.status).toBe('confirmed');
      expect(confirmedReport.reviewedBy).toBe(staffUserId);

      // The tenant was genuinely notified -- a real whatsapp_messages row exists for this exact
      // report, via MockWhatsAppProvider (deliveryConfigured is false in this test environment).
      const messages = await admin(
        `/rest/v1/whatsapp_messages?related_entity_type=eq.payment_report&related_entity_id=eq.${reportId}&template_name=eq.payment_received_confirmation`,
        'GET',
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].to_number).toBe('+27821234567');
    });

    it('tenant reports a payment -> staff rejects it with a reason -> tenant sees the rejection reason -> no WhatsApp message is sent for the rejection', async () => {
      mockAuthorizationHeader = `Bearer ${tenantToken}`;
      const form = new FormData();
      form.set('amount', '5000');
      form.set('paymentMethod', 'cash');
      form.set('paymentDate', '2026-03-15');
      const reportResponse = await reportPayment(
        new NextRequest('http://localhost/api/v1/tenant-portal/payment-reports', {
          method: 'POST',
          body: form,
        }),
      );
      const reportBody = await reportResponse.json();
      const reportId = reportBody.paymentReport.id;

      mockAuthorizationHeader = `Bearer ${staffToken}`;
      const rejectResponse = await rejectReport(
        new NextRequest(`http://localhost/api/v1/payment-reports/${reportId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Amount does not match the lease rent.' }),
        }),
        { params: Promise.resolve({ id: reportId }) },
      );
      expect(rejectResponse.status).toBe(200);

      mockAuthorizationHeader = `Bearer ${tenantToken}`;
      const afterReject = await listReports(
        new NextRequest(`http://localhost/api/v1/payment-reports`),
      );
      const afterRejectBody = await afterReject.json();
      const rejectedReport = afterRejectBody.paymentReports.find(
        (r: { id: string }) => r.id === reportId,
      );
      expect(rejectedReport.status).toBe('rejected');
      expect(rejectedReport.rejectionReason).toBe('Amount does not match the lease rent.');

      const messages = await admin(
        `/rest/v1/whatsapp_messages?related_entity_type=eq.payment_report&related_entity_id=eq.${reportId}`,
        'GET',
      );
      expect(messages).toHaveLength(0);
    });

    it('rejecting without a reason is rejected with 400, and the report stays in "reported" status', async () => {
      mockAuthorizationHeader = `Bearer ${tenantToken}`;
      const form = new FormData();
      form.set('amount', '5000');
      form.set('paymentMethod', 'cash');
      form.set('paymentDate', '2026-03-15');
      const reportResponse = await reportPayment(
        new NextRequest('http://localhost/api/v1/tenant-portal/payment-reports', {
          method: 'POST',
          body: form,
        }),
      );
      const reportBody = await reportResponse.json();
      const reportId = reportBody.paymentReport.id;

      mockAuthorizationHeader = `Bearer ${staffToken}`;
      const rejectResponse = await rejectReport(
        new NextRequest(`http://localhost/api/v1/payment-reports/${reportId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: '' }),
        }),
        { params: Promise.resolve({ id: reportId }) },
      );
      expect(rejectResponse.status).toBe(400);

      const rows = await admin(`/rest/v1/payment_reports?id=eq.${reportId}`, 'GET');
      expect(rows[0].status).toBe('reported');
    });
  },
);
