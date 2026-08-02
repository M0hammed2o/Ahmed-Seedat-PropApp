import { redirect } from 'next/navigation';
import { BankTransactionForm } from '@/components/accounting/BankTransactionForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewBankTransactionPage() {
  if (ADMIN_DEMO_MODE) {
    return <BankTransactionForm bankAccounts={[{ id: 'demo-bank-account-1', bankName: 'FNB Business' }]} />;
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  const membership = findActiveMembership(session, activeOrg.orgId);
  if (!membership || !canPostAccountingRecords(membership.role)) redirect('/accounting/bank-transactions');

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('id, bank_name')
    .eq('org_id', activeOrg.orgId)
    .eq('is_active', true)
    .order('bank_name', { ascending: true });
  if (error) throw new Error(`Failed to load bank accounts: ${error.message}`);

  return <BankTransactionForm bankAccounts={(data ?? []).map((a) => ({ id: a.id, bankName: a.bank_name }))} />;
}
