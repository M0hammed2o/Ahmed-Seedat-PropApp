import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTrustLedgerRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/leases/:id/post-deposit -- thin wrapper over post_lease_deposit() (migration
 * 20260101000038). Not part of API_SPEC.md §6's literal route list (which only shows
 * trust-ledgers/:id/release) -- added because opening a trust ledger has to happen somewhere,
 * and it is deliberately NOT automatic on lease approval (PERMISSIONS.md §2: agent, who approves
 * applications, has no accounting-post rights -- see the migration's own comment for the full
 * reasoning). This is the accountant-facing action that does it explicitly, once, per lease.
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

  const { data: trustLedgerId, error: postError } = await supabase.rpc('post_lease_deposit', {
    p_lease_id: id,
  });

  if (postError) {
    return NextResponse.json(
      { error: { code: 'post_deposit_failed', message: postError.message } },
      { status: 500 },
    );
  }

  const { data, error: fetchError } = await supabase
    .from('trust_ledgers')
    .select('*')
    .eq('id', trustLedgerId)
    .single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'trust_ledger_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ trustLedger: mapTrustLedgerRow(data) }, { status: 201 });
}
