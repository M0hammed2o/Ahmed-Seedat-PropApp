import 'server-only';
import { cookies } from 'next/headers';
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
 * returning a wrong answer produces a wrong UI (e.g. a missing nav link), not a data breach --
 * every tenant-portal page still queries through the caller's own session-bound client, so a bug
 * here cannot expose another tenant's row.
 */

export interface TenantSession {
  userId: string;
  tenantId: string;
  orgId: string;
  /** The caller's OTHER tenancy ids (multi-tenancy architecture, WORKLOG.md this date) -- e.g.
   * Ahmed renting Musgrave Flats Unit 601 AND, later, Another Building Unit 4, possibly under a
   * different organization entirely. Empty for the common single-tenancy case. A page that wants
   * to offer switching reads this list and links through
   * `POST /api/v1/tenant-portal/switch-tenancy`; nothing renders automatically here since this
   * module is session RESOLUTION, not UI. */
  otherTenancyIds: string[];
}

/**
 * Returns `null` if there is no authenticated session, or the session has no `tenants` row with
 * `user_id` set to the caller (i.e. is not a tenant portal identity at all) -- never throws for
 * "not a tenant," since that's the expected case for every org-staff/owner caller.
 *
 * Multi-tenancy aware (WORKLOG.md this date): fetches every tenancy the caller is linked to
 * (previously `.limit(1)`, silently picking one and hiding the rest -- explicitly called out as
 * "out of scope for V1" at the time). The active one is chosen by, in order: the
 * `active_tenant_id` cookie IF it names one of the caller's own tenancies (never trusted blindly
 * -- re-validated against this exact query's own results, so a tampered/stale cookie value that
 * doesn't match any of the caller's rows is silently ignored, not an error), else the first
 * tenancy found -- preserving the exact previous default for the common single-tenancy case.
 */
export async function resolveTenantSession(): Promise<TenantSession | null> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from('tenants')
    .select('id, org_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to resolve tenant session: ${error.message}`);
  }
  if (!data || data.length === 0) return null;

  const cookieStore = await cookies();
  const preferredTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
  const preferredRow = preferredTenantId
    ? data.find((row) => row.id === preferredTenantId)
    : undefined;
  const activeRow = preferredRow ?? data[0]!;

  return {
    userId: user.id,
    tenantId: activeRow.id as string,
    orgId: activeRow.org_id as string,
    otherTenancyIds: data.filter((row) => row.id !== activeRow.id).map((row) => row.id as string),
  };
}
