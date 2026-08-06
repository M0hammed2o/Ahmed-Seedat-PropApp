import { redirect, notFound } from 'next/navigation';
import { UnitForm } from '@/components/units/UnitForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapUnitRow } from '@/lib/portfolio';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string; unitId: string }> };

export default async function EditUnitPage({ params }: RouteParams) {
  const { id: propertyId, unitId } = await params;

  if (ADMIN_DEMO_MODE) {
    if (propertyId !== 'demo-property-1' || unitId !== 'demo-unit-1') notFound();
    return (
      <UnitForm
        mode="edit"
        propertyId={propertyId}
        unit={{
          id: 'demo-unit-1',
          propertyId: 'demo-property-1',
          orgId: 'demo-org-1',
          unitLabel: 'Unit 1',
          bedrooms: 2,
          bathrooms: 1,
          sizeSqm: 65,
          marketRent: 12500,
          status: 'occupied',
          createdAt: '2026-06-01T00:00:00Z',
          updatedAt: '2026-06-01T00:00:00Z',
        }}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .eq('id', unitId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load unit: ${error.message}`);
  if (!data) notFound();

  const unit = mapUnitRow(data);
  const membership = findActiveMembership(session, unit.orgId);
  const canEdit = membership && canWriteOrgRecords(membership.role);
  if (!canEdit) redirect(`/properties/${propertyId}/units/${unitId}`);

  return <UnitForm mode="edit" propertyId={propertyId} unit={unit} />;
}
