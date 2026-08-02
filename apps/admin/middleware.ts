import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { ADMIN_DEMO_MODE } from './lib/demoMode';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Every authenticated route prefix, both the (super-admin) platform-staff pages and the
// (dashboard) client-org-facing pages (ARCHITECTURE.md's "Why one web app, not two" naming, both
// route groups now correctly named -- DECISIONS.md 2026-08-01). One shared list so the matcher
// config below and the runtime check can't drift out of sync as more routes are added.
// Real gap found and fixed 2026-08-01 (DECISIONS.md): this list (and its literal `matcher` twin
// below) hadn't been updated since the M20 vertical-slice pass added 12 new (dashboard) route
// segments across 7+ commits -- each new page/route still independently enforces its own
// session/role check (the real enforcement per this file's own header comment), so this was never
// a data-exposure gap, but it was a real, live UX gap (an unauthenticated request could reach the
// page shell before an API call 401s) for every route added since. Caught while adding
// '/dashboard' for the new Owner Dashboard landing page.
const PROTECTED_ROUTE_PREFIXES = [
  '/overview',
  '/customers',
  '/subscriptions',
  '/processing',
  '/system',
  '/dashboard',
  '/properties',
  '/units',
  '/owners',
  '/tenants',
  '/leases',
  '/applications',
  '/maintenance',
  '/inspections',
  '/accounting',
  '/documents',
  '/notifications',
  '/announcements',
  '/reports',
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

// Next.js's build-time config parser statically analyzes this file without executing it, so
// `matcher` must be a literal array, never a computed expression (confirmed by a real
// `next build` failure: "Next.js can't recognize the exported `config` field... matcher needs to
// be a static string or array of static strings"). Kept in sync with PROTECTED_ROUTE_PREFIXES by
// hand -- if this list falls behind (a new protected prefix added to PROTECTED_ROUTE_PREFIXES but
// not here), middleware simply never runs for that path, so this coarse gate silently stops
// covering it. Not a security hole on its own -- this file's own header comment already treats
// middleware as defense-in-depth only, with every route handler re-checking `requireRole()`/
// `requireOrgRole()` itself as the real enforcement -- but it is a real UX gap (an unauthenticated
// user could reach the page shell before an API call 401s) worth keeping these two lists aligned
// whenever a new protected route is added.
export const config = {
  matcher: [
    '/overview/:path*',
    '/customers/:path*',
    '/subscriptions/:path*',
    '/processing/:path*',
    '/system/:path*',
    '/dashboard/:path*',
    '/properties/:path*',
    '/units/:path*',
    '/owners/:path*',
    '/tenants/:path*',
    '/leases/:path*',
    '/applications/:path*',
    '/maintenance/:path*',
    '/inspections/:path*',
    '/accounting/:path*',
    '/documents/:path*',
    '/notifications/:path*',
    '/announcements/:path*',
    '/reports/:path*',
  ],
};
