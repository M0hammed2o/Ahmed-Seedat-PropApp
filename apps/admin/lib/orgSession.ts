import 'server-only';
import type { OrganizationMemberRole } from '@propvault/types';
import { getServerSupabaseClient } from './supabase/server';

/**
 * Resolves the full multi-portal identity of the authenticated caller — per ARCHITECTURE.md's
 * "Multi-tenancy model" and PERMISSIONS.md's intro: a single human can simultaneously hold
 * organization memberships (possibly in more than one org), an owner-portal identity, a
 * tenant-portal identity, and platform-admin privileges, and these are never merged into one
 * role field (PERMISSIONS.md — "never merge into one permission set; each is checked
 * independently for the resource being accessed").
 *
 * This is the API-layer half of PropertyVault's two-layer enforcement (ARCHITECTURE.md /
 * SECURITY.md "Multi-tenant trust boundaries") — it exists for fast, clear authorization
 * decisions and UX (which portals to show, which nav items to render), never as the actual
 * security boundary. RLS re-derives the identical scoping independently at the database layer
 * (DATABASE.md §12) and is what actually stops a compromised/buggy caller of this module from
 * reading data it shouldn't; this module returning a wrong answer would produce a wrong UI, not
 * a data breach.
 */

export interface OrgMembership {
  orgId: string;
  role: OrganizationMemberRole;
  status: 'invited' | 'active' | 'revoked';
}

export interface OwnerIdentity {
  ownerId: string;
  orgId: string;
}

// TenantIdentity intentionally not modeled yet — the `tenants` table doesn't exist until
// TASKS.md M8. Adding an empty/always-null field now would be speculative; PortalSession gains
// a `tenantIdentities` field in the same change that migration lands, not before.

export interface ActiveSupportSession {
  orgId: string;
  sessionId: string;
  startedAt: string;
}

export interface PortalSession {
  userId: string;
  organizations: OrgMembership[];
  ownerIdentities: OwnerIdentity[];
  isPlatformAdmin: boolean;
  /** Every org the caller currently holds an open (ended_at is null) support session against
   *  (PWA_V1_COMPLETION_PLAN.md #12, SUPER_ADMIN.md §6). Also synthesized into `organizations`
   *  below as a viewer-role entry so every existing (dashboard) page works read-only without
   *  each one needing its own support-mode branch -- this array exists separately so callers
   *  (the banner, in particular) can tell a synthesized entry apart from a real membership. */
  supportSessions: ActiveSupportSession[];
}

/**
 * Resolves every membership/identity for the currently authenticated session in one pass. This
 * queries with the caller's own session-bound client (`getServerSupabaseClient()`, not the
 * service-role client) — so even this "resolve everything" call is itself RLS-scoped: it can
 * only ever see the memberships/identities that actually belong to `auth.uid()`, which is
 * exactly what it's trying to enumerate, so there's no privilege step-up happening here.
 *
 * Returns `null` if there is no authenticated session at all (never throws for "not logged in" —
 * that's an expected, ordinary case for public/auth routes, not an error).
 */
export async function resolvePortalSession(): Promise<PortalSession | null> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [membershipsResult, ownersResult, supportSessionsResult] = await Promise.all([
    supabase.from('organization_members').select('org_id, role, status').eq('user_id', user.id),
    supabase.from('owners').select('id, org_id').eq('user_id', user.id),
    // RLS-scoped to the caller's own rows (support_access_sessions_select_own, migration
    // 20260101000057) -- zero rows for every non-admin caller, exactly like the platform-admin
    // count query below. Ordinary users never pay for this beyond one extra empty-result query.
    supabase
      .from('support_access_sessions')
      .select('id, org_id, started_at')
      .is('ended_at', null),
  ]);

  if (membershipsResult.error) {
    throw new Error(
      `Failed to resolve organization memberships: ${membershipsResult.error.message}`,
    );
  }
  if (ownersResult.error) {
    throw new Error(`Failed to resolve owner identities: ${ownersResult.error.message}`);
  }
  if (supportSessionsResult.error) {
    throw new Error(`Failed to resolve support sessions: ${supportSessionsResult.error.message}`);
  }

  // Platform-admin status is checked via the existing is_platform_admin() pattern
  // (ADMIN_DEMO_MODE-aware getAdminSession() in ./auth.ts) rather than duplicated here — a
  // caller that needs both a portal session and platform-admin status calls both functions,
  // since they're independent role systems by design (PERMISSIONS.md intro, ARCHITECTURE.md
  // "Why one web app, not two") and conflating their resolution into one function would be
  // exactly the anti-pattern those documents warn against. isPlatformAdmin here is a cheap
  // existence check only, not a role resolution — callers needing the actual platform role must
  // call requireRole()/getAdminSession() from ./auth.ts, which is the security-checked path.
  const { count: platformAdminCount } = await supabase
    .from('platform_admin_users')
    .select('id', { count: 'exact', head: true });

  const organizations: OrgMembership[] = (membershipsResult.data ?? []).map((row) => ({
    orgId: row.org_id as string,
    role: row.role as OrganizationMemberRole,
    status: row.status as 'invited' | 'active' | 'revoked',
  }));

  const supportSessions: ActiveSupportSession[] = (supportSessionsResult.data ?? []).map((row) => ({
    orgId: row.org_id as string,
    sessionId: row.id as string,
    startedAt: row.started_at as string,
  }));

  // Synthesize a viewer-role membership for any support-session org the caller has no real
  // membership in, so every existing (dashboard) page's `organizations.find(...)` keeps working
  // unmodified (SUPER_ADMIN.md §6: "scoped as if they held the viewer org role"). Never
  // overwrites a real membership if one somehow also exists (a platform admin who is also
  // legitimately an org staff member keeps their real role, not a downgrade).
  for (const s of supportSessions) {
    if (!organizations.some((m) => m.orgId === s.orgId)) {
      organizations.push({ orgId: s.orgId, role: 'viewer', status: 'active' });
    }
  }

  return {
    userId: user.id,
    organizations,
    ownerIdentities: (ownersResult.data ?? []).map((row) => ({
      ownerId: row.id as string,
      orgId: row.org_id as string,
    })),
    isPlatformAdmin: (platformAdminCount ?? 0) > 0,
    supportSessions,
  };
}

/**
 * Convenience narrowing for the common "does this user have at least one active membership in
 * this specific org" check — used by page-level guards before rendering an org-scoped screen.
 * Mirrors `has_org_role()`'s semantics (DATABASE.md § Org-role helper) at the API layer; the
 * database function remains the actual enforcement for every read/write, this is UX-layer only.
 */
export function findActiveMembership(
  session: PortalSession,
  orgId: string,
): OrgMembership | undefined {
  return session.organizations.find((m) => m.orgId === orgId && m.status === 'active');
}

/**
 * "agent or above" UI-layer gate, matching the threshold used by every non-Accounting module's
 * write actions this milestone (Units/Tenants/Leases/Maintenance/Owners/Applications/Inspections
 * — PERMISSIONS.md's "Properties/Units/Leases/Tenants"/"Applications"/"Maintenance" columns all
 * list agent as Full). Deliberately NOT a linear "rank >= agent" check — `has_org_role()`'s own
 * comment is explicit that agent and accountant are siblings, not ordered against each other, so
 * this checks exactly the roles PERMISSIONS.md actually grants, same as every inline check this
 * milestone already used before this helper existed.
 */
export function canWriteOrgRecords(role: OrganizationMemberRole): boolean {
  return role !== 'viewer' && role !== 'accountant';
}

/**
 * "accountant or above" UI-layer gate (PERMISSIONS.md's "Accounting (post)" column: accountant/
 * manager/principal = Full, agent/viewer = none) — the threshold every Accounting-module write
 * action needs (record an expense, issue an invoice from a rent schedule, post a journal entry).
 * Mirrors `has_org_role(org_id, 'accountant')`'s exact role list
 * (supabase/migrations/20260101000021_org_role_helpers.sql) rather than inventing a separate
 * "rank" -- the database function (called inside invoice_rent_schedule()/record_expense()/etc.,
 * a security-definer function's own internal check) remains the actual enforcement regardless of
 * what this returns; this is UX-layer only, same disclaimer as findActiveMembership above.
 */
export function canPostAccountingRecords(role: OrganizationMemberRole): boolean {
  return role === 'accountant' || role === 'manager' || role === 'principal';
}
