import { redirect } from 'next/navigation';
import { ExpenseForm } from '@/components/accounting/ExpenseForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import {
  resolvePortalSession,
  findActiveMembership,
  canPostAccountingRecords,
} from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewExpensePage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <ExpenseForm
        orgId="demo-org-1"
        properties={[{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }]}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  // accountant+ per PERMISSIONS.md's Accounting (post) column -- a stricter gate than every other
  // create form this milestone, which only required agent+.
  const membership = findActiveMembership(session, activeOrg.orgId);
  if (!membership || !canPostAccountingRecords(membership.role)) redirect('/accounting/expenses');

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('properties')
    .select('id, nickname')
    .eq('org_id', activeOrg.orgId)
    .eq('status', 'active')
    .order('nickname', { ascending: true });
  if (error) throw new Error(`Failed to load properties: ${error.message}`);

  return <ExpenseForm orgId={activeOrg.orgId} properties={data ?? []} />;
}
