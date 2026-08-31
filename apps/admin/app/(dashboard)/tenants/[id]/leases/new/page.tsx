import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { TenantLeasePropertyPicker } from '@/components/tenants/TenantLeasePropertyPicker';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /tenants/:id/leases/new (overnight V1 completion pass, Part A gap 2). A thin property/unit
 * picker for a tenant with no lease yet -- the moment both are chosen it hands off to the
 * EXISTING, unit-scoped lease-creation choice page (/properties/:id/units/:unitId/leases/new),
 * carrying `?tenantId=` so the tenant is preselected there exactly as it already is when this
 * same choice page is reached from Add Tenant's own property/unit fields. No new lease
 * architecture -- this page only ever decides WHICH existing flow to hand off to.
 */
export default async function TenantNewLeasePage({ params }: RouteParams) {
  const { id: tenantId } = await params;

  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-6 animate-rise">
        <Link
          href={`/tenants/${tenantId}`}
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to tenant
        </Link>
        <PageHeader title="Add lease" subtitle="Where does this tenant live?" />
        <TenantLeasePropertyPicker
          tenantId={tenantId}
          properties={[{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }]}
          units={[{ id: 'demo-unit-1', propertyId: 'demo-property-1', unitLabel: 'Unit 1', status: 'vacant' }]}
        />
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, org_id, full_name')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantError) throw new Error(`Failed to load tenant: ${tenantError.message}`);
  if (!tenant) notFound();

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const membership = findActiveMembership(session, tenant.org_id);
  const canCreate = membership && canWriteOrgRecords(membership.role);
  if (!canCreate) redirect(`/tenants/${tenantId}`);

  const [propertiesResult, unitsResult] = await Promise.all([
    supabase
      .from('properties')
      .select('id, nickname')
      .eq('org_id', tenant.org_id)
      .eq('status', 'active')
      .order('nickname', { ascending: true }),
    supabase
      .from('units')
      .select('id, property_id, unit_label, status')
      .eq('org_id', tenant.org_id)
      .order('unit_label', { ascending: true }),
  ]);
  if (propertiesResult.error)
    throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);

  return (
    <div className="space-y-6 animate-rise">
      <Link
        href={`/tenants/${tenantId}`}
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to tenant
      </Link>
      <PageHeader title="Add lease" subtitle={`Where does ${tenant.full_name} live?`} />
      <TenantLeasePropertyPicker
        tenantId={tenantId}
        properties={(propertiesResult.data ?? []).map((p) => ({ id: p.id, nickname: p.nickname }))}
        units={(unitsResult.data ?? []).map((u) => ({
          id: u.id,
          propertyId: u.property_id,
          unitLabel: u.unit_label,
          status: u.status as 'vacant' | 'occupied' | 'maintenance' | 'archived',
        }))}
      />
    </div>
  );
}
