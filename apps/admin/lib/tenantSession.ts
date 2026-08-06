import 'server-only';
import { getServerSupabaseClient } from './supabase/server';

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
}

/**
 * Returns `null` if there is no authenticated session, or the session has no `tenants` row with
 * `user_id` set to the caller (i.e. is not a tenant portal identity at all) -- never throws for
 * "not a tenant," since that's the expected case for every org-staff/owner caller.
 */
export async function resolveTenantSession(): Promise<TenantSession | null> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // `.limit(1)` rather than `.maybeSingle()`: the schema doesn't prevent a user having tenant
  // rows in more than one org (`caller_tenant_ids()`'s own comment, migration
  // 20260101000049) and `.maybeSingle()` would throw on a second row instead of just picking one.
  // A tenant with rows in multiple orgs is an out-of-scope edge case for a V1 single-context
  // portal session, not an error condition.
  const { data, error } = await supabase
    .from('tenants')
    .select('id, org_id')
    .eq('user_id', user.id)
    .limit(1);

  if (error) {
    throw new Error(`Failed to resolve tenant session: ${error.message}`);
  }
  const tenantRow = data?.[0];
  if (!tenantRow) return null;

  return {
    userId: user.id,
    tenantId: tenantRow.id as string,
    orgId: tenantRow.org_id as string,
  };
}
