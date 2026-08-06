import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { BankTransaction, OwnerStatement } from '@propvault/types';
import { OWNER_STATEMENT_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerStatementRow, mapBankTransactionRow } from '@/lib/accounting';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PageHeader } from '@/components/ui/PageHeader';
import { IssueOwnerStatementButton } from '@/components/accounting/IssueOwnerStatementButton';
import { ConfirmOwnerStatementPayoutControl } from '@/components/accounting/ConfirmOwnerStatementPayoutControl';
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

export default async function OwnerStatementDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-owner-statement-1') notFound();
    return (
      <OwnerStatementDetailView
        statement={DEMO_STATEMENT}
        ownerName="Demo Owner"
        canPost
        payoutCandidates={[]}
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('owner_statements')
    .select('*, owners(name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load owner statement: ${error.message}`);
  if (!data) notFound();

  const statement = mapOwnerStatementRow(data);
  const ownerName = (data as { owners?: { name?: string } | null }).owners?.name ?? 'Unknown owner';

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, statement.orgId) : undefined;
  const canPost = Boolean(membership && canPostAccountingRecords(membership.role));

  let payoutCandidates: BankTransaction[] = [];
  if (statement.status === 'issued' && canPost) {
    const { data: txns } = await supabase
      .from('bank_transactions')
      .select('*, bank_accounts!inner(org_id)')
      .eq('bank_accounts.org_id', statement.orgId)
      .eq('match_status', 'unmatched')
      .lt('amount', 0)
      .order('transaction_date', { ascending: false });
    payoutCandidates = (txns ?? []).map(mapBankTransactionRow);
  }

  return (
    <OwnerStatementDetailView
      statement={statement}
      ownerName={ownerName}
      canPost={canPost}
      payoutCandidates={payoutCandidates}
    />
  );
}

function OwnerStatementDetailView({
  statement,
  ownerName,
  canPost,
  payoutCandidates,
}: {
  statement: OwnerStatement;
  ownerName: string;
  canPost: boolean;
  payoutCandidates: BankTransaction[];
}) {
  return (
    <div>
      <Link
        href="/accounting/owner-statements"
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to owner statements
      </Link>

      <div className="mt-2">
        <PageHeader
          title={ownerName}
          subtitle={`${statement.periodStart} – ${statement.periodEnd}`}
          actions={<StatusBadge presentation={OWNER_STATEMENT_STATUS_PRESENTATION[statement.status]} />}
        />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-light-textSecondary dark:text-dark-textSecondary">Rent collected</dt>
          <dd className="mt-1 font-medium text-light-textPrimary dark:text-dark-textPrimary">
            R{statement.rentCollected.toLocaleString('en-ZA')}
          </dd>
        </div>
        <div>
          <dt className="text-light-textSecondary dark:text-dark-textSecondary">Expenses</dt>
          <dd className="mt-1 font-medium text-light-textPrimary dark:text-dark-textPrimary">
            R{statement.expensesTotal.toLocaleString('en-ZA')}
          </dd>
        </div>
        <div>
          <dt className="text-light-textSecondary dark:text-dark-textSecondary">Management fee</dt>
          <dd className="mt-1 font-medium text-light-textPrimary dark:text-dark-textPrimary">
            R{statement.managementFee.toLocaleString('en-ZA')}
          </dd>
        </div>
        <div>
          <dt className="text-light-textSecondary dark:text-dark-textSecondary">Net payable</dt>
          <dd className="mt-1 font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            R{statement.netPayable.toLocaleString('en-ZA')}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <Link
          href={`/accounting/owner-statements/${statement.id}/print`}
          target="_blank"
          className="text-xs text-light-accent hover:underline dark:text-dark-accent"
        >
          Printable / downloadable version →
        </Link>
      </div>

      {statement.status === 'draft' && canPost ? (
        <IssueOwnerStatementButton ownerStatementId={statement.id} />
      ) : null}

      {statement.status === 'issued' && canPost ? (
        <ConfirmOwnerStatementPayoutControl ownerStatementId={statement.id} candidates={payoutCandidates} />
      ) : null}

      {statement.status === 'paid' ? (
        <p className="mt-4 text-xs text-light-textMuted dark:text-dark-textMuted">
          Paid out — matched to bank transaction {statement.payoutMatchedTransactionId}.
        </p>
      ) : null}
    </div>
  );
}
