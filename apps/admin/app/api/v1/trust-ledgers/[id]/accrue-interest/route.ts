import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTrustLedgerRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/trust-ledgers/:id/accrue-interest -- thin wrapper over accrue_trust_interest()
 * (migration 20260101000051, ACCOUNTING.md §4, TECHNICAL_DEBT_REGISTER.md TD-22). Not part of
 * API_SPEC.md §6's original literal route list (added alongside /release for the same reason
 * /leases/:id/post-deposit was added beyond the list -- the explicit accountant-triggered action
 * has to live somewhere). A no-op (200, unchanged ledger) when the rate/balance is zero or no
 * time has elapsed since the last accrual -- not an error, matching the RPC's own semantics.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  const { error: accrueError } = await supabase.rpc('accrue_trust_interest', {
    p_trust_ledger_id: id,
  });

  if (accrueError) {
    return NextResponse.json(
      { error: { code: 'trust_interest_accrual_failed', message: accrueError.message } },
      { status: 422 },
    );
  }

  const { data, error: fetchError } = await supabase.from('trust_ledgers').select('*').eq('id', id).single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'trust_ledger_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ trustLedger: mapTrustLedgerRow(data) });
}
