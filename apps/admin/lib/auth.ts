import 'server-only';
import { cache } from 'react';
import type { AdminRole } from '@propvault/types';
import { getServerSupabaseClient, getServiceRoleClient } from './supabase/server';
import { isRoleAtLeast } from './roleRank';
import { ADMIN_DEMO_MODE } from './demoMode';
import { DEMO_ADMIN_SESSION } from './demo/adminMockData';

export interface AdminSession {
  id: string; // platform_admin_users row id -- distinct from authUserId (auth.users id); the FK
  // support_access_sessions.platform_admin_id references this, not auth_user_id.
  authUserId: string;
  role: AdminRole;
  displayName: string;
}

// Super Admin separation (WORKLOG.md this date), item 7: optional, env-gated defense-in-depth on
// top of platform_admin_users itself -- that table is already a strong allow-list on its own
// (RLS default-deny with zero policies; confirmed by grep before writing this that no signup/seed
// path anywhere creates a row -- provisioning is manual-only). If set, the caller's email must
// ALSO appear here, so a single compromised/manipulated platform_admin_users row alone is not
// sufficient for access. Unset by default -- does not change behaviour unless explicitly
// configured, matching this codebase's established "opt-in infra hardening" pattern (e.g.
// ADMIN_DEMO_MODE's own two-condition gate).
//
// Deliberately re-read on every call rather than parsed once at module load: `process.env` is
// only genuinely fixed for a given running process (true for a real deployment, where env vars
// are set once at container start), but treating it as load-time-constant made this untestable --
// caught live by this file's own test suite, where a later test setting the env var had no effect
// because an earlier test had already triggered the one-time module evaluation.
function getPlatformAdminAllowedEmails(): string[] | undefined {
  return process.env.PLATFORM_ADMIN_ALLOWED_EMAILS?.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

interface AdminGateResult {
  session: AdminSession | null;
  isAal2: boolean;
}

/**
 * Resolves everything the (super-admin) layout's gate needs -- identity AND AAL -- in one lean
 * pass: one `auth.getUser()`, one `platform_admin_users` lookup, one `getAuthenticatorAssuranceLevel()`
 * call, the DB lookup and AAL check run concurrently via `Promise.all` rather than sequentially.
 *
 * Real, live-caught bug this fixes (WORKLOG.md this date): the (super-admin) layout calls this
 * (via `getAdminGateStatus()`) to decide whether to redirect; every page under it also used to call
 * `requireRole()` -> `getAdminSession()` -> this function again, as its own fully independent
 * resolution. Next.js's own concurrent Server Component rendering does not guarantee the layout's
 * `redirect()` call happens-before the child page component starts executing -- both are simply
 * async functions in the same route tree, and can run concurrently. So the page's own resolution
 * could finish and throw (`requireRole()`'s plain `Error`, not a `redirect()`/`notFound()` digest
 * signal Next treats specially) before or regardless of the layout's redirect, and that uncaught
 * throw won the render -- observed live via Playwright as the wrong page's error boundary
 * appearing instead of the intended /platform-admin/mfa-setup redirect. Reducing this function's
 * own latency (an earlier attempt at this fix) narrowed the race window but could not close it,
 * since the two calls were still independent. Wrapping it in React's `cache()` closes it properly:
 * every call within one request -- from the layout, and from every page that still needs session
 * data for rendering (via `getAdminSessionWithoutMfaCheck()`) -- shares the exact same in-flight
 * promise, so there is only ever one resolution per request, not two that can disagree or race.
 */
const resolveAdminGate = cache(async (): Promise<AdminGateResult> => {
  if (ADMIN_DEMO_MODE) {
    return {
      session: {
        id: DEMO_ADMIN_SESSION.id,
        authUserId: DEMO_ADMIN_SESSION.authUserId,
        role: DEMO_ADMIN_SESSION.role,
        displayName: DEMO_ADMIN_SESSION.displayName,
      },
      isAal2: true, // no real session to check an AAL against -- demo mode is exempt, as always
    };
  }

  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { session: null, isAal2: false };

  const allowedEmails = getPlatformAdminAllowedEmails();
  if (allowedEmails?.length) {
    if (!user.email || !allowedEmails.includes(user.email.toLowerCase())) {
      return { session: null, isAal2: false };
    }
  }

  // Looking up platform_admin_users requires the service-role client because no RLS policy
  // grants a plain authenticated session access to that table (see supabase/migrations,
  // SECURITY.md) — this function itself IS the controlled, server-only path that's allowed to
  // check it.
  const serviceClient = getServiceRoleClient();
  const [{ data, error }, { data: aal }] = await Promise.all([
    serviceClient
      .from('platform_admin_users')
      .select('id, role, display_name, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  if (error || !data || !data.is_active) return { session: null, isAal2: false };

  return {
    session: {
      id: data.id,
      authUserId: user.id,
      role: data.role as AdminRole,
      displayName: data.display_name,
    },
    isAal2: aal?.currentLevel === 'aal2',
  };
});

/**
 * Resolves the caller's admin identity WITHOUT checking MFA assurance level. Exported only for
 * the (super-admin) layout's own MFA-gate redirect decision -- it needs to distinguish "not an
 * admin at all" (redirect to the correct customer destination, or 404) from "a real admin who
 * hasn't completed MFA step-up yet" (redirect to /platform-admin/mfa-setup) -- getAdminSession()
 * below collapses both cases to null, which is exactly right for every other caller but wrong for
 * that one UX decision. Every other caller (every page's requireRole(), every API route's
 * requireAdminRoleOrRespond()) must use getAdminSession(), never this. The layout itself should
 * prefer calling resolveAdminGate()'s two exports together rather than this alone where it needs
 * both facts -- see that function's own comment for why.
 */
export async function getAdminSessionWithoutMfaCheck(): Promise<AdminSession | null> {
  return (await resolveAdminGate()).session;
}

/**
 * The (super-admin) layout's own dedicated entry point -- resolves identity AND AAL together in
 * exactly one `resolveAdminGate()` call, since it needs both facts to decide between three
 * outcomes (not an admin / admin-needs-MFA / admin-ready) and calling the two functions above
 * separately would silently reintroduce the doubled-round-trip bug their own comments describe.
 * Not useful to any other caller -- every other caller needs exactly one of these two facts, not
 * both, so `getAdminSessionWithoutMfaCheck()`/`getAdminSession()` stay the right choice for them.
 */
export async function getAdminGateStatus(): Promise<AdminGateResult> {
  return resolveAdminGate();
}

/**
 * Resolves the caller's admin identity, or null if they're not signed in, not an active admin
 * row, not on the (optional) allow-list, or haven't completed TOTP MFA step-up for this session
 * (AAL2) -- Super Admin separation (WORKLOG.md this date), item 6: "Require TOTP MFA... before
 * entering the Super Admin interface." An admin who exists in platform_admin_users but is still
 * only AAL1 (never enrolled a factor, or enrolled but this specific session hasn't stepped up
 * yet) is treated identically to "not an admin" by every caller of this function -- fails closed,
 * not merely warns. This is the single function both `proxy.ts` and every mutating route handler
 * call — per SECURITY.md, middleware alone is not treated as sufficient authorization, so route
 * handlers call this again rather than trusting a header middleware might have set.
 *
 * In demo mode (no live Supabase project — see DECISIONS.md) this returns a fixed fake admin
 * session instead of touching Supabase at all, so the admin dashboard can be demonstrated
 * end-to-end before a backend is provisioned -- no real session exists to check an AAL against,
 * so demo mode is exempted from the MFA check the same way it always has been from every other
 * real-auth check. Never used when NEXT_PUBLIC_DEMO_MODE is unset.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const { session, isAal2 } = await resolveAdminGate();
  if (!session) return null;
  return isAal2 ? session : null;
}

export async function requireRole(minRole: AdminRole): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session || !isRoleAtLeast(session.role, minRole)) {
    throw new Error('FORBIDDEN');
  }
  return session;
}
