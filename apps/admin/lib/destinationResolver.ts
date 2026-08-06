import 'server-only';
import { getAdminGateStatus } from './auth';
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
 *
 * Real bug found and fixed by this session's own E2E suite (Super Admin separation, WORKLOG.md
 * this date), round 1: this used to call the AAL2-enforcing `getAdminSession()` -- a real platform
 * admin who hadn't completed MFA yet failed that check, fell through this function's ENTIRE
 * priority chain (no org/tenant/owner identity either), and landed on "onboarding" instead of the
 * Super Admin area at all. Fixed by switching to `getAdminSessionWithoutMfaCheck()` (routing on
 * identity alone, not authorization).
 *
 * Round 2, also live-caught via Playwright: sending every admin to `/platform-admin/overview` and
 * relying on the (super-admin) layout's own redirect to `/platform-admin/mfa-setup` for a
 * not-yet-AAL2 admin chains TWO server-side redirects (`/` -> overview -> mfa-setup) into one
 * client-router-initiated navigation (the common real path: right after
 * `router.refresh()`/`router.push('/')` on sign-in). That chained-redirect shape reproducibly left
 * the dev server (Next 16.2.11 + Turbopack) stuck re-fetching the same RSC payload every ~200ms
 * without ever committing content to the DOM -- confirmed by inspecting the actual client-side RSC
 * push data during the hang, which showed the browser still holding the ORIGINAL `/login` route
 * tree, never having swapped to the destination page. A single-hop full-page navigation through
 * the same layout redirect (e.g. a bookmarked `/platform-admin/overview` link) does not hit this --
 * it's specific to a client-side-initiated navigation chaining two redirects. Resolving AAL here
 * too and pointing not-yet-AAL2 admins straight at mfa-setup collapses that to one hop for the
 * common path; this function's job is still identity+auth-state ROUTING, not authorization -- the
 * (super-admin) layout remains the actual, sole enforcement point (re-checks both facts itself
 * rather than trusting this function's answer).
 */
export async function resolveAuthenticatedDestination(): Promise<AuthenticatedDestination | null> {
  const { session: adminSession, isAal2 } = await getAdminGateStatus();
  if (adminSession) {
    return {
      kind: 'platform-admin',
      path: isAal2 ? '/platform-admin/overview' : '/platform-admin/mfa-setup',
    };
  }

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
