import { Banknote, Coins } from 'lucide-react';
import type { CashReceipt, OwnerStatement } from '@propvault/types';
import { OWNER_STATEMENT_STATUS_PRESENTATION } from '@propvault/ui';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapCashReceiptRow, mapOwnerStatementRow } from '@/lib/accounting';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

function currency(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

const DEMO_STATEMENTS: OwnerStatement[] = [
  {
    id: 'demo-owner-statement-1',
    orgId: 'demo-org-1',
    ownerId: 'demo-owner-1',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    rentCollected: 18500,
    expensesTotal: 1200,
    managementFee: 1850,
    reserveAmount: 925,
    netPayable: 14525,
    amountPaid: 14525,
    outstandingBalance: 0,
    status: 'paid',
    payoutMatchedTransactionId: 'demo-txn-1',
    pdfDocumentId: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

const DEMO_CASH_RECEIPTS: CashReceipt[] = [
  {
    id: 'demo-owner-cash-receipt-1',
    orgId: 'demo-org-1',
    propertyId: 'demo-owner-property-1',
    leaseId: null,
    rentScheduleId: null,
    amount: 8500,
    receiptNumber: 'CR-000042',
    receivedBy: 'demo-staff-1',
    receivedAt: '2026-07-03T00:00:00Z',
    documentId: null,
    depositedAt: '2026-07-05T00:00:00Z',
    depositBankTransactionId: 'demo-txn-2',
    depositedAmount: 8500,
    variance: 0,
    journalEntryId: 'demo-entry-1',
    createdAt: '2026-07-03T00:00:00Z',
    updatedAt: '2026-07-05T00:00:00Z',
  },
];

/**
 * GET /owner-portal/distributions (Phase 5, commercial-launch execution plan). The exact
 * governance requirement named in the original directive: "outstanding distributions, historical
 * distributions." `owner_statements_select_org_or_self` (migration 20260101000037, predating this
 * phase) already scopes this to the caller's own statements via `owners.user_id = auth.uid()` --
 * RLS is the real isolation boundary here, same as every other portal page.
 */
export default async function OwnerDistributionsPage() {
  const statements = ADMIN_DEMO_MODE ? DEMO_STATEMENTS : await loadOwnerStatements();
  const cashReceipts = ADMIN_DEMO_MODE ? DEMO_CASH_RECEIPTS : await loadOwnerCashReceipts();
  const totalOutstanding = statements.reduce((sum, s) => sum + s.outstandingBalance, 0);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Distributions"
        subtitle="Your rental income, expenses, and payout history, statement by statement."
      />

      {totalOutstanding > 0 ? (
        <div className="rounded-card border border-light-border bg-light-surfaceRaised p-4 shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
          <p className="text-xs text-light-textMuted dark:text-dark-textMuted">Total outstanding</p>
          <p className="tabular mt-1 font-display text-2xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
            {currency(totalOutstanding)}
          </p>
        </div>
      ) : null}

      {statements.length === 0 ? (
        <div className="rounded-card border border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
          <EmptyState
            icon={<Banknote size={20} aria-hidden="true" />}
            title="No distributions yet"
            description="Owner statements for your properties will appear here once your property manager issues one."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Period</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Rent</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Expenses</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Mgmt fee</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Reserve</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Net payable</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Outstanding</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Status</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id} className="border-b border-light-border last:border-b-0 dark:border-dark-border">
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {s.periodStart} – {s.periodEnd}
                  </td>
                  <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">{currency(s.rentCollected)}</td>
                  <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">{currency(s.expensesTotal)}</td>
                  <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">{currency(s.managementFee)}</td>
                  <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">{currency(s.reserveAmount)}</td>
                  <td className="px-4 py-3 tabular font-medium text-light-textPrimary dark:text-dark-textPrimary">{currency(s.netPayable)}</td>
                  <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">{currency(s.outstandingBalance)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge presentation={OWNER_STATEMENT_STATUS_PRESENTATION[s.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Panel title="Cash receipts" bodyClassName="p-0">
        {cashReceipts.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={<Coins size={20} aria-hidden="true" />}
              title="No cash receipts"
              description="Cash rent collected for your properties -- who received it, and when it was banked -- will appear here."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
                <tr>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Receipt #</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Received</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Amount</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Deposited</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Variance</th>
                </tr>
              </thead>
              <tbody>
                {cashReceipts.map((r) => (
                  <tr key={r.id} className="border-b border-light-border last:border-b-0 dark:border-dark-border">
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{r.receiptNumber}</td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                      {new Date(r.receivedAt).toLocaleDateString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">{currency(r.amount)}</td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                      {r.depositedAt ? new Date(r.depositedAt).toLocaleDateString('en-ZA') : 'Not yet banked'}
                    </td>
                    <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">
                      {r.variance === null ? '—' : currency(r.variance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

async function loadOwnerStatements(): Promise<OwnerStatement[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('owner_statements')
    .select('*')
    .order('period_start', { ascending: false });
  if (error) throw new Error(`Failed to load owner statements: ${error.message}`);
  return (data ?? []).map(mapOwnerStatementRow);
}

async function loadOwnerCashReceipts(): Promise<CashReceipt[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('cash_receipts')
    .select('*')
    .order('received_at', { ascending: false });
  if (error) throw new Error(`Failed to load cash receipts: ${error.message}`);
  return (data ?? []).map(mapCashReceiptRow);
}
