import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapChartOfAccountRow } from '@/lib/accounting';

/**
 * GET /api/v1/chart-of-accounts (ACCOUNTING.md §2). Read-only from this API for now -- custom
 * account creation/deactivation (accountant+, RLS already supports it) gets its own endpoint once
 * a real Web UI needs it; system accounts are seeded automatically by create_organization() and
 * never created through a client call.
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

  const url = new URL(request.url);
  const orgIdFilter = url.searchParams.get('filter[org_id]');
  const ledgerClassFilter = url.searchParams.get('filter[ledger_class]');
  const activeOnly = url.searchParams.get('filter[is_active]') !== 'false';

  let query = supabase
    .from('chart_of_accounts')
    .select('*')
    .eq('is_active', activeOnly)
    .order('code', { ascending: true });

  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);
  if (ledgerClassFilter) query = query.eq('ledger_class', ledgerClassFilter);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'chart_of_accounts_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ chartOfAccounts: (data ?? []).map(mapChartOfAccountRow) });
}
