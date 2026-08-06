import { redirect } from 'next/navigation';
import { resolveAuthenticatedDestination } from '@/lib/destinationResolver';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { LandingPage } from '@/components/marketing/LandingPage';

export const dynamic = 'force-dynamic';

/**
 * Production routing fix (WORKLOG.md this date): `/` was previously a pure authenticated-role
 * router with no public branch at all -- any authenticated caller (most notably a platform admin,
 * e.g. staff checking the live site while signed into their own account) landed straight on
 * `/overview`, the internal admin dashboard, and a genuinely unauthenticated visitor fell through
 * to `/login`. Neither is a public marketing entry point; no public landing page existed anywhere
 * in this codebase to route to instead (confirmed by a repo-wide search before this was written).
 *
 * Now: every authenticated caller is still routed to their correct destination via the single
 * centralized resolver (`resolveAuthenticatedDestination()`, `lib/destinationResolver.ts` --
 * consolidates what used to be this file's own inline priority order) -- behavior for a signed-in
 * caller is unchanged. Only a genuinely unauthenticated visitor now sees this route's own content:
 * the public landing page, not a redirect to `/login`.
 *
 * Demo mode is unchanged: `getAdminSession()` (called inside the resolver) always returns a fixed
 * session in demo mode, so this always resolves to `/overview` there, exactly as before this fix.
 */
export default async function RootPage() {
  if (ADMIN_DEMO_MODE) {
    redirect('/overview');
  }

  const destination = await resolveAuthenticatedDestination();
  if (destination) {
    redirect(destination.path);
  }

  return <LandingPage />;
}
