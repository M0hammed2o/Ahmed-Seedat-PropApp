import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { ADMIN_DEMO_MODE } from './lib/demoMode';
import { requireCustomerMfaIfEnrolled } from './lib/mfaGate';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Every authenticated route prefix, both the (super-admin) platform-staff pages and the
// (dashboard) client-org-facing pages (ARCHITECTURE.md's "Why one web app, not two" naming, both
// route groups now correctly named -- DECISIONS.md 2026-08-01). One shared list so the matcher
// config below and the runtime check can't drift out of sync as more routes are added.
const PROTECTED_ROUTE_PREFIXES = [
  // Super Admin separation (WORKLOG.md this date): every platform-admin page now lives under this
  // one prefix instead of 5 separate top-level ones -- a single, easy-to-audit namespace for both
  // this gate and the X-Robots-Tag exclusion below.
  '/platform-admin',
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
  '/portal',
  '/my-lease',
  '/my-payments',
  '/my-maintenance',
  '/my-documents',
  '/notices',
  '/profile',
  '/owner-portal',
  // Stage 3 customer MFA bypass fix (WORKLOG.md this date) -- needs a real session to be
  // meaningful at all, so it participates in the same unauthenticated-visitor gate below as
  // every other customer route.
  '/mfa-challenge',
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

// Real bug found 2026-08-04 verifying the Portfolio map against a live Mapbox token (UI_
// INTEGRATION_PLAN.md map batch): connect-src only ever allowed 'self' and https://*.supabase.co,
// so Mapbox GL's style/sprite/tile requests to api.mapbox.com and *.tiles.mapbox.com were silently
// blocked by CSP -- confirmed live via a real Chrome console CSP violation, not inferred. Mapbox GL
// also runs its tile-decoding work on a worker constructed from a `blob:` URL, which needs an
// explicit worker-src (the default-src 'self' fallback does not cover blob: workers).
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
    "worker-src 'self' blob:",
    `connect-src 'self' https://*.supabase.co https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com${localSupabaseConnectSrc()}`,
    'upgrade-insecure-requests',
  ].join('; ');
}

// CSRF (Stage 7 commercial-launch execution plan, WORKLOG.md 2026-08-06). SECURITY.md's existing
// claim -- "session cookies are SameSite-scoped... no implicit-credential request for a forged
// cross-site request to ride on" -- was verified live this session, not just asserted: the actual
// installed @supabase/ssr version's DEFAULT_COOKIE_OPTIONS (dist/main/utils/constants.js) is
// `sameSite: 'lax'`, which this codebase never overrides. SameSite=Lax already blocks a forged
// cross-site POST/PUT/PATCH/DELETE from carrying the session cookie at all in every modern
// browser -- the real, substantiated defense, not just an architectural claim. This check is
// deliberate defense-in-depth on top of that (OWASP's "Verifying Origin with Standard Headers"
// CSRF technique), for the residual case of a browser/proxy configuration that doesn't honour
// SameSite, not a replacement for it.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Endpoints that are legitimately called by something other than this app's own browser session
// -- a real external caller with no Origin/Referer matching this origin at all, by design, not a
// gap. PayFast's ITN webhook is authenticated by its own signature (processBillingWebhookEvent),
// never by a session cookie, so CSRF -- forging a request that rides an ambient cookie -- does not
// apply to it in the first place. Exact pathnames only (never a prefix) so this list can't
// accidentally widen to cover something that does need the check.
const CSRF_EXEMPT_PATHS = new Set(['/api/v1/billing/webhook']);

/**
 * True if a mutating request's Origin (or, failing that, Referer) header matches this app's own
 * origin. Skipped entirely for non-mutating methods, exempt paths, and any request already
 * carrying an `Authorization: Bearer` header -- a bearer token is a credential a forged cross-site
 * request cannot possibly know or attach (unlike an ambient cookie), so it's a fundamentally
 * different trust model from the one CSRF attacks exploit; this is exactly the "native apps... use
 * bearer-token auth rather than ambient cookie auth" case SECURITY.md already describes, and is
 * also how TD-31's CRON_JOB_SECRET-authenticated system endpoints and native mobile clients (TD-28)
 * keep working unaffected by this check.
 *
 * Compares against the request's own Host header, not `request.nextUrl.origin` -- found live this
 * session that Next.js's `nextUrl.origin` silently canonicalizes to `localhost` regardless of the
 * actual Host a request arrived on (confirmed: a real browser request to 127.0.0.1:3100 carried
 * `Origin: http://127.0.0.1:3100` and a matching `Host: 127.0.0.1:3100` header, but
 * `request.nextUrl.origin` reported `http://localhost:3100` -- comparing against it would have
 * rejected every genuinely same-origin request whenever the app isn't accessed via the literal
 * string "localhost", a real false-positive this test suite caught before it shipped.
 */
export function isTrustedOrigin(request: NextRequest): boolean {
  if (!MUTATING_METHODS.has(request.method)) return true;
  if (CSRF_EXEMPT_PATHS.has(request.nextUrl.pathname)) return true;
  if (request.headers.get('authorization')) return true;

  const host = request.headers.get('host');
  if (!host) return false; // no Host header on a mutating HTTP/1.1+ request is itself invalid/suspicious
  const expectedOrigin = `${request.nextUrl.protocol}//${host}`;

  const origin = request.headers.get('origin');
  if (origin) return origin === expectedOrigin;

  // No Origin header at all: fall back to Referer. A real browser sends at least one of these on
  // every mutating request; the absence of both on a mutating request is itself the suspicious
  // case CSRF checks exist to catch, so this fails closed rather than assuming same-origin.
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }
  return false;
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
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'csrf_origin_mismatch', message: 'Request origin could not be verified.' } },
      { status: 403 },
    );
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const cspHeader = buildCspHeader(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);
  // Forwarded so a Server Component layout (e.g. (dashboard)/layout.tsx's suspended-org gate) can
  // know the current path without Next.js's client-only usePathname() -- same "compute once in
  // middleware, forward via header" pattern as x-nonce above, not a new mechanism.
  requestHeaders.set('x-pathname', request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', cspHeader);
  // Super Admin separation, item 9 (no sitemap entry exists to omit it from -- this is the actual
  // enforcement search engines see): belt-and-suspenders alongside robots.ts's Disallow rule and
  // the (super-admin) layout's own `robots` metadata -- a crawler that ignores robots.txt still
  // gets this HTTP header on every response under the prefix.
  if (request.nextUrl.pathname.startsWith('/platform-admin')) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

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
    // PRODUCT DECISION 1 (2026-08-03) "session expiry handling": preserve where the caller was
    // headed so a mid-session expiry (or a cold, signed-out visit to a deep link) returns them
    // there after signing back in, instead of dropping them at a generic dashboard -- this
    // redirect previously discarded the original path entirely.
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    const redirectResponse = NextResponse.redirect(loginUrl);
    redirectResponse.headers.set('Content-Security-Policy', cspHeader);
    return redirectResponse;
  }

  // Stage 3 customer MFA step-up gate (WORKLOG.md this date) -- a real, live-caught
  // vulnerability: a customer with a verified TOTP factor who stops at the password-only AAL1
  // session (never completes the challenge) previously had full access to every protected
  // customer/tenant/owner API, since `/api/v1/*` was never in PROTECTED_ROUTE_PREFIXES above
  // (each API route only ever checked "is there a user", never "is this session's assurance
  // level sufficient") -- confirmed by both a code trace and a real Playwright reproduction
  // (e2e/mfa-enforcement.spec.ts) before this fix.
  //
  // Deliberately narrow, per the architecture review this responds to: pages are already fully
  // covered by the three customer layouts' own independent re-check (mirroring how they already
  // re-check `!session` rather than trusting proxy.ts alone), so this stays API-only rather than
  // also duplicating page coverage here. `/api/v1/auth/*` is excluded -- those routes manage
  // their own AAL state directly (signin establishes AAL1; POST /api/v1/auth/mfa/verify is what
  // completes the step-up to AAL2, and blocking it here would make step-up permanently
  // impossible). `/api/v1/admin/*` is excluded -- already covered by
  // requireAdminRoleOrRespond()'s own, stricter, unconditional AAL2 requirement. A customer who
  // never enrolled MFA is completely unaffected: `nextLevel` never requires 'aal2' for them, so
  // `requireCustomerMfaIfEnrolled()` always resolves false.
  if (user && request.nextUrl.pathname.startsWith('/api/v1/')) {
    const isExemptApi =
      request.nextUrl.pathname.startsWith('/api/v1/auth/') ||
      request.nextUrl.pathname.startsWith('/api/v1/admin/');

    if (!isExemptApi && (await requireCustomerMfaIfEnrolled(supabase))) {
      return NextResponse.json(
        {
          error: {
            code: 'mfa_required',
            message: 'Complete two-factor authentication to continue.',
          },
        },
        { status: 403 },
      );
    }
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
