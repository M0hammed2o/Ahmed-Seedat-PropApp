import Link from 'next/link';
import type { Tenant } from '@propvault/types';
import { TenantsFilterClient } from '@/components/tables/TenantsFilterClient';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTenantRow, pickCurrentLease, type TenancyContext } from '@/lib/leasing';
import { deriveTenantPortalStatus } from '@/lib/tenantPortalStatus';
import type { TenantPortalStatusResult } from '@/lib/tenantPortalStatus';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export interface TenantWithTenancy extends Tenant {
  tenancy: TenancyContext | null;
  portalStatus: TenantPortalStatusResult;
}

const DEMO_TENANTS: TenantWithTenancy[] = [
  {
    id: 'demo-tenant-1',
    orgId: 'demo-org-1',
    userId: null,
    fullName: 'Naledi Khumalo',
    email: 'naledi@example.com',
    phone: '+27 82 555 0134',
    idNumberRef: null,
    status: 'active',
    createdAt: '2026-06-05T00:00:00Z',
    updatedAt: '2026-06-05T00:00:00Z',
    tenancy: {
      leaseId: 'demo-lease-1',
      leaseStatus: 'active',
      startDate: '2025-09-01',
      endDate: '2026-08-31',
      rentAmount: 12500,
      rentFrequency: 'monthly',
      unitId: 'demo-unit-1',
      unitLabel: 'Unit 1',
      propertyId: 'demo-property-1',
      propertyNickname: 'Sea Point Apartment',
    },
    portalStatus: { status: 'not_invited', label: 'Not invited' },
  },
];

/**
 * GET /tenants -- third module in the (dashboard) vertical-slice sequence (TASKS.md M20), same
 * "plain RLS-protected read" pattern as /properties (tenants_select_org_or_self scopes this to
 * the caller's org memberships automatically).
 *
 * Tenant/occupancy V1 pass: the bare tenant list previously gave no way to tell WHICH
 * property/unit a tenant currently belongs to without opening each one individually -- a real
 * problem for any landlord managing more than a handful of tenants. Now embeds each tenant's
 * current lease -> unit -> property (via lease_tenants, the real join table -- DATABASE.md §4;
 * tenants.property_id/unit_id do NOT exist and this deliberately does not add them, see
 * pickCurrentLease's own comment) and portal-invitation status in one query. RLS on `leases`/
 * `units`/`properties` (20260101000064/65/66) applies to this embed exactly as it would to a
 * direct query against those tables -- PostgREST enforces each embedded table's own policies, not
 * just the root `tenants` policy -- so this cannot leak another org's property/unit labels.
 */
export default async function TenantsPage() {
  const tenants: TenantWithTenancy[] = ADMIN_DEMO_MODE ? DEMO_TENANTS : await loadTenants();
  const canCreate = ADMIN_DEMO_MODE ? true : await resolveCanCreate();

  const addAction = (
    <Link href="/tenants/new">
      <Button variant="primary" size="sm">
        + Add tenant
      </Button>
    </Link>
  );

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Tenants"
        subtitle={`${tenants.length} ${tenants.length === 1 ? 'tenant' : 'tenants'} across your portfolio.`}
        actions={canCreate && tenants.length > 0 ? addAction : undefined}
      />
      <TenantsFilterClient tenants={tenants} emptyAction={canCreate ? addAction : undefined} />
    </div>
  );
}

interface TenantWithTenancyRow {
  id: string;
  org_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_number_ref: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  lease_tenants: {
    leases: {
      id: string;
      status: string;
      start_date: string;
      end_date: string | null;
      rent_amount: number;
      rent_frequency: string;
      unit_id: string;
      units: {
        unit_label: string;
        properties: { id: string; nickname: string } | null;
      } | null;
    } | null;
  }[];
  tenant_invitations: {
    accepted_at: string | null;
    revoked_at: string | null;
    expires_at: string;
    created_at: string;
  }[];
}

async function loadTenants(): Promise<TenantWithTenancy[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('tenants')
    .select(
      `*,
      lease_tenants(leases(id, status, start_date, end_date, rent_amount, rent_frequency, unit_id, units(unit_label, properties(id, nickname)))),
      tenant_invitations(accepted_at, revoked_at, expires_at, created_at)`,
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load tenants: ${error.message}`);

  return ((data ?? []) as unknown as TenantWithTenancyRow[]).map((row) => {
    const tenant = mapTenantRow(row);
    const leaseCandidates: (TenancyContext & { status: string })[] = [];
    for (const lt of row.lease_tenants) {
      const lease = lt.leases;
      const property = lease?.units?.properties;
      if (!lease || !lease.units || !property) continue;
      leaseCandidates.push({
        leaseId: lease.id,
        leaseStatus: lease.status,
        status: lease.status,
        startDate: lease.start_date,
        endDate: lease.end_date,
        rentAmount: lease.rent_amount,
        rentFrequency: lease.rent_frequency,
        unitId: lease.unit_id,
        unitLabel: lease.units.unit_label,
        propertyId: property.id,
        propertyNickname: property.nickname,
      });
    }

    const { current } = pickCurrentLease(leaseCandidates);
    const tenancy: TenancyContext | null = current;

    const portalStatus = deriveTenantPortalStatus(
      tenant.userId,
      row.tenant_invitations.map((i) => ({
        acceptedAt: i.accepted_at,
        revokedAt: i.revoked_at,
        expiresAt: i.expires_at,
        createdAt: i.created_at,
      })),
    );

    return { ...tenant, tenancy, portalStatus };
  });
}

async function resolveCanCreate(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && canWriteOrgRecords(membership.role));
}
