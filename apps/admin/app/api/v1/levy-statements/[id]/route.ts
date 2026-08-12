import { NextResponse, type NextRequest } from 'next/server';
import { levyStatementUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapLevyStatementLineItemRow, mapLevyStatementRow } from '@/lib/compliance';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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

  const { data: statement, error } = await supabase
    .from('levy_statements')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'levy_statement_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!statement) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Levy statement not found.' } },
      { status: 404 },
    );
  }

  const { data: lineItems, error: lineItemsError } = await supabase
    .from('levy_statement_line_items')
    .select('*')
    .eq('statement_id', id)
    .order('sort_order', { ascending: true });
  if (lineItemsError) {
    return NextResponse.json(
      { error: { code: 'line_items_fetch_failed', message: lineItemsError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    statement: mapLevyStatementRow(statement),
    lineItems: (lineItems ?? []).map(mapLevyStatementLineItemRow),
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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

  const { data: statement } = await supabase
    .from('levy_statements')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!statement) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Levy statement not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, statement.org_id, 'agent'))) {
    return NextResponse.json(
      {
        error: { code: 'forbidden', message: 'You do not have permission to edit this statement.' },
      },
      { status: 403 },
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
  const parsed = levyStatementUpdateSchema.safeParse(body);
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

  const update: Record<string, unknown> = {};
  const fieldMap: Record<string, string> = {
    statementDate: 'statement_date',
    periodStart: 'period_start',
    periodEnd: 'period_end',
    openingBalance: 'opening_balance',
    closingBalance: 'closing_balance',
    paymentDueDate: 'payment_due_date',
    paymentReference: 'payment_reference',
  };
  for (const [key, column] of Object.entries(fieldMap)) {
    const value = (parsed.data as Record<string, unknown>)[key];
    if (value !== undefined) update[column] = value;
  }

  const { data: updated, error } = await supabase
    .from('levy_statements')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'levy_statement_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ statement: mapLevyStatementRow(updated) });
}
