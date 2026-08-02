import { redirect } from 'next/navigation';
import { BankAccountForm } from '@/components/accounting/BankAccountForm';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewBankAccountPage() {
  if (ADMIN_DEMO_MODE) {
    return <BankAccountForm orgId="demo-org-1" />;
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  const membership = findActiveMembership(session, activeOrg.orgId);
  if (!membership || !canPostAccountingRecords(membership.role)) redirect('/accounting/bank-accounts');

  return <BankAccountForm orgId={activeOrg.orgId} />;
}
