import { redirect, notFound } from 'next/navigation';
import { RecordExistingLeaseForm } from '@/components/leases/RecordExistingLeaseForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string; unitId: string }> };
type SearchParams = { searchParams: Promise<{ tenantId?: string }> };

/**
 * GET /properties/:id/units/:unitId/leases/new/existing (V1 launch-completion pass, Section 6):
 * the missing staff-facing "record an already-signed tenancy" UI. Existing tenants are loaded
 * here for the primary/co-tenant pickers -- "Add existing tenant" (global /tenants/new) remains
 * the separate path for a tenant identity that doesn't exist in Proplyst yet.
 *
 * Tenant/occupancy V1 pass: an optional `?tenantId=` (forwarded from the leases/new choice page,
 * itself forwarded from a just-completed Add Tenant flow) pre-selects that tenant as primary,
 * closing the loop "create tenant -> record their lease" without making the landlord re-find them
 * in the dropdown. No new tenant/lease/occupancy record is created here -- purely a form default.
 */
export default async function NewExistingLeasePage({
  params,
  searchParams,
}: RouteParams & SearchParams) {
  const { id: propertyId, unitId } = await params;
  const { tenantId } = await searchParams;

  if (ADMIN_DEMO_MODE) {
    if (propertyId !== 'demo-property-1' || unitId !== 'demo-unit-1') notFound();
    return (
      <RecordExistingLeaseForm
        orgId="demo-org-1"
        propertyId={propertyId}
        unitId={unitId}
        unitLabel="Unit 1"
        tenants={[{ id: 'demo-tenant-1', fullName: 'Naledi Khumalo' }]}
        initialTenantId={tenantId}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data: unit, error } = await supabase
    .from('units')
    .select('id, org_id, unit_label')
    .eq('id', unitId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load unit: ${error.message}`);
  if (!unit) notFound();

  const membership = findActiveMembership(session, unit.org_id);
  const canCreate = membership && canWriteOrgRecords(membership.role);
  if (!canCreate) redirect(`/properties/${propertyId}/units/${unitId}`);

  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, full_name')
    .eq('org_id', unit.org_id)
    .order('full_name', { ascending: true });
  if (tenantsError) throw new Error(`Failed to load tenants: ${tenantsError.message}`);

  return (
    <RecordExistingLeaseForm
      orgId={unit.org_id}
      propertyId={propertyId}
      unitId={unitId}
      unitLabel={unit.unit_label}
      tenants={(tenants ?? []).map((t) => ({ id: t.id, fullName: t.full_name }))}
      initialTenantId={tenantId}
    />
  );
}
