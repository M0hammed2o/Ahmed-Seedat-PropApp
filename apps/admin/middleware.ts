import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { ADMIN_DEMO_MODE } from './lib/demoMode';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Every authenticated route prefix, both the (super-admin)-shaped pages (still physically under
// app/(dashboard) pending the file-level rename ARCHITECTURE.md's naming calls for -- blocked on
// a live `next dev` process holding a lock on that directory, DECISIONS.md 2026-08-01, not
// forgotten) and the (portal) client-org-facing pages. One shared list so the matcher config below
// and the runtime check can't drift out of sync as more portal routes are added.
const PROTECTED_ROUTE_PREFIXES = [
  '/overview',
  '/customers',
  '/subscriptions',
  '/processing',
  '/system',
  '/properties',
];

/**
 * Coarse gate: redirects unauthenticated sessions away from protected routes. This is
 * defense-in-depth only — per SECURITY.md, every mutating route handler re-checks
 * `requireRole()`/`requireOrgRole()` itself rather than trusting middleware having run
 * (middleware can be bypassed in some deployment configurations, and doesn't itself check
 * `platform_admin_users`/`organization_members` here to avoid an extra round trip on every
 * request).
 */
export async function middleware(request: NextRequest) {
  // Demo mode has no Supabase project to check a session against — lib/auth.ts's
  // getAdminSession() always returns the fixed demo admin session instead, so there's nothing
  // for this coarse gate to do (see DECISIONS.md, Phase 2 entry).
  if (ADMIN_DEMO_MODE) {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtectedRoute = PROTECTED_ROUTE_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (isProtectedRoute && !user) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: PROTECTED_ROUTE_PREFIXES.map((prefix) => `${prefix}/:path*`),
};
