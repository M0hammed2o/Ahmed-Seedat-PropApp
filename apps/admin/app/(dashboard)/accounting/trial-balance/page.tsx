import Link from 'next/link';
import type { LedgerClass, TrialBalanceRow } from '@propvault/types';
import { LEDGER_CLASSES } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession } from '@/lib/orgSession';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { Pill } from '@/components/ui/Pill';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type SearchParams = { searchParams: Promise<{ ledger_class?: string }> };

const DEMO_ROWS: TrialBalanceRow[] = [
  {
    accountId: 'demo-account-1',
    accountCode: '1100',
    accountName: 'Accounts Receivable',
    accountType: 'asset',
    ledgerClass: 'business',
    totalDebit: 12500,
    totalCredit: 0,
    balance: 12500,
  },
  {
    accountId: 'demo-account-2',
    accountCode: '4000',
    accountName: 'Rental Income',
    accountType: 'income',
    ledgerClass: 'business',
    totalDebit: 0,
    totalCredit: 12500,
    balance: -12500,
  },
];

/**
 * GET /accounting/trial-balance -- third Accounting-module page, matching
 * PROPVIEW_SCREENSHOT_AUDIT.md's "[Owner Statements, Vendor Invoices, Trial Balance, Tax Pack]"
 * evidenced group. Read-only for every role (PERMISSIONS.md's Accounting (view) column: even
 * `viewer` gets Full view access) -- reproduces GET /api/v1/trial-balance's own aggregation query
 * directly (ACCOUNTING.md §6: "a live, computed report... never a stored table") rather than this
 * server component calling its own API route over HTTP.
 */
export default async function TrialBalancePage({ searchParams }: SearchParams) {
  const { ledger_class: ledgerClassParam } = await searchParams;
  const ledgerClass = (LEDGER_CLASSES as readonly string[]).includes(ledgerClassParam ?? '')
    ? (ledgerClassParam as LedgerClass)
    : undefined;

  const { rows, balanced, totalDebit, totalCredit } = ADMIN_DEMO_MODE
    ? {
        rows: DEMO_ROWS.filter((r) => !ledgerClass || r.ledgerClass === ledgerClass),
        balanced: true,
        totalDebit: 12500,
        totalCredit: 12500,
      }
    : await loadTrialBalance(ledgerClass);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Trial Balance"
        subtitle="Live SUM(debit)/SUM(credit) per account — never a stored snapshot."
        actions={
          <Pill tone={balanced ? 'success' : 'destructive'} dot>
            {balanced ? 'Balanced' : 'Not balanced — investigate'} (Debit R{totalDebit.toLocaleString('en-ZA')} / Credit R
            {totalCredit.toLocaleString('en-ZA')})
          </Pill>
        }
      />

      <div className="flex gap-2">
        <FilterLink label="All" active={!ledgerClass} href="/accounting/trial-balance" />
        {LEDGER_CLASSES.map((lc) => (
          <FilterLink
            key={lc}
            label={lc}
            active={ledgerClass === lc}
            href={`/accounting/trial-balance?ledger_class=${lc}`}
          />
        ))}
      </div>

      <Panel bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Code</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Account</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Type</th>
                <th className="px-4 py-3 text-right font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Debit
                </th>
                <th className="px-4 py-3 text-right font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Credit
                </th>
                <th className="px-4 py-3 text-right font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-light-textMuted dark:text-dark-textMuted">
                    No accounts for this filter.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.accountId} className="border-b border-light-border last:border-b-0 dark:border-dark-border">
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{row.accountCode}</td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{row.accountName}</td>
                    <td className="px-4 py-3 capitalize text-light-textSecondary dark:text-dark-textSecondary">
                      {row.accountType}
                    </td>
                    <td className="px-4 py-3 text-right text-light-textPrimary dark:text-dark-textPrimary">
                      R{row.totalDebit.toLocaleString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 text-right text-light-textPrimary dark:text-dark-textPrimary">
                      R{row.totalCredit.toLocaleString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 text-right text-light-textPrimary dark:text-dark-textPrimary">
                      R{row.balance.toLocaleString('en-ZA')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function FilterLink({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs capitalize ${
        active
          ? 'border-light-accent bg-light-accent/10 text-light-accent dark:border-dark-accent dark:bg-dark-accent/10 dark:text-dark-accent'
          : 'border-light-border text-light-textSecondary dark:border-dark-border dark:text-dark-textSecondary'
      }`}
    >
      {label}
    </Link>
  );
}

async function loadTrialBalance(
  ledgerClass?: LedgerClass,
): Promise<{ rows: TrialBalanceRow[]; balanced: boolean; totalDebit: number; totalCredit: number }> {
  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return { rows: [], balanced: true, totalDebit: 0, totalCredit: 0 };

  const supabase = await getServerSupabaseClient();
  let accountsQuery = supabase
    .from('chart_of_accounts')
    .select('id, code, name, account_type, ledger_class')
    .eq('org_id', activeOrg.orgId)
    .order('code', { ascending: true });
  if (ledgerClass) accountsQuery = accountsQuery.eq('ledger_class', ledgerClass);

  const { data: accounts, error: accountsError } = await accountsQuery;
  if (accountsError) throw new Error(`Failed to load chart of accounts: ${accountsError.message}`);

  const accountIds = (accounts ?? []).map((a) => a.id);
  if (accountIds.length === 0) return { rows: [], balanced: true, totalDebit: 0, totalCredit: 0 };

  const { data: lines, error: linesError } = await supabase
    .from('journal_lines')
    .select('account_id, debit, credit')
    .in('account_id', accountIds);
  if (linesError) throw new Error(`Failed to load journal lines: ${linesError.message}`);

  const totalsByAccount = new Map<string, { debit: number; credit: number }>();
  for (const line of lines ?? []) {
    const existing = totalsByAccount.get(line.account_id) ?? { debit: 0, credit: 0 };
    existing.debit += Number(line.debit);
    existing.credit += Number(line.credit);
    totalsByAccount.set(line.account_id, existing);
  }

  const rows: TrialBalanceRow[] = (accounts ?? []).map((account) => {
    const totals = totalsByAccount.get(account.id) ?? { debit: 0, credit: 0 };
    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.account_type as TrialBalanceRow['accountType'],
      ledgerClass: account.ledger_class as TrialBalanceRow['ledgerClass'],
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      balance: totals.debit - totals.credit,
    };
  });

  const totalDebit = rows.reduce((sum, row) => sum + row.totalDebit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.totalCredit, 0);

  return { rows, balanced: Math.abs(totalDebit - totalCredit) < 0.005, totalDebit, totalCredit };
}
