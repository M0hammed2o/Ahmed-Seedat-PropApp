import 'server-only';

/**
 * Base URL for links embedded in outbound emails (invite acceptance, password reset). No hosting
 * platform is chosen yet (TECHNICAL_DEBT_REGISTER.md TD-20's same root gap), so this reads a
 * plain env var rather than a platform-specific one (e.g. VERCEL_URL) to stay host-agnostic;
 * falls back to localhost for local dev so links are still clickable in a demo/local Mailpit
 * inbox without any extra setup.
 */
export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

const PRODUCTION_APP_ORIGIN = 'https://proplyst.co.za';

/**
 * The correct public origin for a request that arrived through Render's reverse proxy (fronted by
 * Cloudflare) -- confirmed live this session that `new URL(request.url).origin` in a Route Handler
 * resolves to the container's internal `https://localhost:10000`, not the public
 * `https://proplyst.co.za`, because Route Handlers see the raw request as the proxy forwards it
 * internally. Next.js Middleware (proxy.ts) does not have this problem -- its own `request.url`
 * already reflects the public host -- so this helper is only needed at Route Handler call sites
 * that build an absolute URL for a redirect or an outbound email link.
 *
 * Render/Cloudflare set `X-Forwarded-Host`/`X-Forwarded-Proto`, but those values must still be
 * allow-listed here. A live production probe proved Cloudflare forwards a caller-supplied
 * `X-Forwarded-Host` unchanged; trusting it unconditionally turned this helper into an open
 * redirect and, more seriously, allowed signup/password-reset emails to be poisoned with an
 * attacker-controlled return host. The configured app origin and the canonical production origin
 * are the only accepted forwarded origins. Everything else falls back to the configured origin.
 */
export function getRequestOrigin(headers: Headers): string {
  const configuredOrigin = new URL(getAppUrl()).origin;
  const forwardedHost = headers.get('x-forwarded-host');
  if (forwardedHost) {
    const forwardedProto = headers.get('x-forwarded-proto') ?? 'https';
    try {
      const forwardedOrigin = new URL(`${forwardedProto}://${forwardedHost}`).origin;
      if (forwardedOrigin === configuredOrigin || forwardedOrigin === PRODUCTION_APP_ORIGIN) {
        return forwardedOrigin;
      }
    } catch {
      // Malformed forwarded values are untrusted input; use the canonical configured origin.
    }
  }
  return configuredOrigin;
}
