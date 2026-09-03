import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Expense } from '@propvault/types';
import { EXPENSE_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapExpenseRow } from '@/lib/accounting';
import {
  resolvePortalSession,
  findActiveMembership,
  canPostAccountingRecords,
} from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PageHeader } from '@/components/ui/PageHeader';
import { RecordExpenseButton } from '@/components/accounting/RecordExpenseButton';
import { ExpenseEvidenceUpload } from '@/components/accounting/ExpenseEvidenceUpload';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_EXPENSE: Expense = {
  id: 'demo-expense-1',
  orgId: 'demo-org-1',
  propertyId: 'demo-property-1',
  unitId: null,
  vendorId: null,
  category: 'Plumbing repair',
  categoryCode: 'maintenance',
  amount: 1850,
  status: 'pending',
  documentId: null,
  journalEntryId: null,
  referenceNumber: null,
  invoiceDate: null,
  notes: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

export default async function ExpenseDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-expense-1') notFound();
    return <ExpenseDetailView expense={DEMO_EXPENSE} canPost receiptCategoryId={null} />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('expenses').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load expense: ${error.message}`);
  if (!data) notFound();
  const expense = mapExpenseRow(data);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, expense.orgId) : undefined;
  const canPost = Boolean(membership && canPostAccountingRecords(membership.role));

  // Only needed when there's actually an upload control to show (pending, no evidence yet, and
  // the caller can post) -- skips the lookup entirely otherwise.
  let receiptCategoryId: string | null = null;
  if (expense.status === 'pending' && !expense.documentId && canPost) {
    const { data: category } = await supabase
      .from('document_categories')
      .select('id')
      .eq('slug', 'receipt')
      .maybeSingle();
    receiptCategoryId = category?.id ?? null;
  }

  return <ExpenseDetailView expense={expense} canPost={canPost} receiptCategoryId={receiptCategoryId} />;
}

function ExpenseDetailView({
  expense,
  canPost,
  receiptCategoryId,
}: {
  expense: Expense;
  canPost: boolean;
  receiptCategoryId: string | null;
}) {
  return (
    <div>
      <Link
        href="/accounting/expenses"
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to expenses
      </Link>

      <div className="mt-2">
        <PageHeader
          title={expense.category}
          subtitle={`R${expense.amount.toLocaleString('en-ZA')}`}
          actions={<StatusBadge presentation={EXPENSE_STATUS_PRESENTATION[expense.status]} />}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
        {expense.referenceNumber ? (
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Reference</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {expense.referenceNumber}
            </dd>
          </div>
        ) : null}
        {expense.invoiceDate ? (
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Invoice date</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {new Date(expense.invoiceDate).toLocaleDateString('en-ZA')}
            </dd>
          </div>
        ) : null}
      </dl>

      {expense.notes ? (
        <div className="mt-4">
          <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
            Notes
          </h2>
          <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            {expense.notes}
          </p>
        </div>
      ) : null}

      <div className="mt-6">
        <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          Supporting evidence
        </h2>
        {expense.documentId ? (
          <Link
            href={`/documents/${expense.documentId}`}
            className="mt-1 inline-block text-xs text-light-primary hover:underline dark:text-dark-primary"
          >
            View attached evidence →
          </Link>
        ) : canPost && expense.status === 'pending' && receiptCategoryId ? (
          <ExpenseEvidenceUpload
            expenseId={expense.id}
            orgId={expense.orgId}
            propertyId={expense.propertyId}
            receiptCategoryId={receiptCategoryId}
          />
        ) : (
          <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
            None attached.
          </p>
        )}
      </div>

      {expense.status === 'pending' && canPost ? (
        <RecordExpenseButton expenseId={expense.id} hasEvidence={Boolean(expense.documentId)} />
      ) : null}

      {expense.journalEntryId ? (
        <p className="mt-4 text-xs text-light-textMuted dark:text-dark-textMuted">
          Posted to the ledger (journal entry {expense.journalEntryId}).
        </p>
      ) : null}
    </div>
  );
}
