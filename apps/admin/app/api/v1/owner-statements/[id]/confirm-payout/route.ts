import { NextResponse, type NextRequest } from 'next/server';
import { ownerStatementConfirmPayoutSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerStatementRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/owner-statements/:id/confirm-payout -- thin wrapper over
 * confirm_owner_statement_payout() (migration 20260101000052). Not part of API_SPEC.md §6's
 * literal route list -- added alongside /release and /accrue-interest for the same reason: the
 * "marked paid only when a payout is matched" action (ACCOUNTING.md §5 point 4) has to live
 * somewhere.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = ownerStatementConfirmPayoutSchema.safeParse(body);
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

  const { error: payoutError } = await supabase.rpc('confirm_owner_statement_payout', {
    p_owner_statement_id: id,
    p_bank_transaction_id: parsed.data.bankTransactionId,
  });
  if (payoutError) {
    return NextResponse.json(
      { error: { code: 'owner_statement_payout_failed', message: payoutError.message } },
      { status: 422 },
    );
  }

  const { data, error: fetchError } = await supabase.from('owner_statements').select('*').eq('id', id).single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'owner_statement_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ownerStatement: mapOwnerStatementRow(data) });
}
