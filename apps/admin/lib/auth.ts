import 'server-only';
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

/**
 * Resolves the caller's admin identity, or null if they're not signed in or not an active admin
 * row. This is the single function both `middleware.ts` and every mutating route handler call —
 * per SECURITY.md, middleware alone is not treated as sufficient authorization, so route
 * handlers call this again rather than trusting a header middleware might have set.
 *
 * In demo mode (no live Supabase project — see DECISIONS.md) this returns a fixed fake admin
 * session instead of touching Supabase at all, so the admin dashboard can be demonstrated
 * end-to-end before a backend is provisioned. Never used when NEXT_PUBLIC_DEMO_MODE is unset.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  if (ADMIN_DEMO_MODE) {
    return {
      id: DEMO_ADMIN_SESSION.id,
      authUserId: DEMO_ADMIN_SESSION.authUserId,
      role: DEMO_ADMIN_SESSION.role,
      displayName: DEMO_ADMIN_SESSION.displayName,
    };
  }

  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Looking up platform_admin_users requires the service-role client because no RLS policy
  // grants a plain authenticated session access to that table (see supabase/migrations,
  // SECURITY.md) — this function itself IS the controlled, server-only path that's allowed to
  // check it.
  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient
    .from('platform_admin_users')
    .select('id, role, display_name, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;

  return {
    id: data.id,
    authUserId: user.id,
    role: data.role as AdminRole,
    displayName: data.display_name,
  };
}

export async function requireRole(minRole: AdminRole): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session || !isRoleAtLeast(session.role, minRole)) {
    throw new Error('FORBIDDEN');
  }
  return session;
}
