import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
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
 * Session-bound client (respects the caller's own auth + RLS) for reading "who is this admin"
 * safely. Never use this for elevated reads — use `getServiceRoleClient()` for that, and only
 * after `requireRole()` has passed. The `server-only` import above makes an accidental client
 * import of this file a build error, not a runtime leak (SECURITY.md).
 */
export async function getServerSupabaseClient() {
  const env = getAdminServerEnv();
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
