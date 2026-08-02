import 'server-only';
import { cookies, headers } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseAdminServerEnv, type AdminServerEnv } from '@propvault/config';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Parsed lazily (on first actual use) rather than at module load — this file is imported by
// every server route/page, including during Next's build-time page-data collection, which must
// not require production secrets to be present. A missing/malformed required variable still
// fails fast, just at request time instead of build time.
let cachedEnv: AdminServerEnv | null = null;
export function getAdminServerEnv(): AdminServerEnv {
  if (!cachedEnv) {
    cachedEnv = parseAdminServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ADMIN_SESSION_COOKIE_SECRET: process.env.ADMIN_SESSION_COOKIE_SECRET,
      REVENUECAT_WEBHOOK_SECRET: process.env.REVENUECAT_WEBHOOK_SECRET,
      DOCUMENT_INTELLIGENCE_WEBHOOK_SECRET: process.env.DOCUMENT_INTELLIGENCE_WEBHOOK_SECRET,
      CRON_JOB_SECRET: process.env.CRON_JOB_SECRET,
    });
  }
  return cachedEnv;
}

/**
 * Pure extraction, no I/O — kept standalone so it's directly unit-testable without mocking
 * `next/headers`. Case-insensitive on the scheme per RFC 7235; returns null for anything that
 * isn't exactly `Bearer <token>` with a non-empty token (a bare `Authorization: Bearer` header,
 * or any other auth scheme, is treated as "no bearer token", falling back to the cookie path).
 */
export function extractBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Session-bound client (respects the caller's own auth + RLS) for reading "who is this admin"
 * safely. Never use this for elevated reads — use `getServiceRoleClient()` for that, and only
 * after `requireRole()` has passed. The `server-only` import above makes an accidental client
 * import of this file a build error, not a runtime leak (SECURITY.md).
 *
 * Supports both of `API_SPEC.md` §0's authenticated-caller shapes with a single abstraction, per
 * TECHNICAL_DEBT_REGISTER.md TD-28:
 * - PWA callers: Supabase's own `@supabase/ssr` cookie session (unchanged, existing behaviour).
 * - Native callers (Android/iOS): `Authorization: Bearer <supabase-access-token>`, no cookie at
 *   all. This is checked FIRST — a native client is never expected to also send a stale/foreign
 *   cookie, so precedence is not a real ambiguity in practice.
 *
 * For the bearer path, every REST/RPC call this client makes carries the caller's own JWT as its
 * `Authorization` header (via `global.headers`), so RLS resolves `auth.uid()` from that exact
 * token — identical enforcement to the cookie path, never a client-supplied user/org id trusted
 * directly. `auth.getUser()` is additionally overridden to default to that same token when called
 * with no argument (its normal no-arg behaviour reads a persisted session this client deliberately
 * never has, `persistSession: false`) — this is what lets every existing route handler's
 * `await supabase.auth.getUser()` call keep working completely unchanged for both caller types,
 * rather than requiring every route to be edited to pass the token through explicitly.
 */
export async function getServerSupabaseClient() {
  const env = getAdminServerEnv();
  const headerStore = await headers();
  const bearerToken = extractBearerToken(headerStore.get('authorization'));

  if (bearerToken) {
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });
    const resolveUser = client.auth.getUser.bind(client.auth);
    client.auth.getUser = ((jwt?: string) => resolveUser(jwt ?? bearerToken)) as SupabaseClient['auth']['getUser'];
    return client;
  }

  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component without write access — safe to ignore, middleware
          // refreshes the session cookie on the next request.
        }
      },
    },
  });
}

/**
 * Service-role client. Holds the one credential that must never reach a browser bundle
 * (SECURITY.md). Only ever call this after a passing `requireRole()` check, and only from
 * server route handlers / server components — never export the returned client to a client
 * component.
 */
export function getServiceRoleClient() {
  const env = getAdminServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
