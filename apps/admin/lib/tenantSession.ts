import 'server-only';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabaseClient } from './supabase/server';

/** Cookie holding the caller's currently-selected tenancy when they hold more than one (WORKLOG.md
 * this date, tenant invitation + entitlement architecture). Never trusted as an access grant by
 * itself -- resolveTenantSession() always re-validates the cookie's value against the caller's OWN
 * `tenants` rows before using it, so a tampered cookie can at most select the wrong (still their
 * own) tenancy, never another tenant's. */
const ACTIVE_TENANT_COOKIE = 'active_tenant_id';

/**
 * Resolves the tenant-portal identity of the authenticated caller. This is the third, independent
 * identity system alongside `resolvePortalSession()` (org staff) and `getAdminSession()` (platform
 * staff) -- PERMISSIONS.md's "never merge role systems" principle applies here exactly as it does
 * to owner identities: a tenant session is checked on its own, never folded into `PortalSession`.
 *
 * UX-layer only, same disclaimer as `orgSession.ts`: RLS (`caller_tenant_ids()` /
 * `caller_is_tenant_of_lease()`, migration 20260101000049) is the actual enforcement. This module
 * returning a wrong answer produces a wrong UI (e.g. a missing nav link, or a page-level query
 * that isn't correctly scoped to the active tenancy), not a data breach -- every tenant-portal
 * page/route still queries through the caller's own session-bound client, so a bug here cannot
 * expose another tenant's row; it can only mis-render what the caller's own RLS already permits.
 */

/** One tenancy relationship the caller holds, with just enough org/property/unit/lease context
 * for the switcher UI and page-level scoping to work without a second round trip per page
 * (WORKLOG.md this date, multi-tenancy scoping pass). Deliberately NOT the full lease/rent/
 * document payload -- each page still loads its own detail scoped by `leaseId`/`tenantId`; this
 * is just enough to LABEL a tenancy ("Musgrave Flats — Unit 601") and to filter by. */
export interface TenancySummary {
  tenantId: string;
  orgId: string;
  orgName: string | null;
  propertyId: string | null;
  propertyNickname: string | null;
  unitId: string | null;
  unitLabel: string | null;
  leaseId: string | null;
  leaseStatus: 'draft' | 'active' | 'expired' | 'terminated' | null;
  /** tenants.status === 'active' AND the tenancy's own lease.status === 'active' -- both must
   * hold for a tenancy to count as "current" rather than "historical" (Phase 11: ended/historical
   * tenancies must never silently become the auto-selected default, and the switcher can group by
   * this). */
  isActive: boolean;
}

export interface TenantSession {
  userId: string;
  tenantId: string;
  orgId: string;
  propertyId: string | null;
  propertyNickname: string | null;
  unitId: string | null;
  unitLabel: string | null;
  leaseId: string | null;
  /** Every tenancy the caller holds, INCLUDING the currently-active one (unlike the old
   * `otherTenancyIds`, which the switcher UI would otherwise have to reassemble by hand). Ordered
   * active tenancies first, each group by most recently created. */
  tenancies: TenancySummary[];
}

interface TenantQueryRow {
  id: string;
  org_id: string;
  status: string;
  organizations: { trading_name: string | null; legal_name: string } | null;
  lease_tenants: {
    lease_id: string;
    leases: {
      id: string;
      status: string;
      start_date: string;
      unit_id: string;
      units: {
        id: string;
        unit_label: string;
        property_id: string;
        properties: { id: string; nickname: string } | null;
      } | null;
    } | null;
  }[];
}

function summarize(row: TenantQueryRow): TenancySummary {
  const leaseRows = row.lease_tenants
    .map((lt) => lt.leases)
    .filter((l): l is NonNullable<typeof l> => l !== null);
  // Same "prefer the active lease, else most recent" rule already established in
  // POST /api/v1/tenant-portal/maintenance-tickets -- a tenant record can accumulate more than
  // one lease over time (renewals, or a fixed-term lease that ended); the active one is the
  // correct one to summarize/scope by, a `.find()` over an arbitrary DB return order is not.
  const activeLease = leaseRows.find((l) => l.status === 'active');
  const mostRecentLease = leaseRows
    .slice()
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  const lease = activeLease ?? mostRecentLease ?? null;
  const unit = lease?.units ?? null;
  const property = unit?.properties ?? null;

  return {
    tenantId: row.id,
    orgId: row.org_id,
    orgName: row.organizations?.trading_name ?? row.organizations?.legal_name ?? null,
    propertyId: property?.id ?? null,
    propertyNickname: property?.nickname ?? null,
    unitId: unit?.id ?? null,
    unitLabel: unit?.unit_label ?? null,
    leaseId: lease?.id ?? null,
    leaseStatus: (lease?.status as TenancySummary['leaseStatus']) ?? null,
    isActive: row.status === 'active' && lease?.status === 'active',
  };
}

/**
 * Returns `null` if there is no authenticated session, or the session has no `tenants` row with
 * `user_id` set to the caller (i.e. is not a tenant portal identity at all) -- never throws for
 * "not a tenant," since that's the expected case for every org-staff/owner caller.
 *
 * Multi-tenancy aware (WORKLOG.md this date): fetches every tenancy the caller is linked to
 * (previously `.limit(1)`, silently picking one and hiding the rest -- explicitly called out as
 * "out of scope for V1" at the time). The active one is chosen by, in order: (1) the
 * `active_tenant_id` cookie IF it names one of the caller's own tenancies (never trusted blindly
 * -- re-validated against this exact query's own results, so a tampered/stale/no-longer-linked
 * cookie value is silently ignored, not an error or a crash); (2) the first tenancy with an
 * active lease AND an active tenant status (Phase 11: never auto-select an ended tenancy over a
 * genuinely current one); (3) the first tenancy found at all, preserving the original default for
 * a caller whose only tenancy has already ended.
 */
export async function resolveTenantSession(): Promise<TenantSession | null> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from('tenants')
    .select(
      `id, org_id, status,
       organizations(trading_name, legal_name),
       lease_tenants(lease_id, leases(id, status, start_date, unit_id, units(id, unit_label, property_id, properties(id, nickname))))`,
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to resolve tenant session: ${error.message}`);
  }
  if (!data || data.length === 0) return null;

  const tenancies = (data as unknown as TenantQueryRow[]).map(summarize);

  const cookieStore = await cookies();
  const preferredTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
  const preferredTenancy = preferredTenantId
    ? tenancies.find((t) => t.tenantId === preferredTenantId)
    : undefined;
  const activeTenancy = preferredTenancy ?? tenancies.find((t) => t.isActive) ?? tenancies[0]!;

  return {
    userId: user.id,
    tenantId: activeTenancy.tenantId,
    orgId: activeTenancy.orgId,
    propertyId: activeTenancy.propertyId,
    propertyNickname: activeTenancy.propertyNickname,
    unitId: activeTenancy.unitId,
    unitLabel: activeTenancy.unitLabel,
    leaseId: activeTenancy.leaseId,
    tenancies,
  };
}

/**
 * Every lease id belonging to ONE tenant record (`lease_tenants.tenant_id`) -- a single tenancy
 * can span more than one lease row over time (a renewal, or a fixed-term lease that ended and was
 * replaced), and /my-lease's own copy ("current and past lease agreements") and /my-payments both
 * intentionally show that tenancy's full history, not just its single current lease. Callers scope
 * their own table's `.in('lease_id', leaseIds)` (or `.in('id', leaseIds)` for `leases` itself)
 * with this -- RLS still independently enforces that every returned row is one the caller is
 * actually allowed to see; this only narrows WHICH of the caller's own rows apply to the currently
 * active tenancy, never widens access.
 */
export async function getTenancyLeaseIds(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('lease_tenants')
    .select('lease_id')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Failed to resolve tenancy leases: ${error.message}`);
  return (data ?? []).map((row) => row.lease_id as string);
}
