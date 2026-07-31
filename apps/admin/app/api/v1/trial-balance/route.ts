import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * GET /api/v1/trial-balance?org_id=...&ledger_class=business|trust|deposit (API_SPEC.md §6,
 * ACCOUNTING.md §6). A live, computed report -- SUM(debit)-SUM(credit) per account -- never a
 * stored table, per ACCOUNTING.md §6. RLS on journal_lines/chart_of_accounts already scopes both
 * queries to the caller's orgs; this route's job is just the aggregation and the "Balanced" check.
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
  const orgId = url.searchParams.get('org_id');
  const ledgerClass = url.searchParams.get('ledger_class');
  if (!orgId) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'org_id query parameter is required.' } },
      { status: 400 },
    );
  }

  let accountsQuery = supabase
    .from('chart_of_accounts')
    .select('id, code, name, account_type, ledger_class')
    .eq('org_id', orgId)
    .order('code', { ascending: true });
  if (ledgerClass) accountsQuery = accountsQuery.eq('ledger_class', ledgerClass);

  const { data: accounts, error: accountsError } = await accountsQuery;
  if (accountsError) {
    return NextResponse.json(
      { error: { code: 'chart_of_accounts_fetch_failed', message: accountsError.message } },
      { status: 500 },
    );
  }

  const accountIds = (accounts ?? []).map((a) => a.id);
  if (accountIds.length === 0) {
    return NextResponse.json({ rows: [], balanced: true, totalDebit: 0, totalCredit: 0 });
  }

  const { data: lines, error: linesError } = await supabase
    .from('journal_lines')
    .select('account_id, debit, credit')
    .in('account_id', accountIds);
  if (linesError) {
    return NextResponse.json(
      { error: { code: 'journal_lines_fetch_failed', message: linesError.message } },
      { status: 500 },
    );
  }

  const totalsByAccount = new Map<string, { debit: number; credit: number }>();
  for (const line of lines ?? []) {
    const existing = totalsByAccount.get(line.account_id) ?? { debit: 0, credit: 0 };
    existing.debit += Number(line.debit);
    existing.credit += Number(line.credit);
    totalsByAccount.set(line.account_id, existing);
  }

  const rows = (accounts ?? []).map((account) => {
    const totals = totalsByAccount.get(account.id) ?? { debit: 0, credit: 0 };
    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.account_type,
      ledgerClass: account.ledger_class,
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      balance: totals.debit - totals.credit,
    };
  });

  const totalDebit = rows.reduce((sum, row) => sum + row.totalDebit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.totalCredit, 0);

  // The "Balanced" health check (ACCOUNTING.md §6): if this is ever false across the WHOLE org's
  // ledger (no ledger_class filter), it means the immutability/balance invariant was violated
  // somewhere -- post_journal_entry() should make this structurally impossible, so a false here
  // is a signal to investigate, not a normal user-facing warning state.
  return NextResponse.json({
    rows,
    balanced: Math.abs(totalDebit - totalCredit) < 0.005,
    totalDebit,
    totalCredit,
  });
}
