import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/auth';
import { resolvePortalSession } from '@/lib/orgSession';
import { resolveTenantSession } from '@/lib/tenantSession';
import { resolveOwnerSession } from '@/lib/ownerSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export const dynamic = 'force-dynamic';

/**
 * Real bug found and fixed 2026-08-01 (DECISIONS.md): this previously checked only
 * `getAdminSession()` (platform-admin auth) — a signed-in client-org member (org membership, no
 * platform_admin_users row) fell through to '/login', and even if sent to '/overview' directly,
 * that route group's own layout requires `getAdminSession()` too and would bounce them straight
 * back to '/login'. There was no reachable landing page for a client-org user at all. Now checks
 * every independent session type (PERMISSIONS.md's "never merge role systems" — checked here,
 * not merged into one lookup) and routes to whichever applies.
 *
 * Extended 2026-08-01 (DECISIONS.md, tenant portal V1 scope correction) with a third check for a
 * tenant-portal identity, same pattern as the org-staff check added just above it.
 *
 * Extended 2026-08-05 (Phase 5, commercial-launch execution plan) with a fourth check for an
 * owner-portal identity, checked last — an org-staff or tenant identity takes priority if the
 * caller happens to hold more than one (the same person could plausibly be an org member AND a
 * separate owner record; org staff access is the more privileged, more frequently used context).
 *
 * Extended again this date (Stage 6, commercial-launch execution plan) with a fifth case, found
 * by a real Playwright test flaking on it, not by inspection: a genuinely authenticated user
 * (`resolvePortalSession()` returns non-null) with zero organizations/tenant/owner identity of
 * any kind — a real state for a just-confirmed signup that arrives here before ever creating an
 * organization — used to fall all the way through to '/login', bouncing a legitimately signed-in
 * user back to the sign-in form with no path forward. Now sent to onboarding instead, the only
 * meaningful next step for someone authenticated with nothing yet.
 *
 * Demo mode is unchanged: `getAdminSession()` always returns a fixed session in demo mode (no
 * live Supabase project to check), so this always resolves to '/overview' there, exactly as
 * before this fix — demo mode has one deliberate, working entry point, not two.
 */
export default async function RootPage() {
  const adminSession = await getAdminSession();
  if (adminSession) redirect('/overview');

  if (!ADMIN_DEMO_MODE) {
    const portalSession = await resolvePortalSession();
    const hasActiveOrg = portalSession?.organizations.some((m) => m.status === 'active');
    if (hasActiveOrg) redirect('/dashboard');

    const tenantSession = await resolveTenantSession();
    if (tenantSession) redirect('/portal');

    const ownerSession = await resolveOwnerSession();
    if (ownerSession) redirect('/owner-portal');

    if (portalSession) redirect('/onboarding/create-organization');
  }

  redirect('/login');
}
