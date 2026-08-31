import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { ManualInvoiceForm, type TenancyOption } from '@/components/accounting/ManualInvoiceForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

/**
 * GET /accounting/invoices/new -- overnight V1 completion pass, Part B. Property filters Unit;
 * Unit filters Tenant, where "Tenant" is scoped to tenants who actually have a lease on that unit
 * (current lease resolved here, preferring active over historical, one per tenant per unit) --
 * never a free-text tenant picker disconnected from real tenancy.
 */
export default async function NewManualInvoicePage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-6 animate-rise">
        <PageHeader title="Create invoice" subtitle="A one-off charge to a tenant -- separate from rent." />
        <ManualInvoiceForm
          orgId="demo-org-1"
          properties={[{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }]}
          units={[{ id: 'demo-unit-1', propertyId: 'demo-property-1', unitLabel: 'Unit 1', status: 'occupied' }]}
          tenancies={[
            { unitId: 'demo-unit-1', tenantId: 'demo-tenant-1', tenantName: 'Naledi Khumalo', leaseId: 'demo-lease-1' },
          ]}
        />
      </div>
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');
  const membership = findActiveMembership(session, activeOrg.orgId);
  if (!membership || !canPostAccountingRecords(membership.role)) redirect('/accounting/invoices');

  const supabase = await getServerSupabaseClient();

  const [propertiesResult, unitsResult, leaseTenantsResult] = await Promise.all([
    supabase
      .from('properties')
      .select('id, nickname')
      .eq('org_id', activeOrg.orgId)
      .eq('status', 'active')
      .order('nickname', { ascending: true }),
    supabase
      .from('units')
      .select('id, property_id, unit_label, status')
      .eq('org_id', activeOrg.orgId)
      .order('unit_label', { ascending: true }),
    supabase
      .from('lease_tenants')
      .select('tenant_id, tenants(full_name), leases(id, status, start_date, unit_id, org_id)'),
  ]);
  if (propertiesResult.error) throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (unitsResult.error) throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  if (leaseTenantsResult.error) throw new Error(`Failed to load tenancies: ${leaseTenantsResult.error.message}`);

  type LeaseTenantRow = {
    tenant_id: string;
    tenants: { full_name: string } | null;
    leases: { id: string; status: string; start_date: string; unit_id: string; org_id: string } | null;
  };
  const rows = (leaseTenantsResult.data ?? []) as unknown as LeaseTenantRow[];

  // One (tenant, unit) pair -> its most current lease (active wins, else most recently started) --
  // the same rule lib/leasing.ts's pickCurrentLease() applies for a tenant's overall current
  // tenancy, scoped here per-unit since a tenant could theoretically have leased the same unit more
  // than once over time.
  const byTenantUnit = new Map<string, { leaseId: string; status: string; startDate: string; tenantName: string }>();
  for (const row of rows) {
    if (!row.leases || row.leases.org_id !== activeOrg.orgId) continue;
    const key = `${row.tenant_id}:${row.leases.unit_id}`;
    const existing = byTenantUnit.get(key);
    const candidate = {
      leaseId: row.leases.id,
      status: row.leases.status,
      startDate: row.leases.start_date,
      tenantName: row.tenants?.full_name ?? 'Unknown tenant',
    };
    if (!existing) {
      byTenantUnit.set(key, candidate);
    } else if (candidate.status === 'active' && existing.status !== 'active') {
      byTenantUnit.set(key, candidate);
    } else if (
      candidate.status === existing.status &&
      new Date(candidate.startDate).getTime() > new Date(existing.startDate).getTime()
    ) {
      byTenantUnit.set(key, candidate);
    }
  }

  const tenancies: TenancyOption[] = [...byTenantUnit.entries()].map(([key, v]) => {
    const [tenantId, unitId] = key.split(':');
    return { unitId: unitId!, tenantId: tenantId!, tenantName: v.tenantName, leaseId: v.leaseId };
  });

  return (
    <div className="space-y-6 animate-rise">
      <PageHeader title="Create invoice" subtitle="A one-off charge to a tenant -- separate from rent." />
      <ManualInvoiceForm
        orgId={activeOrg.orgId}
        properties={propertiesResult.data ?? []}
        units={(unitsResult.data ?? []).map((u) => ({
          id: u.id,
          propertyId: u.property_id,
          unitLabel: u.unit_label,
          status: u.status,
        }))}
        tenancies={tenancies}
      />
    </div>
  );
}
