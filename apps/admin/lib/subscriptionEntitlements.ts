import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSeatSummary, OrganizationEntitlements } from '@propvault/types';
import { requireOrgRole } from './portfolio';

export type { OrgSeatSummary, OrganizationEntitlements };

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
 * organization/portfolio. False for a "linked owner or tenant only" account -- has an
 * `owners.user_id` or `tenants.user_id` row somewhere, holds zero active `organization_members`
 * rows of their own, and has not been explicitly granted an `owner_portfolio_grants` row (tenant
 * case added migration 20260101000095). True for every ordinary fresh signup (unaffected by
 * either migration) and every user who already runs at least one organization.
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
 * account has no org membership anywhere to create a property IN, so the role check is a thin,
 * named alias. RELEASE A P0 fix: this now ALSO consults the org's real property-count limit
 * (`available_property_slots()`, migration 20260101000102) -- the exact "future per-org
 * property-count limit" this function's own comment anticipated when it was written. The real
 * enforcement lives inside `create_property()` itself (unbypassable via raw PostgREST -- there is
 * no client-facing INSERT policy on `properties` at all); this function exists so the API route
 * can render a specific "upgrade your plan" message instead of surfacing the RPC's raw exception
 * text, matching `canInviteStaff()`'s own "friendlier message at the API layer" split below. */
export async function mayCreateProperty(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const canWrite = await requireOrgRole(supabase, orgId, 'agent');
  if (!canWrite) return false;
  const { data, error } = await supabase.rpc('available_property_slots', { p_org_id: orgId });
  if (error) throw new Error(`available_property_slots RPC failed: ${error.message}`);
  return data === null || Number(data) > 0;
}

/**
 * RELEASE A P0 fix (V1 Commercial Launch Gap Audit): the ONE authoritative entitlement snapshot
 * for an organization -- every property-limit/feature-gate check in the app reads from this
 * function's return value (or the individual `canUse*` helpers below, which call it), never a
 * bespoke re-derivation. Backed entirely by database RPCs (`org_property_limit()`,
 * `org_active_property_count()`, `available_property_slots()`, `org_feature_enabled()`, migration
 * 20260101000102) -- same "the database is the real enforcement, this is a thin named wrapper"
 * posture as `mayCreatePortfolio()`/`getOrgSeatSummary()` above.
 */
export async function getOrganizationEntitlements(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrganizationEntitlements> {
  const [
    limit,
    count,
    slots,
    ocr,
    ownerPortal,
    advancedReporting,
    bulkCommunications,
    apiAccess,
    ownerLimit,
    ownerCount,
    ownerSlots,
    multiOwnerManagement,
  ] = await Promise.all([
    supabase.rpc('org_property_limit', { p_org_id: orgId }),
    supabase.rpc('org_active_property_count', { p_org_id: orgId }),
    supabase.rpc('available_property_slots', { p_org_id: orgId }),
    supabase.rpc('org_feature_enabled', { p_org_id: orgId, p_feature_key: 'ocrEnabled' }),
    supabase.rpc('org_feature_enabled', { p_org_id: orgId, p_feature_key: 'ownerPortalEnabled' }),
    supabase.rpc('org_feature_enabled', { p_org_id: orgId, p_feature_key: 'advancedReporting' }),
    supabase.rpc('org_feature_enabled', { p_org_id: orgId, p_feature_key: 'bulkCommunications' }),
    supabase.rpc('org_feature_enabled', { p_org_id: orgId, p_feature_key: 'apiAccess' }),
    supabase.rpc('org_owner_limit', { p_org_id: orgId }),
    supabase.rpc('org_active_owner_count', { p_org_id: orgId }),
    supabase.rpc('available_owner_slots', { p_org_id: orgId }),
    supabase.rpc('org_feature_enabled', { p_org_id: orgId, p_feature_key: 'multiOwnerManagement' }),
  ]);
  for (const [name, result] of [
    ['org_property_limit', limit],
    ['org_active_property_count', count],
    ['available_property_slots', slots],
    ['org_feature_enabled(ocrEnabled)', ocr],
    ['org_feature_enabled(ownerPortalEnabled)', ownerPortal],
    ['org_feature_enabled(advancedReporting)', advancedReporting],
    ['org_feature_enabled(bulkCommunications)', bulkCommunications],
    ['org_feature_enabled(apiAccess)', apiAccess],
    ['org_owner_limit', ownerLimit],
    ['org_active_owner_count', ownerCount],
    ['available_owner_slots', ownerSlots],
    ['org_feature_enabled(multiOwnerManagement)', multiOwnerManagement],
  ] as const) {
    if (result.error) throw new Error(`${name} RPC failed: ${result.error.message}`);
  }

  return {
    propertyLimit: limit.data === null ? null : Number(limit.data),
    activePropertyCount: Number(count.data ?? 0),
    availablePropertySlots: slots.data === null ? null : Number(slots.data),
    ocrEnabled: ocr.data === true,
    ownerPortalEnabled: ownerPortal.data === true,
    advancedReporting: advancedReporting.data === true,
    bulkCommunications: bulkCommunications.data === true,
    apiAccess: apiAccess.data === true,
    ownerLimit: ownerLimit.data === null ? null : Number(ownerLimit.data),
    activeOwnerCount: Number(ownerCount.data ?? 0),
    availableOwnerSlots: ownerSlots.data === null ? null : Number(ownerSlots.data),
    multiOwnerManagement: multiOwnerManagement.data === true,
  };
}

/** Real, gated: whether the org may add another external owner (owners.status = 'active' row) --
 * enforced unbypassably by the owners_insert_agent_plus_capacity RLS policy (migration
 * 20260101000112); this is the "friendlier message at the API layer" wrapper, same split every
 * other canUse-/mayCreate-style helper in this file already establishes. */
export async function mayAddExternalOwner(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('available_owner_slots', { p_org_id: orgId });
  if (error) throw new Error(`available_owner_slots RPC failed: ${error.message}`);
  return data === null || Number(data) > 0;
}

/** Real, gated feature: the three OCR extraction routes (documents/leases/levy-statements). */
export async function canUseOcr(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('org_feature_enabled', {
    p_org_id: orgId,
    p_feature_key: 'ocrEnabled',
  });
  if (error) throw new Error(`org_feature_enabled RPC failed: ${error.message}`);
  return data === true;
}

/** Real, gated feature: inviting a property owner to their own portal login. */
export async function canUseOwnerPortal(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('org_feature_enabled', {
    p_org_id: orgId,
    p_feature_key: 'ownerPortalEnabled',
  });
  if (error) throw new Error(`org_feature_enabled RPC failed: ${error.message}`);
  return data === true;
}

/** Real, gated feature: the tax-pack CSV export (ACCOUNTING.md §7) -- the closest thing to a
 * distinct "advanced reporting" surface this codebase actually has (confirmed by audit -- there is
 * no separate basic/advanced reporting split anywhere else). */
export async function canUseAdvancedReporting(
  supabase: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('org_feature_enabled', {
    p_org_id: orgId,
    p_feature_key: 'advancedReporting',
  });
  if (error) throw new Error(`org_feature_enabled RPC failed: ${error.message}`);
  return data === true;
}

/**
 * RELEASE A audit finding: no bulk-communication feature (sending one message to many
 * tenants/owners at once) exists anywhere in this codebase today -- every dispatchEmail()/
 * dispatchWhatsApp() call site sends to exactly one recipient tied to one event. Per the task's own
 * instruction ("do NOT pretend a feature exists merely to gate it"), this deliberately always
 * returns true (nothing to restrict) rather than gating a feature that isn't real. Kept as its own
 * function, not deleted, so the day a real bulk-send feature is built, this is the one place to
 * flip to `org_feature_enabled(supabase, orgId, 'bulkCommunications')` -- exactly this file's own
 * established "one place to live" precedent (mayCreateProperty's own comment history).
 */
export async function canUseBulkCommunications(): Promise<boolean> {
  return true;
}

/**
 * RELEASE A audit finding: no external/API-key-authenticated access surface exists anywhere in
 * this codebase today -- every route is session-cookie or bearer-JWT (the app's own users),
 * there is no third-party API product. Deliberately always returns true (nothing to restrict) for
 * the same "do not gate a feature that isn't real" reasoning as canUseBulkCommunications() above.
 */
export async function canUseApiAccess(): Promise<boolean> {
  return true;
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
