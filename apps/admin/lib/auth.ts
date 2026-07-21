import 'server-only';
import type { AdminRole } from '@propvault/types';
import { getServerSupabaseClient, getServiceRoleClient } from './supabase/server';
import { isRoleAtLeast } from './roleRank';

export interface AdminSession {
  authUserId: string;
  role: AdminRole;
  displayName: string;
}

/**
 * Resolves the caller's admin identity, or null if they're not signed in or not an active admin
 * row. This is the single function both `middleware.ts` and every mutating route handler call —
 * per SECURITY.md, middleware alone is not treated as sufficient authorization, so route
 * handlers call this again rather than trusting a header middleware might have set.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Looking up admin_users requires the service-role client because no RLS policy grants a
  // plain authenticated session access to that table (see supabase/migrations, SECURITY.md) —
  // this function itself IS the controlled, server-only path that's allowed to check it.
  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient
    .from('admin_users')
    .select('role, display_name, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;

  return { authUserId: user.id, role: data.role as AdminRole, displayName: data.display_name };
}

export async function requireRole(minRole: AdminRole): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session || !isRoleAtLeast(session.role, minRole)) {
    throw new Error('FORBIDDEN');
  }
  return session;
}
