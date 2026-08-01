import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { ADMIN_DEMO_MODE } from './lib/demoMode';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Coarse gate: redirects unauthenticated sessions away from (dashboard) routes. This is
 * defense-in-depth only — per SECURITY.md, every mutating route handler re-checks
 * `requireRole()` itself rather than trusting middleware having run (middleware can be bypassed
 * in some deployment configurations, and doesn't itself check the `platform_admin_users` table
 * here to avoid an extra service-role round trip on every request).
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

  const isDashboardRoute =
    request.nextUrl.pathname.startsWith('/overview') ||
    request.nextUrl.pathname.startsWith('/customers') ||
    request.nextUrl.pathname.startsWith('/subscriptions') ||
    request.nextUrl.pathname.startsWith('/processing') ||
    request.nextUrl.pathname.startsWith('/system');

  if (isDashboardRoute && !user) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/overview/:path*',
    '/customers/:path*',
    '/subscriptions/:path*',
    '/processing/:path*',
    '/system/:path*',
  ],
};
