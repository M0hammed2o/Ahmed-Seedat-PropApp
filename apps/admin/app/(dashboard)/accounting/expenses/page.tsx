import Link from 'next/link';
import type { Expense } from '@propvault/types';
import { ExpensesTable } from '@/components/tables/ExpensesTable';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { Button } from '@/components/ui/Button';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapExpenseRow } from '@/lib/accounting';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_EXPENSES: Expense[] = [
  {
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
  },
];

/**
 * GET /accounting/expenses -- second Accounting-module page, matching PROPVIEW_SCREENSHOT_AUDIT.md's
 * FINANCE nav section's "Expenses" item. Same direct-RLS-read pattern as every list page this
 * milestone.
 */
export default async function ExpensesPage() {
  const expenses: Expense[] = ADMIN_DEMO_MODE ? DEMO_EXPENSES : await loadExpenses();
  const canPost = ADMIN_DEMO_MODE ? true : await resolveCanPost();

  const pending = expenses.filter((e) => e.status === 'pending').length;
  const recorded = expenses.filter((e) => e.status === 'recorded').length;

  const addAction = (
    <Link href="/accounting/expenses/new">
      <Button variant="primary" size="sm">
        + Add expense
      </Button>
    </Link>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Expenses</h1>
        {canPost && expenses.length > 0 ? addAction : null}
      </div>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} across your portfolio.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <AdminMetricCard label="Pending" value={pending} />
        <AdminMetricCard label="Recorded" value={recorded} />
      </div>

      <div className="mt-6">
        <ExpensesTable data={expenses} emptyAction={canPost ? addAction : undefined} />
      </div>
    </div>
  );
}

async function loadExpenses(): Promise<Expense[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('expenses').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load expenses: ${error.message}`);
  return (data ?? []).map(mapExpenseRow);
}

async function resolveCanPost(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && canPostAccountingRecords(membership.role));
}
