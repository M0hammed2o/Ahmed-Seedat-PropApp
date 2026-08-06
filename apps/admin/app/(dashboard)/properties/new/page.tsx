import { redirect } from 'next/navigation';
import { NewPropertyForm } from '@/components/properties/NewPropertyForm';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewPropertyPage() {
  if (ADMIN_DEMO_MODE) {
    return <NewPropertyForm orgId="demo-org-1" />;
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  // agent+ per PERMISSIONS.md §2's Properties/Units/Leases/Tenants column (viewer/accountant are
  // view-only) -- checked here for a fast redirect rather than letting the user land on a form
  // they can't submit; POST /api/v1/properties re-checks this server-side regardless
  // (API_SPEC.md §11 "never only in the UI"), this is a UX nicety on top of that.
  const canCreate =
    findActiveMembership(session, activeOrg.orgId) && canWriteOrgRecords(activeOrg.role);
  if (!canCreate) redirect('/properties');

  return <NewPropertyForm orgId={activeOrg.orgId} />;
}
