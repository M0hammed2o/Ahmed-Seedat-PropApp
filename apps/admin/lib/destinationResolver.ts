import 'server-only';
import { getAdminSession } from './auth';
import { resolvePortalSession } from './orgSession';
import { resolveTenantSession } from './tenantSession';
import { resolveOwnerSession } from './ownerSession';

export interface AuthenticatedDestination {
  kind:
    | 'platform-admin'
    | 'org-dashboard'
    | 'org-restricted'
    | 'tenant-portal'
    | 'owner-portal'
    | 'onboarding';
  path: string;
}

/**
 * Single source of truth for "where does this authenticated caller belong" -- every place that
 * needs to answer that question (the root page, and anywhere post-auth that used to guess its own
 * destination) calls this instead of re-deriving the priority order independently. Consolidates
 * what was previously only `app/page.tsx`'s own logic (PERMISSIONS.md's "never merge role
 * systems" is still respected -- each session type is still resolved by its own independent
 * function; this only centralizes the *priority order* they're checked in).
 *
 * Priority, unchanged from the pre-existing root-page logic this replaces: platform admin >
 * active org membership (dashboard, or access-restricted if every active membership's org is
 * itself suspended/cancelled) > tenant > owner > authenticated-with-no-identity (onboarding).
 *
 * Returns `null` only for a genuinely unauthenticated caller -- the root page is the only caller
 * that needs to distinguish "no destination because not signed in" (show the public landing page)
 * from any of the authenticated cases above.
 */
export async function resolveAuthenticatedDestination(): Promise<AuthenticatedDestination | null> {
  const adminSession = await getAdminSession();
  if (adminSession) return { kind: 'platform-admin', path: '/overview' };

  const portalSession = await resolvePortalSession();
  const activeMemberships = portalSession?.organizations.filter((m) => m.status === 'active') ?? [];
  if (activeMemberships.length > 0) {
    // A caller with more than one org membership only lands on the restricted page if EVERY
    // active membership's org is itself suspended/cancelled -- one usable org is enough to reach
    // the dashboard, which has its own org-switcher and can surface a specific org's restricted
    // state within that context rather than blocking access to an unrelated, unaffected org.
    const hasUsableOrg = activeMemberships.some(
      (m) => m.orgStatus !== 'suspended' && m.orgStatus !== 'cancelled',
    );
    return hasUsableOrg
      ? { kind: 'org-dashboard', path: '/dashboard' }
      : { kind: 'org-restricted', path: '/access-restricted' };
  }

  const tenantSession = await resolveTenantSession();
  if (tenantSession) return { kind: 'tenant-portal', path: '/portal' };

  const ownerSession = await resolveOwnerSession();
  if (ownerSession) return { kind: 'owner-portal', path: '/owner-portal' };

  if (portalSession) return { kind: 'onboarding', path: '/onboarding/create-organization' };

  return null;
}
