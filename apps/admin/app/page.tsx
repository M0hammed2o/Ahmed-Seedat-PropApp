import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/auth';
import { resolvePortalSession } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export const dynamic = 'force-dynamic';

/**
 * Real bug found and fixed 2026-08-01 (DECISIONS.md): this previously checked only
 * `getAdminSession()` (platform-admin auth) — a signed-in client-org member (org membership, no
 * platform_admin_users row) fell through to '/login', and even if sent to '/overview' directly,
 * that route group's own layout requires `getAdminSession()` too and would bounce them straight
 * back to '/login'. There was no reachable landing page for a client-org user at all. Now checks
 * both independent session types (PERMISSIONS.md's "never merge role systems" — checked here,
 * not merged into one lookup) and routes to whichever applies.
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
  }

  redirect('/login');
}
