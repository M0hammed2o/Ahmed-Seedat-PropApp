import Link from 'next/link';
import type { BankTransaction, RentSchedule, Expense } from '@propvault/types';
import { BankTransactionsFilterClient } from '@/components/tables/BankTransactionsFilterClient';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapBankTransactionRow, mapExpenseRow } from '@/lib/accounting';
import {
  resolvePortalSession,
  findActiveMembership,
  canPostAccountingRecords,
} from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_TRANSACTIONS: BankTransaction[] = [
  {
    id: 'demo-bank-transaction-1',
    bankAccountId: 'demo-bank-account-1',
    transactionDate: '2026-08-01',
    amount: 12500,
    description: 'EFT rent payment',
    reference: 'REF12345',
    matchedJournalEntryId: null,
    matchedRentScheduleId: null,
    matchStatus: 'unmatched',
    createdAt: '2026-08-01T00:00:00Z',
    propertyId: null,
    unitId: null,
    tenantId: null,
    vendorId: null,
    category: null,
    documentId: null,
    notes: null,
    expenseId: null,
  },
];

const DEMO_RENT_SCHEDULE: RentSchedule[] = [
  {
    id: 'demo-rent-schedule-1',
    orgId: 'demo-org-1',
    leaseId: 'demo-lease-1',
    dueDate: '2026-08-01',
    amount: 12500,
    status: 'pending',
    generatedAt: '2026-08-01T00:00:00Z',
  },
];

/**
 * GET /accounting/bank-transactions -- Payments/bank-matching slice (TASKS.md M20). Match
 * candidates are the org's pending/overdue rent_schedule rows -- the only case
 * confirm_bank_transaction_match() supports (TD-22: rent-payment matching only, no
 * vendor-bill/expense matching in V1).
 */
export default async function BankTransactionsPage() {
  const transactions: BankTransaction[] = ADMIN_DEMO_MODE
    ? DEMO_TRANSACTIONS
    : await loadTransactions();
  const candidates: RentSchedule[] = ADMIN_DEMO_MODE
    ? DEMO_RENT_SCHEDULE
    : await loadRentScheduleCandidates();
  const pendingExpenses: Expense[] = ADMIN_DEMO_MODE ? [] : await loadPendingExpenseCandidates();
  const canPost = ADMIN_DEMO_MODE ? true : await resolveCanPost();

  const unmatched = transactions.filter((t) => t.matchStatus === 'unmatched').length;
  const matched = transactions.filter((t) => t.matchStatus === 'matched').length;

  const addAction = (
    <Link href="/accounting/bank-transactions/new">
      <Button variant="primary" size="sm">
        + Add transaction
      </Button>
    </Link>
  );

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Bank Transactions" actions={canPost ? addAction : undefined} />

      <div className="grid grid-cols-2 gap-4">
        <AdminMetricCard label="Unmatched" value={unmatched} />
        <AdminMetricCard label="Matched" value={matched} />
      </div>

      <BankTransactionsFilterClient
        transactions={transactions}
        canPost={canPost}
        rentScheduleCandidates={candidates}
        pendingExpenseCandidates={pendingExpenses}
      />
    </div>
  );
}

async function loadTransactions(): Promise<BankTransaction[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('bank_transactions')
    .select('*')
    .order('transaction_date', { ascending: false });
  if (error) throw new Error(`Failed to load bank transactions: ${error.message}`);
  return (data ?? []).map(mapBankTransactionRow);
}

async function loadRentScheduleCandidates(): Promise<RentSchedule[]> {
  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return [];

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('rent_schedules')
    .select('*')
    .eq('org_id', activeOrg.orgId)
    .in('status', ['pending', 'overdue', 'invoiced', 'partial'])
    .order('due_date', { ascending: true });
  if (error) throw new Error(`Failed to load rent schedule: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    leaseId: row.lease_id,
    dueDate: row.due_date,
    amount: row.amount,
    status: row.status as RentSchedule['status'],
    generatedAt: row.generated_at,
  }));
}

// Candidates for the "Expense" matching destination (migration 20260101000146) -- only
// status='pending' expenses are eligible, matching match_bank_transaction_to_expense()'s own
// guard (it re-checks this server-side regardless; this is just what's offered in the picker).
async function loadPendingExpenseCandidates(): Promise<Expense[]> {
  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return [];

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('org_id', activeOrg.orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load pending expenses: ${error.message}`);
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
