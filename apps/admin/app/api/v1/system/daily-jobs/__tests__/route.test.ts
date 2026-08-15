import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Real integration test against local Supabase (same next/headers-mocking pattern as
// tenant-portal/switch-tenancy's own route test) -- the route handler itself, invoked directly
// with a constructed NextRequest, so the route's own dual-auth and orchestration actually run
// against real data. Covers auth (valid/no/bad token, ordinary user) and end-to-end idempotency
// across a real duplicate invocation. Order/partial-failure behavior is covered separately in
// route.orchestration.test.ts with lib/systemJobs mocked, since asserting call order against real
// async DB calls would be flaky.

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

process.env.CRON_JOB_SECRET = 'route-test-cron-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { POST } = await import('../route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROUTE_URL = 'http://localhost/api/v1/system/daily-jobs';

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

// The route reads the CRON_JOB_SECRET bearer token directly off the incoming NextRequest's own
// headers (`request.headers.get('authorization')`), NOT via next/headers -- that mock (above)
// only feeds getServerSupabaseClient()'s SESSION-based path (cookie or bearer-JWT-as-session,
// mirrored from tenant-portal/switch-tenancy's own test). `authHeader` sets the real request
// header for the CRON_JOB_SECRET tests; `mockAuthorizationHeader` (module-level, set separately)
// covers the session-based tests.
function postRequest(authHeader?: string): NextRequest {
  return new NextRequest(ROUTE_URL, {
    method: 'POST',
    headers: authHeader ? { Authorization: authHeader } : undefined,
  });
}

describeIfSupabase('POST /api/v1/system/daily-jobs (real local Supabase integration)', () => {
  afterEach(() => {
    mockAuthorizationHeader = null;
  });

  it('rejects an unauthenticated caller (no token at all) with 403', async () => {
    mockAuthorizationHeader = null;
    const response = await POST(postRequest());
    expect(response.status).toBe(403);
  });

  it('rejects an incorrect bearer token with 403', async () => {
    mockAuthorizationHeader = null;
    const response = await POST(postRequest('Bearer this-is-not-the-real-secret'));
    expect(response.status).toBe(403);
  });

  it('rejects an ordinary authenticated user (real session, not a platform admin) with 403', async () => {
    const email = `daily-jobs-ordinary-user-${Date.now()}@propertyvault.example`;
    const password = 'TestPassw0rd!23';
    const created = await adminFetch('/auth/v1/admin/users', {
      email,
      password,
      email_confirm: true,
    });
    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const tokenBody = await tokenRes.json();
    mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

    const response = await POST(postRequest());
    expect(response.status).toBe(403);

    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${created.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  });

  it('accepts a valid CRON_JOB_SECRET bearer token and returns a structured result for every job', async () => {
    const response = await POST(postRequest(`Bearer ${process.env.CRON_JOB_SECRET}`));
    const body = await response.json();
    expect([200, 500]).toContain(response.status); // 500 only if a real, pre-existing data issue trips a job -- still must be structured
    expect(body).toHaveProperty('success');
    expect(body.jobs).toHaveProperty('subscriptions');
    expect(body.jobs).toHaveProperty('rentSchedules');
    expect(body.jobs).toHaveProperty('compliance');
  });

  describe('idempotency across a real duplicate invocation', () => {
    let orgId: string;
    let propertyId: string;
    let unitId: string;
    let leaseId: string;
    let tenantId: string;
    let ruleVersionId: string;
    let requirementId: string;
    let staffUserId: string;

    beforeEach(async () => {
      const staffUser = await adminFetch('/auth/v1/admin/users', {
        email: `daily-jobs-staff-${Date.now()}@propertyvault.example`,
        password: 'TestPassw0rd!23',
        email_confirm: true,
      });
      staffUserId = staffUser.id;

      const orgRows = await adminFetch('/rest/v1/organizations', {
        legal_name: `Daily Jobs Idempotency Org ${Date.now()}`,
        org_type: 'agency',
        status: 'active',
      });
      orgId = orgRows[0].id;

      const propertyRows = await adminFetch('/rest/v1/properties', {
        org_id: orgId,
        nickname: 'Daily Jobs Test Property',
        address_line1: '1 Test St',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'apartment',
        status: 'active',
      });
      propertyId = propertyRows[0].id;

      const unitRows = await adminFetch('/rest/v1/units', {
        property_id: propertyId,
        org_id: orgId,
        unit_label: 'Unit 1',
        status: 'occupied',
      });
      unitId = unitRows[0].id;

      // A real active lease -- generate_rent_schedules_for_active_leases() should create rows for
      // this on the FIRST run, and zero additional rows on the SECOND (unique(lease_id, due_date)
      // + on conflict do nothing).
      const leaseRows = await adminFetch('/rest/v1/leases', {
        org_id: orgId,
        unit_id: unitId,
        start_date: new Date().toISOString().slice(0, 10),
        rent_amount: 5000,
        status: 'active',
        source: 'manual',
      });
      leaseId = leaseRows[0].id;

      const tenantRows = await adminFetch('/rest/v1/tenants', {
        org_id: orgId,
        full_name: 'Daily Jobs Test Tenant',
        email: `daily-jobs-tenant-${Date.now()}@propertyvault.example`,
        status: 'active',
      });
      tenantId = tenantRows[0].id;

      // A compliance requirement due soon -- compliance_requirements_due_soon() should return it
      // on the FIRST run (and dispatch/stamp it), then exclude it on the SECOND (due_reminder_sent_at
      // is no longer null).
      const ruleRows = await adminFetch('/rest/v1/property_rules', {
        org_id: orgId,
        property_id: propertyId,
        category: 'house_rules',
        title: 'Daily Jobs Test Rule',
        created_by: staffUserId,
      });
      const ruleId = ruleRows[0].id;

      const catRows = await fetch(`${SUPABASE_URL}/rest/v1/document_categories?select=id&limit=1`, {
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      }).then((r) => r.json());
      const docRows = await adminFetch('/rest/v1/documents', {
        owner_user_id: staffUserId,
        org_id: orgId,
        property_id: propertyId,
        category_id: catRows[0].id,
        document_type: 'other',
        storage_path: `${orgId}/daily-jobs-test-rule.pdf`,
        original_file_name: 'rule.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 10,
        checksum_sha256: `daily-jobs-${Date.now()}`,
      });
      const documentId = docRows[0].id;

      const ruleVersionRows = await adminFetch('/rest/v1/property_rule_versions', {
        rule_id: ruleId,
        org_id: orgId,
        document_id: documentId,
        version_number: 1,
        status: 'active',
        effective_date: new Date().toISOString().slice(0, 10),
        acknowledgement_required: true,
        created_by: staffUserId,
      });
      ruleVersionId = ruleVersionRows[0].id;

      const requirementRows = await adminFetch('/rest/v1/compliance_requirements', {
        org_id: orgId,
        property_id: propertyId,
        rule_version_id: ruleVersionId,
        tenant_id: tenantId,
        status: 'pending',
        due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
      });
      requirementId = requirementRows[0].id;
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await fetch(`${SUPABASE_URL}/rest/v1/compliance_requirements?id=eq.${requirementId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/property_rule_versions?id=eq.${ruleVersionId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/property_rules?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/documents?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/rent_schedules?lease_id=eq.${leaseId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/leases?id=eq.${leaseId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/units?id=eq.${unitId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/properties?id=eq.${propertyId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${staffUserId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
    });

    it('a second, duplicate run creates zero additional rent schedule rows and sends zero duplicate compliance reminders', async () => {
      const cronAuthHeader = `Bearer ${process.env.CRON_JOB_SECRET}`;
      const first = await POST(postRequest(cronAuthHeader));
      const firstBody = await first.json();
      expect(firstBody.jobs.rentSchedules.result.totalCreated).toBeGreaterThan(0);
      expect(firstBody.jobs.compliance.result.dueSoonRemindersSent).toBeGreaterThanOrEqual(1);

      const second = await POST(postRequest(cronAuthHeader));
      const secondBody = await second.json();
      expect(secondBody.jobs.rentSchedules.result.totalCreated).toBe(0);
      expect(secondBody.jobs.compliance.result.dueSoonRemindersSent).toBe(0);
    });
  });
});
