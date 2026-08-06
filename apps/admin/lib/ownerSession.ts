import 'server-only';
import { getServerSupabaseClient } from './supabase/server';

/**
 * Resolves the owner-portal identity of the authenticated caller (Phase 5, commercial-launch
 * execution plan, WORKLOG.md 2026-08-05). A fourth, independent identity system alongside
 * `resolvePortalSession()` (org staff), `resolveTenantSession()` (tenant), and `getAdminSession()`
 * (platform staff) — PERMISSIONS.md's "never merge role systems" applies here exactly as it does
 * to the other three. Deliberately NOT the same thing as `PortalSession.ownerIdentities`
 * (`orgSession.ts`) — that field tells an org-STAFF member which owner records happen to link to
 * them (a badge on top of a staff session); this module resolves a genuine, standalone owner
 * session for someone who may hold no staff role at all, mirroring `resolveTenantSession()`'s
 * shape and reasoning precisely.
 *
 * UX-layer only, same disclaimer as `tenantSession.ts`/`orgSession.ts`: RLS
 * (`has_property_access(property_id, 'owner')`, migration 20260101000072) is the actual
 * enforcement. This module returning a wrong answer produces a wrong UI, not a data breach —
 * every owner-portal page still queries through the caller's own session-bound client.
 */

export interface OwnerSession {
  userId: string;
  ownerId: string;
  orgId: string;
}

/**
 * Returns `null` if there is no authenticated session, or the session has no `owners` row with
 * `user_id` set to the caller — never throws for "not an owner," since that's the expected case
 * for every org-staff/tenant caller.
 */
export async function resolveOwnerSession(): Promise<OwnerSession | null> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // `.limit(1)` rather than `.maybeSingle()`: nothing in the schema prevents an owner having
  // records in more than one org (same reasoning as tenants) — a second row is an out-of-scope
  // edge case for a V1 single-context portal session, not an error condition.
  const { data, error } = await supabase
    .from('owners')
    .select('id, org_id')
    .eq('user_id', user.id)
    .limit(1);

  if (error) {
    throw new Error(`Failed to resolve owner session: ${error.message}`);
  }
  const ownerRow = data?.[0];
  if (!ownerRow) return null;

  return {
    userId: user.id,
    ownerId: ownerRow.id as string,
    orgId: ownerRow.org_id as string,
  };
}
