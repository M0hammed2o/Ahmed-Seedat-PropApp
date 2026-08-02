import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Expense } from '@propvault/types';
import { EXPENSE_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapExpenseRow } from '@/lib/accounting';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RecordExpenseButton } from '@/components/accounting/RecordExpenseButton';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_EXPENSE: Expense = {
  id: 'demo-expense-1',
  orgId: 'demo-org-1',
  propertyId: 'demo-property-1',
  vendorId: null,
  category: 'Plumbing repair',
  amount: 1850,
  status: 'pending',
  documentId: null,
  journalEntryId: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

export default async function ExpenseDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-expense-1') notFound();
    return <ExpenseDetailView expense={DEMO_EXPENSE} canPost />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('expenses').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load expense: ${error.message}`);
  if (!data) notFound();
  const expense = mapExpenseRow(data);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, expense.orgId) : undefined;
  const canPost = Boolean(membership && canPostAccountingRecords(membership.role));

  return <ExpenseDetailView expense={expense} canPost={canPost} />;
}

function ExpenseDetailView({ expense, canPost }: { expense: Expense; canPost: boolean }) {
  return (
    <div>
      <Link
        href="/accounting/expenses"
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to expenses
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">{expense.category}</h1>
        <StatusBadge presentation={EXPENSE_STATUS_PRESENTATION[expense.status]} />
      </div>
      <p className="mt-1 text-sm text-light-textPrimary dark:text-dark-textPrimary">
        R{expense.amount.toLocaleString('en-ZA')}
      </p>

      {expense.status === 'pending' && canPost ? <RecordExpenseButton expenseId={expense.id} /> : null}

      {expense.journalEntryId ? (
        <p className="mt-4 text-xs text-light-textMuted dark:text-dark-textMuted">
          Posted to the ledger (journal entry {expense.journalEntryId}).
        </p>
      ) : null}
    </div>
  );
}
