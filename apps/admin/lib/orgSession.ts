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

export interface PortalSession {
  userId: string;
  organizations: OrgMembership[];
  ownerIdentities: OwnerIdentity[];
  isPlatformAdmin: boolean;
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

  const [membershipsResult, ownersResult] = await Promise.all([
    supabase.from('organization_members').select('org_id, role, status').eq('user_id', user.id),
    supabase.from('owners').select('id, org_id').eq('user_id', user.id),
  ]);

  if (membershipsResult.error) {
    throw new Error(
      `Failed to resolve organization memberships: ${membershipsResult.error.message}`,
    );
  }
  if (ownersResult.error) {
    throw new Error(`Failed to resolve owner identities: ${ownersResult.error.message}`);
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

  return {
    userId: user.id,
    organizations: (membershipsResult.data ?? []).map((row) => ({
      orgId: row.org_id as string,
      role: row.role as OrganizationMemberRole,
      status: row.status as 'invited' | 'active' | 'revoked',
    })),
    ownerIdentities: (ownersResult.data ?? []).map((row) => ({
      ownerId: row.id as string,
      orgId: row.org_id as string,
    })),
    isPlatformAdmin: (platformAdminCount ?? 0) > 0,
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
