import { redirect } from 'next/navigation';
import { TenantForm } from '@/components/tenants/TenantForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewTenantPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <TenantForm
        mode="create"
        orgId="demo-org-1"
        properties={[{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }]}
        units={[{ id: 'demo-unit-1', propertyId: 'demo-property-1', unitLabel: 'Unit 1', status: 'vacant' }]}
      />
    );
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

  // Tenant/occupancy V1 pass: Step 1 of the Add Tenant flow lets a landlord say WHERE this
  // tenant will live, purely to route them to the existing lease-creation flow afterward --
  // never stored on the tenant itself (no tenant.property_id/unit_id; occupancy stays derived
  // from the real lease_tenants -> leases -> units chain, DATABASE.md §4). `status` is shown as
  // an informational hint only; activate_lease() itself is still the actual guard against
  // double-occupying a unit (supabase/migrations/20260101000143).
  const supabase = await getServerSupabaseClient();
  const [propertiesResult, unitsResult] = await Promise.all([
    supabase
      .from('properties')
      .select('id, nickname')
      .eq('org_id', activeOrg.orgId)
      .order('nickname', { ascending: true }),
    supabase
      .from('units')
      .select('id, property_id, unit_label, status')
      .eq('org_id', activeOrg.orgId)
      .order('unit_label', { ascending: true }),
  ]);
  if (propertiesResult.error)
    throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);

  return (
    <TenantForm
      mode="create"
      orgId={activeOrg.orgId}
      properties={(propertiesResult.data ?? []).map((p) => ({ id: p.id, nickname: p.nickname }))}
      units={(unitsResult.data ?? []).map((u) => ({
        id: u.id,
        propertyId: u.property_id,
        unitLabel: u.unit_label,
        status: u.status as 'vacant' | 'occupied' | 'maintenance',
      }))}
    />
  );
}
