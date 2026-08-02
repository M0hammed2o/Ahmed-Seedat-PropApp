import { redirect, notFound } from 'next/navigation';
import { InspectionForm } from '@/components/inspections/InspectionForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string; unitId: string }> };

// GET /properties/:id/units/:unitId/inspections/new -- inspectionCreateSchema requires both
// propertyId and unitId, same pattern as leases/new, applications/new, maintenance/new.
export default async function NewInspectionPage({ params }: RouteParams) {
  const { id: propertyId, unitId } = await params;

  if (ADMIN_DEMO_MODE) {
    if (propertyId !== 'demo-property-1' || unitId !== 'demo-unit-1') notFound();
    return <InspectionForm orgId="demo-org-1" propertyId={propertyId} unitId={unitId} />;
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

  return <InspectionForm orgId={unit.org_id} propertyId={propertyId} unitId={unitId} />;
}
