import 'server-only';
import { getAdminGateStatus } from './auth';
import { resolvePortalSession, type OrgMembership } from './orgSession';
import { resolveTenantSession } from './tenantSession';
import { resolveOwnerSession } from './ownerSession';
import { hasAcceptedCurrentLegalTerms } from './legalConsent';
import { isProfileComplete } from './profileCompletion';
import { getServerSupabaseClient } from './supabase/server';

export interface AuthenticatedDestination {
  kind:
    | 'platform-admin'
    | 'legal-consent'
    | 'profile-incomplete'
    | 'commercial-setup'
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
 *
 * Production signup/onboarding (WORKLOG.md this date) adds two more steps -- legal consent and
 * profile completion -- ahead of the two customer-track outcomes only (`org-dashboard` and
 * `onboarding`). Deliberately scoped there and nowhere else:
 * - Platform admin is checked first and returns immediately, same as before -- Super Admin must
 *   stay completely separated from customer onboarding, per PERMISSIONS.md.
 * - Tenant/owner sessions are unaffected -- they're invited into an existing org/lease via a
 *   dedicated activation flow (`/activate`, `/invitations/accept`), not the signup journey this
 *   work is about, and gating them here risked breaking their own, separately-tested continuation
 *   flows for no product reason this task asked for.
 * - `org-restricted` is unaffected -- it's a dead-end informational page for a suspended org;
 *   there's nothing to "complete" from there.
 *
 * Order (consent before profile, both before org/onboarding routing) is deliberate: consent is a
 * compliance gate that should hold before anything else about the account is asked for; profile
 * completion is a product-UX step layered on top of that, not the other way round. Applies to
 * EVERY customer-track caller who reaches this point, not just brand-new signups -- an existing
 * account that predates this feature (profile_completed_at is null) is asked to complete it on
 * its next login too, matching "profile completion only if genuinely incomplete" for returning
 * users, not "only if created after this shipped".
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
    if (!hasUsableOrg) return { kind: 'org-restricted', path: '/access-restricted' };

    const customerGate = await resolveCustomerOnboardingGate(activeMemberships);
    if (customerGate) return customerGate;
    return { kind: 'org-dashboard', path: '/dashboard' };
  }

  const tenantSession = await resolveTenantSession();
  if (tenantSession) return { kind: 'tenant-portal', path: '/portal' };

  const ownerSession = await resolveOwnerSession();
  if (ownerSession) return { kind: 'owner-portal', path: '/owner-portal' };

  if (portalSession) {
    const customerGate = await resolveCustomerOnboardingGate(portalSession.organizations);
    if (customerGate) return customerGate;
    return { kind: 'onboarding', path: '/onboarding/create-organization' };
  }

  return null;
}

/**
 * Commercial plan restructure -- adds a third, org-scoped gate step (after consent and profile
 * completion, before dashboard/onboarding): a principal of an organization that has not yet
 * completed payment-method setup (organizations.commercial_setup_completed_at is null) is routed
 * to billing setup instead of the dashboard. Scoped to PRINCIPAL memberships only -- an invited
 * staff member or owner is never blocked by an org they don't own the billing for; in practice
 * that can't happen yet anyway, since staff invitations aren't offered until after commercial
 * setup completes, but this stays correct even so. Every pre-existing organization was backfilled
 * to a non-null commercial_setup_completed_at (20260101000114), so this is a no-op for all of
 * them -- it only ever applies to an org created after that migration whose principal has not yet
 * finished setup. This is the application-level enforcement point; see migration
 * 20260101000116's own comment for why the equivalent RLS-level restriction was attempted and
 * reverted this session (broke ~40 unrelated pgTAP fixtures) -- disclosed, not silent.
 */
async function hasIncompleteCommercialSetup(principalOrgIds: string[]): Promise<boolean> {
  if (principalOrgIds.length === 0) return false;
  const supabase = await getServerSupabaseClient();
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .in('id', principalOrgIds)
    .is('commercial_setup_completed_at', null)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function resolveCustomerOnboardingGate(
  memberships: OrgMembership[] = [],
): Promise<AuthenticatedDestination | null> {
  if (!(await hasAcceptedCurrentLegalTerms())) {
    return { kind: 'legal-consent', path: '/legal-consent' };
  }
  if (!(await isProfileComplete())) {
    return { kind: 'profile-incomplete', path: '/complete-account' };
  }
  const principalOrgIds = memberships.filter((m) => m.role === 'principal').map((m) => m.orgId);
  if (await hasIncompleteCommercialSetup(principalOrgIds)) {
    return { kind: 'commercial-setup', path: '/organization/billing/setup' };
  }
  return null;
}
