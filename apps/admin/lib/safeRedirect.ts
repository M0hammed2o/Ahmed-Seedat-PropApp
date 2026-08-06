/**
 * Validates a caller-supplied `?next=` value before it's ever used as a redirect target.
 * `next` carries session-expiry continuation (proxy.ts), invitation continuation (PRODUCT
 * DECISION 1), and post-auth-callback routing -- all attacker-reachable via a crafted link
 * (`/login?next=<anything>`), so every consumer must validate before redirecting, not just the
 * ones that happened to add a check already (found live: `auth/callback/route.ts` built
 * `new URL(next, origin)` with no validation at all -- if `next` is itself an absolute URL like
 * `https://evil.example`, that constructor returns the absolute URL, ignoring `origin`
 * entirely -- a real open redirect an attacker-crafted magic-sign-in-link could exploit for
 * phishing).
 *
 * A safe `next` must be a same-origin, root-relative path: starts with exactly one `/` (not `//`
 * or `/\`, both of which browsers may resolve as protocol-relative -- i.e. external -- and not
 * `://` appearing anywhere, which would mean `next` embeds a full URL past the leading slash).
 */
export function isSafeNextPath(next: string | null | undefined): next is string {
  if (!next) return false;
  if (!next.startsWith('/')) return false;
  if (next.startsWith('//') || next.startsWith('/\\')) return false;
  if (next.includes('://')) return false;
  return true;
}

/** Returns `next` if safe, otherwise `fallback` (default `/`) -- the single call site every
 *  redirect-target consumer should use instead of trusting `next` directly. */
export function safeNextPathOr(next: string | null | undefined, fallback = '/'): string {
  return isSafeNextPath(next) ? next : fallback;
}
