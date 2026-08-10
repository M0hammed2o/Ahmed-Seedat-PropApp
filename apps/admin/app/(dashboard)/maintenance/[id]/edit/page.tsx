import { redirect, notFound } from 'next/navigation';
import { MaintenanceForm } from '@/components/maintenance/MaintenanceForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

export default async function EditMaintenancePage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-ticket-1') notFound();
    return (
      <MaintenanceForm
        mode="edit"
        orgId="demo-org-1"
        propertyId="demo-property-1"
        units={[
          { id: 'demo-unit-1', unitLabel: 'Unit 1' },
          { id: 'demo-unit-2', unitLabel: 'Unit 2' },
        ]}
        ticket={{
          id: 'demo-ticket-1',
          orgId: 'demo-org-1',
          propertyId: 'demo-property-1',
          unitId: 'demo-unit-1',
          leaseId: 'demo-lease-1',
          tenantId: null,
          submittedByUserId: 'demo-user-1',
          submittedByTenantId: null,
          summary: 'Leaking kitchen tap',
          description: 'Constant drip from the cold tap, worsening over the past week.',
          priority: 'medium',
          status: 'to_do',
          assignedVendorId: null,
          createdAt: '2026-08-01T00:00:00Z',
          updatedAt: '2026-08-01T00:00:00Z',
          resolvedAt: null,
        }}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load maintenance ticket: ${error.message}`);
  if (!data) notFound();

  const ticket = mapMaintenanceTicketRow(data);
  const membership = findActiveMembership(session, ticket.orgId);
  const canEdit = membership && canWriteOrgRecords(membership.role);
  if (!canEdit) redirect(`/maintenance/${id}`);

  const { data: units, error: unitsError } = await supabase
    .from('units')
    .select('id, unit_label')
    .eq('property_id', ticket.propertyId)
    .order('unit_label', { ascending: true });
  if (unitsError) throw new Error(`Failed to load units: ${unitsError.message}`);

  return (
    <MaintenanceForm
      mode="edit"
      orgId={ticket.orgId}
      propertyId={ticket.propertyId}
      units={(units ?? []).map((u) => ({ id: u.id, unitLabel: u.unit_label }))}
      ticket={ticket}
    />
  );
}
