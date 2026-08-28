import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// V1 launch-completion pass: posting-time evidence gate for expenses. record_expense() itself
// (migration 20260101000038) and the prior P0 pass's chart-of-accounts guard in
// post_journal_entry() (20260101000142) are both untouched -- this only proves the new pre-RPC
// check in POST /api/v1/expenses/:id/record/route.ts: (a) an expense with no linked document and
// no exceptionReason is rejected 400 before the RPC is ever called; (b) an expense with no
// document but a valid exceptionReason posts successfully and writes exactly one
// 'expense.posted_without_evidence' audit event; (c) an expense with a linked document posts
// successfully without needing a reason, and does NOT write that exception audit event (only the
// pre-existing 'expense.record' one).

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

function recordRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/v1/expenses/${id}/record`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describeIfSupabase('POST /api/v1/expenses/:id/record evidence gate (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let accountantId: string;
  let receiptCategoryId: string;

  beforeEach(async () => {
    mockCookieJar.clear();
    const email = `expense-record-evidence-${Date.now()}@propertyvault.example`;
    const password = 'TestPassw0rd!23';
    const created = await adminFetch('/auth/v1/admin/users', { email, password, email_confirm: true });
    accountantId = created.id;

    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const tokenBody = await tokenRes.json();
    mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Expense Evidence Gate Vitest Org ${Date.now()}`,
      org_type: 'agency',
    });
    orgId = orgRows[0].id;
    await adminFetch('/rest/v1/organization_members', {
      org_id: orgId,
      user_id: accountantId,
      role: 'accountant',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    // record_expense() needs a real chart of accounts -- orgs created via the sanctioned
    // create_organization() RPC get this automatically (20260101000035), but this REST-created
    // fixture org does not, so it's seeded directly here (mirrors 20260101000142's own backfill:
    // just the accounts the 'Other'-category/pending-not-paid-immediately posting path needs).
    await serviceClient.from('chart_of_accounts').insert([
      { org_id: orgId, code: '2000', name: 'Accounts Payable', account_type: 'liability', ledger_class: 'business', is_system: true },
      { org_id: orgId, code: '5900', name: 'Other Expense', account_type: 'expense', ledger_class: 'business', is_system: true },
    ]);

    const { data: property } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'Expense Evidence Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
      .select('id')
      .single();
    propertyId = property!.id;

    const { data: category } = await serviceClient
      .from('document_categories')
      .select('id')
      .eq('slug', 'receipt')
      .single();
    receiptCategoryId = category!.id;
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await serviceClient.from('audit_events').delete().eq('org_id', orgId);
    await serviceClient.from('expenses').delete().eq('org_id', orgId);
    await serviceClient.from('documents').delete().eq('org_id', orgId);
    await serviceClient.from('chart_of_accounts').delete().eq('org_id', orgId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(accountantId);
  });

  async function createExpense(documentId: string | null) {
    const { data } = await serviceClient
      .from('expenses')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        category: 'Other',
        amount: 500,
        status: 'pending',
        document_id: documentId,
      })
      .select('id')
      .single();
    return data!.id as string;
  }

  async function createDocument() {
    const { data } = await serviceClient
      .from('documents')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        category_id: receiptCategoryId,
        document_type: 'receipt',
        storage_path: `${orgId}/${propertyId}/${crypto.randomUUID()}.pdf`,
        original_file_name: 'evidence.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 1024,
        checksum_sha256: 'a'.repeat(64),
      })
      .select('id')
      .single();
    return data!.id as string;
  }

  it('rejects posting without evidence and without an exceptionReason', async () => {
    const expenseId = await createExpense(null);

    const response = await POST(recordRequest(expenseId, {}), { params: Promise.resolve({ id: expenseId }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('evidence_required');

    const { data: expense } = await serviceClient.from('expenses').select('status').eq('id', expenseId).single();
    expect(expense!.status).toBe('pending');
  });

  it('posts successfully without evidence when a valid exceptionReason is given, and writes the exception audit event', async () => {
    const expenseId = await createExpense(null);

    const response = await POST(
      recordRequest(expenseId, { exceptionReason: 'Verbal confirmation from vendor, invoice to follow later' }),
      { params: Promise.resolve({ id: expenseId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expense.status).toBe('recorded');

    const { count: exceptionAuditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', expenseId)
      .eq('action', 'expense.posted_without_evidence');
    expect(exceptionAuditCount).toBe(1);

    const { count: recordAuditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', expenseId)
      .eq('action', 'expense.record');
    expect(recordAuditCount).toBe(1);
  });

  it('posts successfully with evidence attached, without needing exceptionReason, and does not write the exception audit event', async () => {
    const documentId = await createDocument();
    const expenseId = await createExpense(documentId);

    const response = await POST(recordRequest(expenseId, {}), { params: Promise.resolve({ id: expenseId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expense.status).toBe('recorded');

    const { count: exceptionAuditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', expenseId)
      .eq('action', 'expense.posted_without_evidence');
    expect(exceptionAuditCount).toBe(0);

    const { count: recordAuditCount } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', expenseId)
      .eq('action', 'expense.record');
    expect(recordAuditCount).toBe(1);
  });
});
