import { NextResponse, type NextRequest } from 'next/server';
import { trustDepositReleaseSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTrustLedgerRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/trust-ledgers/:id/release (API_SPEC.md §6, ACCOUNTING.md §4, TASKS.md M14 part 3)
 * -- thin wrapper over release_trust_deposit() (migration 20260101000051). `:id` is the
 * trust_ledgers row id (matches the collection route's own resource shape); the RPC itself takes
 * the lease id, so this route resolves lease_id from the trust ledger first. Rejects unless a
 * completed move-out inspection exists for the lease -- enforced inside the RPC, not re-checked
 * here.
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

  const parsed = trustDepositReleaseSchema.safeParse(body);
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

  const { data: ledger, error: ledgerError } = await supabase
    .from('trust_ledgers')
    .select('lease_id')
    .eq('id', id)
    .single();
  if (ledgerError || !ledger) {
    return NextResponse.json(
      {
        error: {
          code: 'trust_ledger_not_found',
          message: ledgerError?.message ?? 'Trust ledger not found.',
        },
      },
      { status: 404 },
    );
  }

  const { error: releaseError } = await supabase.rpc('release_trust_deposit', {
    p_lease_id: ledger.lease_id,
    p_deduction_amount: parsed.data.deductionAmount,
    p_refund_amount: parsed.data.refundAmount,
    p_deduction_memo: parsed.data.deductionMemo ?? null,
  });

  if (releaseError) {
    return NextResponse.json(
      { error: { code: 'trust_deposit_release_failed', message: releaseError.message } },
      { status: 422 },
    );
  }

  const { data, error: fetchError } = await supabase
    .from('trust_ledgers')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'trust_ledger_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ trustLedger: mapTrustLedgerRow(data) });
}
