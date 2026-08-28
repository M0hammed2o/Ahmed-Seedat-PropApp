import { redirect, notFound } from 'next/navigation';
import { LeaseForm } from '@/components/leases/LeaseForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string; unitId: string }> };

/**
 * GET /properties/:id/units/:unitId/leases/new/prepare -- "Create new lease" branch of the
 * V1 launch-completion pass's lease-entry choice (Section 5). Unchanged from the original
 * leases/new/page.tsx -- moved here so leases/new/page.tsx itself can become the choice screen
 * without altering this flow's own behaviour at all.
 */
export default async function NewLeasePreparePage({ params }: RouteParams) {
  const { id: propertyId, unitId } = await params;

  if (ADMIN_DEMO_MODE) {
    if (propertyId !== 'demo-property-1' || unitId !== 'demo-unit-1') notFound();
    return <LeaseForm mode="create" orgId="demo-org-1" unitId={unitId} propertyId={propertyId} />;
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data: unit, error } = await supabase
    .from('units')
    .select('id, org_id, property_id')
    .eq('id', unitId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load unit: ${error.message}`);
  if (!unit) notFound();

  const membership = findActiveMembership(session, unit.org_id);
  const canCreate = membership && canWriteOrgRecords(membership.role);
  if (!canCreate) redirect(`/properties/${propertyId}/units/${unitId}`);

  return <LeaseForm mode="create" orgId={unit.org_id} unitId={unitId} propertyId={propertyId} />;
}
