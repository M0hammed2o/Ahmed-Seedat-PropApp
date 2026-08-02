import { redirect, notFound } from 'next/navigation';
import { ApplicationForm } from '@/components/applications/ApplicationForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string; unitId: string }> };

// GET /properties/:id/units/:unitId/applications/new -- applicationCreateSchema requires both
// propertyId and unitId, so this is always reached from a unit's own context, same pattern as
// leases/new and maintenance/new.
export default async function NewApplicationPage({ params }: RouteParams) {
  const { id: propertyId, unitId } = await params;

  if (ADMIN_DEMO_MODE) {
    if (propertyId !== 'demo-property-1' || unitId !== 'demo-unit-1') notFound();
    return <ApplicationForm orgId="demo-org-1" propertyId={propertyId} unitId={unitId} />;
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
  const canCreate = membership && membership.role !== 'viewer' && membership.role !== 'accountant';
  if (!canCreate) redirect(`/properties/${propertyId}/units/${unitId}`);

  return <ApplicationForm orgId={unit.org_id} propertyId={propertyId} unitId={unitId} />;
}
