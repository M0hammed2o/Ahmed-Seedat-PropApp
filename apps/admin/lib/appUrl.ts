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

/**
 * The correct public origin for a request that arrived through Render's reverse proxy (fronted by
 * Cloudflare) -- confirmed live this session that `new URL(request.url).origin` in a Route Handler
 * resolves to the container's internal `https://localhost:10000`, not the public
 * `https://proplyst.co.za`, because Route Handlers see the raw request as the proxy forwards it
 * internally. Next.js Middleware (proxy.ts) does not have this problem -- its own `request.url`
 * already reflects the public host -- so this helper is only needed at Route Handler call sites
 * that build an absolute URL for a redirect or an outbound email link.
 *
 * Prefers `X-Forwarded-Host`/`X-Forwarded-Proto`, the headers the actual proxy chain sets on every
 * request that reaches this app -- safe to trust here specifically because this app is never
 * directly internet-reachable, only through Render/Cloudflare, so these headers can't be spoofed
 * by an external caller the way they could on a directly-exposed origin. Falls back to
 * `getAppUrl()` (the configured `NEXT_PUBLIC_APP_URL`) when the headers are absent -- the ordinary
 * case in local dev, where there's no reverse proxy setting them at all.
 */
export function getRequestOrigin(headers: Headers): string {
  const forwardedHost = headers.get('x-forwarded-host');
  if (forwardedHost) {
    const forwardedProto = headers.get('x-forwarded-proto') ?? 'https';
    return `${forwardedProto}://${forwardedHost}`;
  }
  return getAppUrl();
}
