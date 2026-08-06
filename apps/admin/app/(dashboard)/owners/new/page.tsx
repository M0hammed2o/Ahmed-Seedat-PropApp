import { redirect } from 'next/navigation';
import { OwnerForm } from '@/components/owners/OwnerForm';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewOwnerPage() {
  if (ADMIN_DEMO_MODE) {
    return <OwnerForm mode="create" orgId="demo-org-1" />;
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  const membership = findActiveMembership(session, activeOrg.orgId);
  const canCreate = membership && canWriteOrgRecords(membership.role);
  if (!canCreate) redirect('/owners');

  return <OwnerForm mode="create" orgId={activeOrg.orgId} />;
}
