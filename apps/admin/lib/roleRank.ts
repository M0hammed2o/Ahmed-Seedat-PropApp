import type { AdminRole } from '@propvault/types';

// Pure, dependency-free (no `server-only`, no Next.js imports) so it can be unit tested in
// isolation from lib/auth.ts's Supabase/server wiring.
export const ROLE_RANK: Record<AdminRole, number> = {
  read_only_admin: 0,
  support_admin: 1,
  operations_admin: 2,
  super_admin: 3,
};

export function isRoleAtLeast(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}
