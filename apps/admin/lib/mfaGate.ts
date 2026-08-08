import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabaseClient } from './supabase/server';

/**
 * Stage 3 customer MFA bypass fix (WORKLOG.md this date). Real, live-caught vulnerability: a
 * customer with a verified TOTP factor who authenticates with the correct password but stops at
 * the MFA challenge (never calling POST /api/v1/auth/mfa/verify) still received a fully valid,
 * cookie-persisted AAL1 Supabase session -- and nothing anywhere in the customer path
 * (`resolvePortalSession()`, `(dashboard)/layout.tsx`, `proxy.ts`, protected API routes, or any
 * RLS policy) ever checked the session's assurance level. Confirmed both by code trace and by a
 * real Playwright reproduction (`e2e/mfa-enforcement.spec.ts`) hitting `/dashboard`, `/properties`,
 * `/settings`, and three protected APIs with a provably AAL1-only session -- every one returned
 * 200 with real data before this fix.
 *
 * Deliberately conditional on enrollment, matching the product policy: a customer who has never
 * enrolled MFA is completely unaffected (`nextLevel` never requires 'aal2' for them, so this
 * always resolves to `false`) -- MFA stays fully optional for ordinary customers. Only a customer
 * who HAS enrolled and verified a TOTP factor, and whose current session hasn't completed that
 * step-up, is gated. Uses Supabase's own `getAuthenticatorAssuranceLevel()` (the session's real,
 * server-verified assurance level) -- never a client-supplied flag, localStorage, or
 * sessionStorage, none of which this function ever reads.
 *
 * Platform admin (`(super-admin)/layout.tsx`) is NOT affected by this helper and does not call
 * it -- that route group already enforces AAL2 unconditionally (via `getAdminSession()`), a
 * stricter requirement than this one's "only if enrolled" semantics, and remains unchanged.
 *
 * The single source of the actual logic -- called from the three customer layouts (page-level
 * defense-in-depth, mirroring how each already independently re-checks `!session` rather than
 * trusting `proxy.ts` alone) and from `proxy.ts` itself (the only practical way to cover every
 * `/api/v1/*` customer route without either a new per-route wrapper convention or editing ~30
 * files individually -- see the architecture note in proxy.ts's own comment for why this is scoped
 * narrowly rather than becoming a general pattern).
 *
 * Accepts an optional pre-built client: `proxy.ts` runs as Next.js Middleware, which has no
 * access to `next/headers`'s `cookies()` (what `getServerSupabaseClient()` uses internally) --
 * it already builds its own `@supabase/ssr` client bound to `request.cookies`/`response.cookies`
 * for its existing `auth.getUser()` check, and passes that same client through here rather than
 * this function trying (and failing) to construct its own. Server Components (the three layouts)
 * omit the argument and get the normal cookie-based client.
 */
export async function requireCustomerMfaIfEnrolled(
  supabaseClient?: SupabaseClient,
): Promise<boolean> {
  const supabase = supabaseClient ?? (await getServerSupabaseClient());
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal) return false;
  return aal.nextLevel === 'aal2' && aal.currentLevel !== aal.nextLevel;
}
