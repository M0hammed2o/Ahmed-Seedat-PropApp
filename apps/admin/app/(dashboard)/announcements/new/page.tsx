import { redirect } from 'next/navigation';
import { AnnouncementForm } from '@/components/announcements/AnnouncementForm';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewAnnouncementPage() {
  if (ADMIN_DEMO_MODE) {
    return <AnnouncementForm orgId="demo-org-1" />;
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  const membership = findActiveMembership(session, activeOrg.orgId);
  if (!membership || !canWriteOrgRecords(membership.role)) redirect('/announcements');

  return <AnnouncementForm orgId={activeOrg.orgId} />;
}
