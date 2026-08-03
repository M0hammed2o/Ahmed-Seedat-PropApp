import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { ADMIN_DEMO_MODE } from './lib/demoMode';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Every authenticated route prefix, both the (super-admin) platform-staff pages and the
// (dashboard) client-org-facing pages (ARCHITECTURE.md's "Why one web app, not two" naming, both
// route groups now correctly named -- DECISIONS.md 2026-08-01). One shared list so the matcher
// config below and the runtime check can't drift out of sync as more routes are added.
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
  '/my-lease',
  '/my-payments',
  '/my-maintenance',
  '/notices',
];

/**
 * Real bug found and fixed 2026-08-02 (DECISIONS.md): `next.config.ts`'s static
 * Content-Security-Policy header (`script-src 'self'`, no `'unsafe-inline'` or nonce) has been
 * silently blocking every one of Next.js's own inline hydration/streaming-RSC `<script>` tags
 * since this project's first commit -- confirmed with a real Chrome browser check (this session's
 * curl-based smoke tests never caught it; curl doesn't execute JavaScript or enforce CSP at all,
 * so a page whose HTML *contains* the right text but whose React tree never actually hydrates
 * looks identical to a working one from curl's point of view). Every page was rendering as a
 * permanently frozen `loading.tsx` skeleton in any real browser.
 *
 * Fixed per Next.js's own documented nonce pattern
 * (nextjs.org/docs/app/guides/content-security-policy): generate a fresh nonce per request here,
 * forward it via the `x-nonce` request header (Next.js reads this automatically off the request
 * and applies it to its own framework/hydration scripts -- no per-component wiring needed), and
 * set the same value as the `Content-Security-Policy` response header. `next.config.ts`'s own
 * Content-Security-Policy entry was removed in the same change -- a header returned statically
 * from `headers()` can't carry a value that has to be different on every request.
 *
 * This requires every page to be dynamically rendered (Next.js can only inject a nonce at
 * request time) -- already true for every route group's layout and the root `/page.tsx`
 * (`export const dynamic = 'force-dynamic'`); `/login` and `/onboarding/create-organization`
 * needed the same treatment, done in the same change.
 */
// Real bug found 2026-08-03 verifying password reset against local Supabase (PWA_V1_COMPLETION_
// PLAN.md #4): connect-src only ever allowed 'self' and https://*.supabase.co, so every
// client-side Supabase call (auth.signInWithPassword, resetPasswordForEmail, updateUser, ...) was
// silently blocked by CSP whenever NEXT_PUBLIC_SUPABASE_URL pointed at local Supabase
// (http://127.0.0.1:54321) -- confirmed live via a real Chrome console CSP violation, not
// inferred. Never caught before because every prior real-browser verification pass this session
// ran in demo mode, which never makes a real Supabase call at all. Gating on NODE_ENV (as
// script-src's 'unsafe-eval' already does) would NOT have fixed this: a production build
// (`next build && next start`) pointed at local Supabase -- the exact scenario that surfaced the
// bug -- still has NODE_ENV=production. Deriving the allowed origin directly from
// NEXT_PUBLIC_SUPABASE_URL instead handles local-dev-server, production-build-against-local, and
// a real deployed project (still covered by the https://*.supabase.co wildcard) all correctly.
function localSupabaseConnectSrc(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return '';
  try {
    const { hostname, protocol } = new URL(url);
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') return '';
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return ` ${url} ${wsProtocol}//${new URL(url).host}`;
  } catch {
    return '';
  }
}

function buildCspHeader(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self' https://*.supabase.co${localSupabaseConnectSrc()}`,
    'upgrade-insecure-requests',
  ].join('; ');
}

/**
 * Coarse auth gate (unchanged behavior, just folded into the same pass as the CSP nonce so this
 * file makes one `NextResponse` per request instead of two): redirects unauthenticated sessions
 * away from protected routes. Defense-in-depth only — per SECURITY.md, every mutating route
 * handler re-checks `requireRole()`/`requireOrgRole()` itself rather than trusting proxy having
 * run (proxy can be bypassed in some deployment configurations, and doesn't itself check
 * `platform_admin_users`/`organization_members` here to avoid an extra round trip on every
 * request).
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const cspHeader = buildCspHeader(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', cspHeader);

  // Demo mode has no Supabase project to check a session against — lib/auth.ts's
  // getAdminSession() always returns the fixed demo admin session instead, so there's nothing
  // for the auth gate below to do (see DECISIONS.md, Phase 2 entry).
  if (ADMIN_DEMO_MODE) {
    return response;
  }

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
    const redirectResponse = NextResponse.redirect(loginUrl);
    redirectResponse.headers.set('Content-Security-Policy', cspHeader);
    return redirectResponse;
  }

  return response;
}

// The nonce must be set on every page request, not just protected ones (an unauthenticated visitor
// on /login still needs Next.js's own hydration scripts to run) -- excludes only static assets,
// matching Next.js's own documented CSP-nonce matcher example. `PROTECTED_ROUTE_PREFIXES` above
// (checked at runtime, not via this matcher) is what actually narrows the auth-redirect behavior.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
