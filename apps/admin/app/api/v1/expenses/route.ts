import { NextResponse, type NextRequest } from 'next/server';
import { expenseCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapExpenseRow } from '@/lib/accounting';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';
import { writeAuditEvent } from '@/lib/audit';

/**
 * GET/POST /api/v1/expenses (API_SPEC.md §6, TASKS.md M14). POST here only creates a 'pending'
 * row -- posting it (Dr Expense, Cr Accounts Payable/Bank) is the separate, explicit
 * POST /api/v1/expenses/:id/record action, matching ACCOUNTING.md §3's "An expenses row is marked
 * recorded" trigger wording. Accountant+ only throughout -- PERMISSIONS.md §2: expenses are an
 * Accounting-column action, agent has no accounting-post (or entry) rights.
 */
export async function GET(request: NextRequest) {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const { limit, cursor } = parseListQuery(request);
  const url = new URL(request.url);
  const orgIdFilter = url.searchParams.get('filter[org_id]');
  const statusFilter = url.searchParams.get('filter[status]');
  const propertyIdFilter = url.searchParams.get('filter[property_id]');

  let query = supabase
    .from('expenses')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (propertyIdFilter) query = query.eq('property_id', propertyIdFilter);
  if (cursor) query = query.or(beforeCursorFilter(cursor));

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'expenses_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const expenses = rows.map(mapExpenseRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  return NextResponse.json({ expenses, next_cursor: nextCursor });
}

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = expenseCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const canWrite = await requireOrgRole(supabase, parsed.data.orgId, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to record expenses for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      org_id: parsed.data.orgId,
      property_id: parsed.data.propertyId,
      vendor_id: parsed.data.vendorId ?? null,
      category: parsed.data.category,
      amount: parsed.data.amount,
      document_id: parsed.data.documentId ?? null,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'expense_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  // Governance requirement (WORKLOG.md this date): "who created this expense" must be
  // reconstructable from audit_events, not only from the row's own (unauditable) org membership
  // at query time. Best-effort, non-blocking — see lib/audit.ts's own doc comment.
  await writeAuditEvent(getServiceRoleClient(), {
    orgId: parsed.data.orgId,
    actorUserId: user.id,
    actorType: 'user',
    action: 'expense.create',
    entityType: 'expenses',
    entityId: data.id,
    after: {
      propertyId: data.property_id,
      vendorId: data.vendor_id,
      category: data.category,
      amount: data.amount,
      status: data.status,
    },
  });

  return NextResponse.json({ expense: mapExpenseRow(data) }, { status: 201 });
}
