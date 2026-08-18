import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Final pre-UAT engineering pass (WORKLOG.md this date), Part 6/7/9: proves the REAL AI assistant
// routes end-to-end against a real local Supabase instance -- not mocked -- for both an org
// staff member and a tenant, and proves the write-staging path (POST .../messages/:id/confirm)
// is genuinely disabled for V1 regardless of caller. Same pattern as
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

const { POST: createConversation } = await import('../conversations/route');
const { POST: postMessage } = await import('../conversations/[id]/messages/route');
const { POST: confirmMessage } = await import('../messages/[id]/confirm/route');

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

async function signIn(email: string): Promise<string> {
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassw0rd!23' }),
  });
  const body = await tokenRes.json();
  return body.access_token;
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(mockAuthorizationHeader ? { Authorization: mockAuthorizationHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

describeIfSupabase('AI Assistant routes (real local Supabase integration)', () => {
  let orgId: string;
  let staffUserId: string;
  let tenantUserId: string;
  let outsiderUserId: string;

  beforeEach(async () => {
    const stamp = Date.now();
    const password = 'TestPassw0rd!23';

    const staff = await adminFetch('/auth/v1/admin/users', {
      email: `assistant-staff-${stamp}@propertyvault.example`,
      password,
      email_confirm: true,
    });
    staffUserId = staff.id;
    const tenant = await adminFetch('/auth/v1/admin/users', {
      email: `assistant-tenant-${stamp}@propertyvault.example`,
      password,
      email_confirm: true,
    });
    tenantUserId = tenant.id;
    const outsider = await adminFetch('/auth/v1/admin/users', {
      email: `assistant-outsider-${stamp}@propertyvault.example`,
      password,
      email_confirm: true,
    });
    outsiderUserId = outsider.id;

    const [org] = await adminFetch('/rest/v1/organizations', {
      legal_name: `Assistant Test Org ${stamp}`,
      org_type: 'agency',
      status: 'active',
    });
    orgId = org.id;

    await adminFetch('/rest/v1/organization_members', {
      org_id: orgId,
      user_id: staffUserId,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    const [property] = await adminFetch('/rest/v1/properties', {
      org_id: orgId,
      nickname: 'Assistant Test Property',
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
    const [tenantRow] = await adminFetch('/rest/v1/tenants', {
      org_id: orgId,
      user_id: tenantUserId,
      full_name: 'Assistant Test Tenant',
      status: 'active',
    });
    const [lease] = await adminFetch('/rest/v1/leases', {
      org_id: orgId,
      unit_id: unit.id,
      start_date: '2026-01-01',
      rent_amount: 5000,
      status: 'active',
      source: 'manual',
    });
    await adminFetch('/rest/v1/lease_tenants', {
      lease_id: lease.id,
      tenant_id: tenantRow.id,
      is_primary: true,
    });
    // A genuine overdue rent_schedules row -- so the owner-side reply is grounded in a real row,
    // not an empty-context "nothing overdue" answer that would prove nothing.
    await adminFetch('/rest/v1/rent_schedules', {
      org_id: orgId,
      lease_id: lease.id,
      due_date: '2026-01-01',
      amount: 5000,
      status: 'overdue',
    });
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    // ai_messages.conversation_id cascades on delete -- deleting ai_conversations is sufficient.
    await adminDelete(`/rest/v1/ai_conversations?org_id=eq.${orgId}`);
    await adminDelete(`/rest/v1/rent_schedules?org_id=eq.${orgId}`);
    // lease_tenants has no org_id of its own -- deleting leases (next line) cascades to it.
    await adminDelete(`/rest/v1/leases?org_id=eq.${orgId}`);
    await adminDelete(`/rest/v1/tenants?org_id=eq.${orgId}`);
    await adminDelete(`/rest/v1/units?org_id=eq.${orgId}`);
    await adminDelete(`/rest/v1/properties?org_id=eq.${orgId}`);
    await adminDelete(`/rest/v1/organization_members?org_id=eq.${orgId}`);
    await adminDelete(`/rest/v1/organizations?id=eq.${orgId}`);
    await adminDelete(`/auth/v1/admin/users/${staffUserId}`);
    await adminDelete(`/auth/v1/admin/users/${tenantUserId}`);
    await adminDelete(`/auth/v1/admin/users/${outsiderUserId}`);
  });

  // Per-test timeouts bumped from the 5000ms default (final pre-UAT engineering pass, WORKLOG.md
  // this date): each of these makes several real sequential network round trips against local
  // Supabase Auth (sign-in) + PostgREST + this session's own long-lived, heavily-loaded local dev
  // database -- observed to occasionally exceed 5s under load without indicating any real
  // regression (the assistant routes themselves have no unbounded work -- context assembly is a
  // handful of LIMIT-10 queries, same as the rest of this codebase).
  it(
    'an org staff member gets a real, grounded reply about overdue rent -- never a stagedChange',
    async () => {
      const staffEmail = (await adminGet(`/auth/v1/admin/users/${staffUserId}`)).email;
      mockAuthorizationHeader = `Bearer ${await signIn(staffEmail)}`;

      const convResponse = await createConversation(
        jsonRequest('http://localhost/api/v1/ai/conversations', { orgId }),
      );
      expect(convResponse.status).toBe(201);
      const convBody = await convResponse.json();

      const msgResponse = await postMessage(
        jsonRequest(
          `http://localhost/api/v1/ai/conversations/${convBody.conversation.id}/messages`,
          { text: "What's overdue?" },
        ),
        { params: Promise.resolve({ id: convBody.conversation.id }) },
      );
      expect(msgResponse.status).toBe(201);
      const msgBody = await msgResponse.json();
      expect(msgBody.message.content).toMatch(/1 lease is overdue/i);
      expect(msgBody.message.content).toContain('R5');
      expect(msgBody.message.stagedChanges).toBeNull();
    },
    20000,
  );

  it(
    'a tenant gets a grounded reply about their own outstanding balance via the SAME endpoint',
    async () => {
      const tenantEmail = (await adminGet(`/auth/v1/admin/users/${tenantUserId}`)).email;
      mockAuthorizationHeader = `Bearer ${await signIn(tenantEmail)}`;

      const convResponse = await createConversation(
        jsonRequest('http://localhost/api/v1/ai/conversations', { orgId }),
      );
      expect(convResponse.status).toBe(201);
      const convBody = await convResponse.json();

      const msgResponse = await postMessage(
        jsonRequest(
          `http://localhost/api/v1/ai/conversations/${convBody.conversation.id}/messages`,
          { text: 'How much do I owe?' },
        ),
        { params: Promise.resolve({ id: convBody.conversation.id }) },
      );
      expect(msgResponse.status).toBe(201);
      const msgBody = await msgResponse.json();
      expect(msgBody.message.content).toContain('R5');
      expect(msgBody.message.stagedChanges).toBeNull();
    },
    20000,
  );

  it(
    'an outsider with no org membership and no tenancy cannot start a conversation for this org',
    async () => {
      const outsiderEmail = (await adminGet(`/auth/v1/admin/users/${outsiderUserId}`)).email;
      mockAuthorizationHeader = `Bearer ${await signIn(outsiderEmail)}`;

      const response = await createConversation(
        jsonRequest('http://localhost/api/v1/ai/conversations', { orgId }),
      );
      expect(response.status).toBe(403);
    },
    20000,
  );

  it(
    'POST .../messages/:id/confirm always refuses -- V1 write-staging is disabled regardless of caller',
    async () => {
      const staffEmail = (await adminGet(`/auth/v1/admin/users/${staffUserId}`)).email;
      mockAuthorizationHeader = `Bearer ${await signIn(staffEmail)}`;

      const response = await confirmMessage(
        jsonRequest(
          'http://localhost/api/v1/ai/messages/00000000-0000-0000-0000-000000000000/confirm',
          {},
        ),
        { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) },
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe('ai_writes_disabled');
    },
    20000,
  );
});
