import { notFound } from 'next/navigation';
import type { OwnerStatement } from '@propvault/types';
import { branding } from '@propvault/config';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerStatementRow } from '@/lib/accounting';
import { PrintButton } from '@/components/accounting/PrintButton';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_STATEMENT: OwnerStatement = {
  id: 'demo-owner-statement-1',
  orgId: 'demo-org-1',
  ownerId: 'demo-owner-1',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  rentCollected: 18500,
  expensesTotal: 1200,
  managementFee: 1850,
  reserveAmount: 0,
  netPayable: 15450,
  amountPaid: 0,
  outstandingBalance: 15450,
  status: 'issued',
  payoutMatchedTransactionId: null,
  pdfDocumentId: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

/**
 * GET /accounting/owner-statements/:id/print -- printable/downloadable output (via the browser's
 * own print-to-PDF, no server-side PDF-generation dependency introduced for V1). Reuses the
 * (dashboard) layout for auth-gating, but AppShell hides all its chrome under `print:hidden`
 * (components/shell/AppShell.tsx) so only this page's content actually prints.
 */
export default async function OwnerStatementPrintPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-owner-statement-1') notFound();
    return (
      <PrintableStatement
        statement={DEMO_STATEMENT}
        ownerName="Demo Owner"
        orgName="Demo Organization"
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('owner_statements')
    .select('*, owners(name), organizations(legal_name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load owner statement: ${error.message}`);
  if (!data) notFound();

  const statement = mapOwnerStatementRow(data);
  const ownerName = (data as { owners?: { name?: string } | null }).owners?.name ?? 'Unknown owner';
  const orgName =
    (data as { organizations?: { legal_name?: string } | null }).organizations?.legal_name ??
    branding.productName;

  return <PrintableStatement statement={statement} ownerName={ownerName} orgName={orgName} />;
}

function PrintableStatement({
  statement,
  ownerName,
  orgName,
}: {
  statement: OwnerStatement;
  ownerName: string;
  orgName: string;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="print:hidden">
        <PrintButton />
      </div>

      <div className="mt-4 border border-light-border p-8 print:mt-0 print:border-none print:p-0 dark:border-dark-border">
        <div className="flex items-start justify-between border-b border-light-border pb-4 dark:border-dark-border">
          <div>
            <p className="text-lg font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {orgName}
            </p>
            <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Owner Statement
            </p>
          </div>
          <div className="text-right text-sm text-light-textSecondary dark:text-dark-textSecondary">
            <p>
              {statement.periodStart} – {statement.periodEnd}
            </p>
            <p>Status: {statement.status}</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-light-textPrimary dark:text-dark-textPrimary">
          Prepared for: {ownerName}
        </p>

        <table className="mt-6 w-full text-sm">
          <tbody>
            <tr className="border-b border-light-border dark:border-dark-border">
              <td className="py-2 text-light-textSecondary dark:text-dark-textSecondary">
                Rent collected
              </td>
              <td className="py-2 text-right font-medium text-light-textPrimary dark:text-dark-textPrimary">
                R{statement.rentCollected.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
              </td>
            </tr>
            <tr className="border-b border-light-border dark:border-dark-border">
              <td className="py-2 text-light-textSecondary dark:text-dark-textSecondary">
                Expenses
              </td>
              <td className="py-2 text-right font-medium text-light-textPrimary dark:text-dark-textPrimary">
                (R{statement.expensesTotal.toLocaleString('en-ZA', { minimumFractionDigits: 2 })})
              </td>
            </tr>
            <tr className="border-b border-light-border dark:border-dark-border">
              <td className="py-2 text-light-textSecondary dark:text-dark-textSecondary">
                Management fee
              </td>
              <td className="py-2 text-right font-medium text-light-textPrimary dark:text-dark-textPrimary">
                (R{statement.managementFee.toLocaleString('en-ZA', { minimumFractionDigits: 2 })})
              </td>
            </tr>
            <tr>
              <td className="py-3 font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                Net payable
              </td>
              <td className="py-3 text-right text-lg font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                R{statement.netPayable.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
          Generated from PropertyVault's accounting ledger. This is a snapshot of the ledger at the
          time it was issued and does not change if later corrections are made to the underlying
          records — any such correction appears in the following period's statement instead.
        </p>
      </div>
    </div>
  );
}
