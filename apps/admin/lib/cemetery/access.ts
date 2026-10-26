import 'server-only';
import type { OrganizationMemberRole } from '@propvault/types';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { resolvePortalSession } from '@/lib/orgSession';

// Cemetery Management access (migration 184). The database is the enforcement point: every cemetery_* policy
// requires organizations.cemetery_enabled AND accountant+ (read) / manager+ (write). This module mirrors those rules
// so pages, navigation and API routes can hide or refuse early with a clear message; it never widens them.

const READ_ROLES: OrganizationMemberRole[] = ['accountant', 'manager', 'principal'];
const MANAGE_ROLES: OrganizationMemberRole[] = ['manager', 'principal'];

export interface CemeteryContext {
  orgId: string;
  role: OrganizationMemberRole;
  /** Create cemeteries, purchasers, sales, reservations, burials (manager, principal). */
  canManage: boolean;
  /** Record payments and print receipts (accountant, manager, principal). */
  canRecordPayments: boolean;
}

/**
 * Module switch for one organisation, read with the service role so the caller's RLS view cannot affect it.
 * FAIL CLOSED: only an explicit `true` enables; a missing row or a lookup error means disabled.
 */
export async function cemeteryEnabledForOrg(orgId: string): Promise<boolean> {
  const { data, error } = await getServiceRoleClient()
    .from('organizations')
    .select('cemetery_enabled')
    .eq('id', orgId)
    .maybeSingle();
  if (error) return false;
  return (data as { cemetery_enabled?: boolean } | null)?.cemetery_enabled === true;
}

export function cemeteryRoleAllowed(role: OrganizationMemberRole): boolean {
  return READ_ROLES.includes(role);
}

/**
 * The signed-in caller's cemetery context for their active organisation, or null when the module is off, the
 * caller's role may not see cemetery records, or the session is a read-only platform support session.
 */
export async function getCemeteryContext(): Promise<CemeteryContext | null> {
  const session = await resolvePortalSession();
  if (!session) return null;
  const active = session.organizations.find((m) => m.status === 'active');
  if (!active) return null;
  if (session.supportSessions.some((s) => s.orgId === active.orgId)) return null;
  if (!cemeteryRoleAllowed(active.role)) return null;
  if (active.orgStatus === 'suspended' || active.orgStatus === 'cancelled') return null;
  if (!(await cemeteryEnabledForOrg(active.orgId))) return null;
  return {
    orgId: active.orgId,
    role: active.role,
    canManage: MANAGE_ROLES.includes(active.role),
    canRecordPayments: READ_ROLES.includes(active.role),
  };
}
