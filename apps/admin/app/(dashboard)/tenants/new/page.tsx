import { redirect } from 'next/navigation';
import { TenantForm } from '@/components/tenants/TenantForm';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewTenantPage() {
  if (ADMIN_DEMO_MODE) {
    return <TenantForm mode="create" orgId="demo-org-1" />;
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  // agent+ per PERMISSIONS.md §2's Properties/Units/Leases/Tenants column, same UX-layer
  // fast-redirect as properties/new/page.tsx -- POST /api/v1/tenants re-checks server-side.
  const membership = findActiveMembership(session, activeOrg.orgId);
  const canCreate = membership && canWriteOrgRecords(membership.role);
  if (!canCreate) redirect('/tenants');

  return <TenantForm mode="create" orgId={activeOrg.orgId} />;
}
