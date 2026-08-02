import { NextResponse, type NextRequest } from 'next/server';
import { ownerStatementDraftSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerStatementRow } from '@/lib/accounting';

/**
 * POST /api/v1/owner-statements/draft (API_SPEC.md §6: "month-scoped batch draft, evidenced:
 * skips owners who already have one") -- thin wrapper over generate_owner_statements() (migration
 * 20260101000052). Returns every affected owner's resulting statement, including ones the RPC
 * skipped because they already had an issued/paid statement for the period.
 */
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

  const parsed = ownerStatementDraftSchema.safeParse(body);
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

  const { data: rows, error: rpcError } = await supabase.rpc('generate_owner_statements', {
    p_org_id: parsed.data.orgId,
    p_period_start: parsed.data.periodStart,
    p_period_end: parsed.data.periodEnd,
  });

  if (rpcError) {
    return NextResponse.json(
      { error: { code: 'owner_statement_draft_failed', message: rpcError.message } },
      { status: 422 },
    );
  }

  const statementIds = ((rows ?? []) as Array<{ owner_statement_id: string }>).map((r) => r.owner_statement_id);
  const { data: statements, error: fetchError } = await supabase
    .from('owner_statements')
    .select('*')
    .in('id', statementIds);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'owner_statements_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ownerStatements: (statements ?? []).map(mapOwnerStatementRow) }, { status: 201 });
}
