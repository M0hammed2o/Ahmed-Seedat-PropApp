import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSeatSummary } from '@propvault/types';
import { requireOrgRole } from './portfolio';

export type { OrgSeatSummary };

/**
 * Owner subscription + staff seat entitlement boundary (WORKLOG.md this date). One business-
 * domain abstraction the rest of the app consumes instead of scattering
 * plan/subscription/seat-count queries across property/staff/organization pages -- exactly the
 * "consume entitlement state through one abstraction" requirement this was built for.
 *
 * The actual decisions live in Postgres (`may_create_portfolio()`, `available_staff_seats()` etc,
 * migration 20260101000094) for the same reason `requireOrgRole()` below calls `has_org_role()`
 * by RPC rather than re-implementing it in TypeScript: those functions are also the RLS/RPC-level
 * enforcement (organization_invites' INSERT policy, create_organization() itself), so a
 * TypeScript-only copy would be a second source of truth that could drift from what's actually
 * enforced. This module is a thin, well-named wrapper -- if it returns a wrong answer, the UI is
 * wrong; the database still enforces the real rule regardless.
 *
 * Deliberately does NOT implement real billing (PayFast/Apple/Google) -- see
 * `/api/v1/admin/owner-portfolio-grants`'s own comment and SUBSCRIPTIONS.md. When a real payment
 * provider is wired up later, it should populate `owner_portfolio_grants` and
 * `organization_subscriptions`/`plans` the same way that super-admin route does manually today --
 * the entitlement CHECKS (`mayCreatePortfolio`, `getOrgSeatSummary`) do not need to change.
 */

/**
 * Whether the calling user (the session-bound client's own auth.uid(), or an explicit
 * `targetUserId` for the super-admin grant-management routes) may create their own
 * organization/portfolio. False only for a "linked owner only" account -- has an `owners.user_id`
 * row somewhere, holds zero active `organization_members` rows of their own, and has not been
 * explicitly granted an `owner_portfolio_grants` row. True for every ordinary fresh signup
 * (unaffected by this migration) and every user who already runs at least one organization.
 */
export async function mayCreatePortfolio(
  supabase: SupabaseClient,
  targetUserId?: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'may_create_portfolio',
    targetUserId ? { p_user_id: targetUserId } : undefined,
  );
  if (error) throw new Error(`may_create_portfolio RPC failed: ${error.message}`);
  return data === true;
}

/** Property creation is already org-scoped (`requireOrgRole('agent')`) -- a linked-owner-only
 * account has no org membership anywhere to create a property IN, so this is a thin, named alias
 * rather than new logic. Kept as its own function (matching the task's own `may_create_property`
 * vocabulary) so a future per-org property-count limit has one place to live. */
export async function mayCreateProperty(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  return requireOrgRole(supabase, orgId, 'agent');
}

/** Staff seat accounting for one organization. */
export async function getOrgSeatSummary(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgSeatSummary> {
  const [limitResult, countResult] = await Promise.all([
    supabase.rpc('org_staff_seat_limit', { p_org_id: orgId }),
    supabase.rpc('org_active_billable_staff_count', { p_org_id: orgId }),
  ]);
  if (limitResult.error)
    throw new Error(`org_staff_seat_limit RPC failed: ${limitResult.error.message}`);
  if (countResult.error)
    throw new Error(`org_active_billable_staff_count RPC failed: ${countResult.error.message}`);

  const seatLimit = limitResult.data === null ? null : Number(limitResult.data);
  const activeBillableStaffCount = Number(countResult.data ?? 0);
  const availableSeats = seatLimit === null ? null : seatLimit - activeBillableStaffCount;

  return { seatLimit, activeBillableStaffCount, availableSeats };
}

/** may_invite_staff?: org already needs manager+ (checked separately, `requireOrgRole`) -- this
 * answers the orthogonal question "does this org have a free seat to put them in." Seat
 * entitlement and role/property permissions are deliberately separate checks (a paid seat answers
 * "may this member exist," never "what may they access"). */
export function canInviteStaff(seatSummary: OrgSeatSummary): boolean {
  return seatSummary.availableSeats === null || seatSummary.availableSeats > 0;
}
