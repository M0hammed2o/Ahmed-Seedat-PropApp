import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceRoleClient } from './supabase/server';

/**
 * V1 commercial UX pass -- "before customer confirms a downgrade, show a preview... do not permit
 * a misleading one-click downgrade confirmation that hides the effect." This computes exactly what
 * a downgrade to a target plan would restrict, read-only, using the SAME entitlement primitives
 * (org_active_property_count/org_active_owner_count/org_active_billable_staff_count) that already
 * back getOrganizationEntitlements() -- never a re-derived count. The target plan's allowance is
 * read directly from plans.feature_limits (maxProperties/includedOwners/maxStaff), the same
 * server-authoritative source reconcile_plan_limits() itself reads from, so this preview can never
 * drift from what actually happens once the downgrade takes effect.
 */

export interface DowngradeResourceItem {
  id: string;
  label: string;
}

export interface DowngradeResourceImpact {
  currentUsage: number;
  newAllowance: number | null;
  overBy: number;
  /** Oldest-first, matching reconcile_plan_limits()'s own deterministic keep-order -- the UI can
   * pre-check the first `newAllowance` items to mirror the fallback that applies if the customer
   * makes no explicit choice. */
  items: DowngradeResourceItem[];
}

export interface DowngradeImpact {
  properties: DowngradeResourceImpact;
  staff: DowngradeResourceImpact;
  owners: DowngradeResourceImpact;
  requiresSelection: boolean;
}

export async function computeDowngradeImpact(
  supabase: SupabaseClient,
  orgId: string,
  targetPlanId: string,
): Promise<DowngradeImpact> {
  const { data: targetPlan, error: planError } = await supabase
    .from('plans')
    .select('feature_limits')
    .eq('id', targetPlanId)
    .single();
  if (planError || !targetPlan) throw new Error(planError?.message ?? 'Target plan not found');

  const featureLimits = targetPlan.feature_limits as Record<string, unknown>;
  const maxProperties =
    featureLimits.maxProperties === null || featureLimits.maxProperties === undefined
      ? null
      : Number(featureLimits.maxProperties);
  const maxStaff =
    featureLimits.maxStaff === null || featureLimits.maxStaff === undefined
      ? null
      : Number(featureLimits.maxStaff);
  const includedOwners =
    featureLimits.includedOwners === null || featureLimits.includedOwners === undefined
      ? null
      : Number(featureLimits.includedOwners);

  const [{ data: properties }, { data: staff }, { data: owners }] = await Promise.all([
    supabase
      .from('properties')
      .select('id, nickname, address_line1, created_at')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true }),
    supabase
      .from('organization_members')
      .select('id, user_id, joined_at')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .neq('role', 'principal')
      .order('joined_at', { ascending: true }),
    supabase
      .from('owners')
      .select('id, name, created_at')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true }),
  ]);

  // Staff security + audit hardening pass (this date): same fix as
  // organizations/[orgId]/members/route.ts -- profiles has only an own-row SELECT policy, so this
  // cross-member lookup must go through the service-role client (this function is only ever
  // called from billing/quote/route.ts, already gated by requireBillingPrincipalAccess) rather
  // than the caller's session client, which would silently return zero rows for every staff
  // member except the caller themselves.
  const staffUserIds = (staff ?? []).map((m) => m.user_id);
  const serviceClient = getServiceRoleClient();
  const { data: profiles } =
    staffUserIds.length > 0
      ? await serviceClient.from('profiles').select('id, display_name').in('id', staffUserIds)
      : { data: [] as { id: string; display_name: string | null }[] };
  const displayNameByUserId = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const propertyItems: DowngradeResourceItem[] = (properties ?? []).map((p) => ({
    id: p.id,
    label: p.nickname || p.address_line1,
  }));
  const staffItems: DowngradeResourceItem[] = (staff ?? []).map((m) => ({
    id: m.id,
    label: displayNameByUserId.get(m.user_id) || 'Staff member',
  }));
  const ownerItems: DowngradeResourceItem[] = (owners ?? []).map((o) => ({
    id: o.id,
    label: o.name,
  }));

  const propertiesImpact: DowngradeResourceImpact = {
    currentUsage: propertyItems.length,
    newAllowance: maxProperties,
    overBy: maxProperties === null ? 0 : Math.max(0, propertyItems.length - maxProperties),
    items: propertyItems,
  };
  const staffImpact: DowngradeResourceImpact = {
    currentUsage: staffItems.length,
    newAllowance: maxStaff,
    overBy: maxStaff === null ? 0 : Math.max(0, staffItems.length - maxStaff),
    items: staffItems,
  };
  const ownersImpact: DowngradeResourceImpact = {
    currentUsage: ownerItems.length,
    newAllowance: includedOwners,
    overBy: includedOwners === null ? 0 : Math.max(0, ownerItems.length - includedOwners),
    items: ownerItems,
  };

  return {
    properties: propertiesImpact,
    staff: staffImpact,
    owners: ownersImpact,
    requiresSelection: propertiesImpact.overBy > 0 || staffImpact.overBy > 0 || ownersImpact.overBy > 0,
  };
}
