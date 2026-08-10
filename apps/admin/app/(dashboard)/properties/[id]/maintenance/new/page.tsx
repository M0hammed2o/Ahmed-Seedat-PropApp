import { redirect, notFound } from 'next/navigation';
import { MaintenanceForm } from '@/components/maintenance/MaintenanceForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

// GET /properties/:id/maintenance/new -- tickets are always reported from a property's own
// context (maintenanceTicketCreateSchema requires propertyId), mirroring properties/[id]/units/
// new/page.tsx's role-gate-then-redirect pattern.
export default async function NewMaintenancePage({ params }: RouteParams) {
  const { id: propertyId } = await params;

  if (ADMIN_DEMO_MODE) {
    if (propertyId !== 'demo-property-1') notFound();
    return (
      <MaintenanceForm
        mode="create"
        orgId="demo-org-1"
        propertyId={propertyId}
        units={[
          { id: 'demo-unit-1', unitLabel: 'Unit 1' },
          { id: 'demo-unit-2', unitLabel: 'Unit 2' },
        ]}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data: property, error } = await supabase
    .from('properties')
    .select('id, org_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load property: ${error.message}`);
  if (!property) notFound();

  const membership = findActiveMembership(session, property.org_id);
  const canCreate = membership && canWriteOrgRecords(membership.role);
  if (!canCreate) redirect(`/properties/${propertyId}`);

  const { data: units, error: unitsError } = await supabase
    .from('units')
    .select('id, unit_label')
    .eq('property_id', propertyId)
    .order('unit_label', { ascending: true });
  if (unitsError) throw new Error(`Failed to load units: ${unitsError.message}`);

  return (
    <MaintenanceForm
      mode="create"
      orgId={property.org_id}
      propertyId={propertyId}
      units={(units ?? []).map((u) => ({ id: u.id, unitLabel: u.unit_label }))}
    />
  );
}
