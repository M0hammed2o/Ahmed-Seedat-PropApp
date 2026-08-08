import 'server-only';
import { isIP } from 'node:net';

/**
 * Stage 4 client-IP spoofing fix (WORKLOG.md this date). Real, proven vulnerability: every
 * IP-keyed rate limit (signin, signup, password-reset) previously trusted the first entry of the
 * caller-supplied `X-Forwarded-For` header unconditionally (the old `requestIp()` in
 * lib/rateLimit.ts) -- any caller could set that header to a fresh value on every request and
 * bucket-key around the limit entirely. Proven with real HTTP requests in
 * e2e/client-ip-security.spec.ts: 15 rotating-IP password-reset/signin requests and 12
 * rotating-IP signup requests never once hit 429, versus a fixed IP correctly tripping the limit
 * on request 6.
 *
 * Production topology (confirmed empirically against the real proplyst.co.za response headers --
 * `server: cloudflare`, `cf-ray` present, `x-render-origin-server: render`): Client -> Cloudflare
 * -> Render -> Next.js. Cloudflare overwrites `CF-Connecting-IP` at its own edge with the real
 * connecting IP on every request that genuinely passes through it -- a client cannot make
 * Cloudflare forward an arbitrary value of its own choosing for this specific header. Ordinary
 * `X-Forwarded-For`/`X-Real-IP` headers, by contrast, are not rewritten by Cloudflare and remain
 * entirely caller-controlled, which is exactly what made the prior behaviour spoofable.
 *
 * Residual risk (disclosed, not something application code alone can close): this only holds if
 * Render's origin is unreachable except through Cloudflare. If the raw Render origin were ever
 * directly reachable, an attacker could set their own CF-Connecting-IP header on a direct
 * request and this resolver would trust it. Restricting Render's inbound traffic to Cloudflare's
 * published IP ranges (or Cloudflare Authenticated Origin Pulls) is an infra-level control this
 * code cannot verify or enforce from here -- flagged for confirmation, not assumed safe.
 */
export function resolveTrustedClientIp(request: Request): string {
  const cfConnectingIp = normalizeIp(request.headers.get('cf-connecting-ip'));
  if (cfConnectingIp) return cfConnectingIp;

  // No Cloudflare edge in front of this request. A real deployed environment never falls back to
  // trusting caller-supplied X-Forwarded-For/X-Real-IP as an identity for rate-limiting -- every
  // request lacking a trustworthy signal shares one fixed bucket instead. That is a stricter, not
  // weaker, failure mode (shared throttling for everyone in that state), never an attacker-chosen
  // per-request key.
  //
  // Local development and the Playwright suite (NODE_ENV !== 'production', no Cloudflare in the
  // loop, no real attacker between the test runner and the dev server) keep honoring
  // X-Forwarded-For/X-Real-IP so existing per-test IP isolation (e2e/auth-security.spec.ts) keeps
  // working without a real proxy in front to supply CF-Connecting-IP.
  if (process.env.NODE_ENV !== 'production') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const first = normalizeIp(forwarded.split(',')[0]);
      if (first) return first;
    }
    const realIp = normalizeIp(request.headers.get('x-real-ip'));
    if (realIp) return realIp;
  }

  return 'unverified-origin';
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  // Strip optional IPv6 brackets (some proxies/conventions wrap IPv6 addresses, e.g. "[::1]").
  const trimmed = value.trim().replace(/^\[(.+)\]$/, '$1');
  return isIP(trimmed) !== 0 ? trimmed : null;
}
