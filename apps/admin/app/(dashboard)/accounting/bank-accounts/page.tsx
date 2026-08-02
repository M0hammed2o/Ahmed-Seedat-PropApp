import Link from 'next/link';
import type { BankAccount } from '@propvault/types';
import { BankAccountsTable } from '@/components/tables/BankAccountsTable';
import { Button } from '@/components/ui/Button';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapBankAccountRow } from '@/lib/accounting';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_BANK_ACCOUNTS: BankAccount[] = [
  {
    id: 'demo-bank-account-1',
    orgId: 'demo-org-1',
    accountClass: 'business',
    bankName: 'FNB Business',
    accountNumberRef: null,
    isActive: true,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

/** GET /accounting/bank-accounts -- Payments/bank-matching slice (TASKS.md M20). Accountant+ write. */
export default async function BankAccountsPage() {
  const bankAccounts: BankAccount[] = ADMIN_DEMO_MODE ? DEMO_BANK_ACCOUNTS : await loadBankAccounts();
  const canPost = ADMIN_DEMO_MODE ? true : await resolveCanPost();

  const addAction = (
    <Link href="/accounting/bank-accounts/new">
      <Button variant="primary" size="sm">
        + Add bank account
      </Button>
    </Link>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Bank Accounts</h1>
        {canPost && bankAccounts.length > 0 ? addAction : null}
      </div>
      <div className="mt-6">
        <BankAccountsTable data={bankAccounts} emptyAction={canPost ? addAction : undefined} />
      </div>
    </div>
  );
}

async function loadBankAccounts(): Promise<BankAccount[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('bank_accounts').select('*').eq('is_active', true).order('bank_name');
  if (error) throw new Error(`Failed to load bank accounts: ${error.message}`);
  return (data ?? []).map(mapBankAccountRow);
}

async function resolveCanPost(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && canPostAccountingRecords(membership.role));
}
