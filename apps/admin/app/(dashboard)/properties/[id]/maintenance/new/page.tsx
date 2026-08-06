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
    return <MaintenanceForm mode="create" orgId="demo-org-1" propertyId={propertyId} />;
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

  return <MaintenanceForm mode="create" orgId={property.org_id} propertyId={propertyId} />;
}
