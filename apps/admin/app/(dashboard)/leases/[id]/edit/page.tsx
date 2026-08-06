import { redirect, notFound } from 'next/navigation';
import { LeaseForm } from '@/components/leases/LeaseForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapLeaseRow } from '@/lib/leasing';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

export default async function EditLeasePage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-lease-1') notFound();
    return (
      <LeaseForm
        mode="edit"
        orgId="demo-org-1"
        unitId="demo-unit-1"
        propertyId="demo-property-1"
        lease={{
          id: 'demo-lease-1',
          orgId: 'demo-org-1',
          unitId: 'demo-unit-1',
          startDate: '2026-02-01',
          endDate: null,
          rentAmount: 12500,
          rentFrequency: 'monthly',
          depositAmount: 12500,
          status: 'active',
          source: 'manual',
          sourceDocumentId: null,
          sourceApplicationId: null,
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        }}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('leases')
    .select('*, units(property_id)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load lease: ${error.message}`);
  if (!data) notFound();

  const { units, ...leaseRow } = data as typeof data & { units: { property_id: string } | null };
  const lease = mapLeaseRow(leaseRow);

  const membership = findActiveMembership(session, lease.orgId);
  const canEdit = membership && canWriteOrgRecords(membership.role);
  if (!canEdit) redirect(`/leases/${id}`);

  return (
    <LeaseForm mode="edit" orgId={lease.orgId} unitId={lease.unitId} propertyId={units?.property_id ?? ''} lease={lease} />
  );
}
