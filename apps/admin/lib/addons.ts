import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBillingGatewayProvider } from './providers/billing';

/**
 * V1 commercial UX pass -- add-on purchasing (extra property/owner capacity). Prefers amending the
 * org's EXISTING PayFast subscription over creating a second, competing one ("one coherent
 * recurring obligation per organisation") -- provider.updateSubscriptionAmount() is a synchronous,
 * authenticated server-to-server call (same trust model as cancelSubscription/refundPayment); new
 * capacity is only ever granted from THIS call's own success, never from browser-return state.
 *
 * Server-authoritative pricing throughout: unit price, plan support, and the resulting total
 * recurring amount are ALL derived here from plans.feature_limits/organization_subscriptions --
 * never from any client-supplied number. set_property_addon_capacity()/set_owner_addon_capacity()
 * (migration 20260101000122) independently re-validate plan support and reject an unhandled
 * over-limit removal, so a bug here can never silently grant capacity the database itself would
 * refuse.
 */

export type AddonResourceType = 'property' | 'owner';

export interface SetAddonCapacityInput {
  orgId: string;
  resourceType: AddonResourceType;
  targetQuantity: number;
  keepIds?: string[] | null;
  actorUserId: string;
  idempotencyKey: string;
}

export interface SetAddonCapacityResult {
  resourceType: AddonResourceType;
  newQuantity: number;
  newRecurringAmount: number;
  currency: string;
}

export async function setAddonCapacity(
  serviceClient: SupabaseClient,
  input: SetAddonCapacityInput,
): Promise<SetAddonCapacityResult> {
  if (!Number.isInteger(input.targetQuantity) || input.targetQuantity < 0) {
    throw new Error('invalid_addon_quantity: target quantity must be a non-negative integer');
  }

  const { data: sub, error: subError } = await serviceClient
    .from('organization_subscriptions')
    .select(
      'id, plan_id, billing_cycle, provider_subscription_token, purchased_extra_properties, purchased_extra_owner_slots',
    )
    .eq('org_id', input.orgId)
    .order('current_period_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (subError || !sub)
    throw new Error(subError?.message ?? 'no_subscription: organization has no subscription on record');

  const { data: plan, error: planError } = await serviceClient
    .from('plans')
    .select('base_price, currency, feature_limits')
    .eq('id', sub.plan_id)
    .single();
  if (planError || !plan) throw new Error(planError?.message ?? 'Plan not found');

  const featureLimits = plan.feature_limits as Record<string, number | boolean | null>;
  const extraPropertyPrice =
    typeof featureLimits.extraPropertyPrice === 'number' ? featureLimits.extraPropertyPrice : null;
  const extraOwnerPrice =
    typeof featureLimits.extraOwnerPrice === 'number' ? featureLimits.extraOwnerPrice : null;

  const unitPrice = input.resourceType === 'property' ? extraPropertyPrice : extraOwnerPrice;
  if (unitPrice === null) {
    throw new Error(
      `addon_not_supported_by_plan: this plan does not offer ${input.resourceType === 'property' ? 'extra property' : 'extra owner'} capacity`,
    );
  }

  // The resulting TOTAL recurring amount PayFast must charge: base plan price + BOTH add-on
  // categories at their post-change quantities (never just the one being changed) -- "base +
  // current add-ons must become the new recurring amount." Annual subscribers pay the add-on's
  // plain monthly price times 12, never discounted the way the base plan is (a deliberate, disclosed
  // policy -- R99/R199 are capacity add-ons, not part of the negotiated annual base rate).
  const annualMultiplier = sub.billing_cycle === 'annual' ? 12 : 1;
  const newPropertyQuantity =
    input.resourceType === 'property' ? input.targetQuantity : sub.purchased_extra_properties;
  const newOwnerQuantity =
    input.resourceType === 'owner' ? input.targetQuantity : sub.purchased_extra_owner_slots;
  const newRecurringAmount =
    Number(plan.base_price) +
    newPropertyQuantity * (extraPropertyPrice ?? 0) * annualMultiplier +
    newOwnerQuantity * (extraOwnerPrice ?? 0) * annualMultiplier;

  if (!sub.provider_subscription_token) {
    throw new Error(
      'no_active_subscription_token: this organization has no active PayFast subscription to amend -- complete commercial setup first',
    );
  }

  // A REMOVAL that would leave the org over its new effective capacity is rejected BEFORE ever
  // touching the gateway -- calling PayFast first and only then discovering the local RPC must
  // reject would leave the gateway's recurring amount already lowered while local capacity (and
  // therefore what the org is actually allowed to use) never followed. This mirrors the SAME
  // over-limit condition set_property_addon_capacity()/set_owner_addon_capacity() (migration
  // 20260101000122) independently enforce -- kept in sync deliberately, not duplicated logic
  // trusted instead of the database's own check, which still re-validates unconditionally below.
  const currentQuantity =
    input.resourceType === 'property' ? sub.purchased_extra_properties : sub.purchased_extra_owner_slots;
  if (input.targetQuantity < currentQuantity && !input.keepIds) {
    const table = input.resourceType === 'property' ? 'properties' : 'owners';
    const baseLimitKey = input.resourceType === 'property' ? 'maxProperties' : 'includedOwners';
    const baseLimit = Number(featureLimits[baseLimitKey] ?? 0);
    const { count: activeCount } = await serviceClient
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', input.orgId)
      .eq('status', 'active');
    const newEffectiveLimit = baseLimit + input.targetQuantity;
    if ((activeCount ?? 0) > newEffectiveLimit) {
      throw new Error(
        `addon_removal_requires_selection: ${activeCount} ${input.resourceType === 'property' ? 'properties' : 'owners'} in use exceeds the new ${newEffectiveLimit} capacity -- choose which stay active first`,
      );
    }
  }

  const provider = getBillingGatewayProvider();
  await provider.updateSubscriptionAmount(sub.provider_subscription_token, {
    amount: newRecurringAmount,
    idempotencyKey: input.idempotencyKey,
  });

  // Only NOW, after the gateway amendment itself has succeeded, does capacity actually change --
  // never on browser-return alone. The RPC re-validates plan support and over-limit removal
  // independently; this call never trusts its own earlier checks as sufficient.
  const rpcName = input.resourceType === 'property' ? 'set_property_addon_capacity' : 'set_owner_addon_capacity';
  const rpcArgs =
    input.resourceType === 'property'
      ? {
          p_org_id: input.orgId,
          p_target_quantity: input.targetQuantity,
          p_keep_property_ids: input.keepIds ?? null,
          p_actor_user_id: input.actorUserId,
        }
      : {
          p_org_id: input.orgId,
          p_target_quantity: input.targetQuantity,
          p_keep_owner_ids: input.keepIds ?? null,
          p_actor_user_id: input.actorUserId,
        };
  const { data: newQuantity, error: rpcError } = await serviceClient.rpc(rpcName, rpcArgs);
  if (rpcError) throw new Error(rpcError.message);

  return {
    resourceType: input.resourceType,
    newQuantity: Number(newQuantity),
    newRecurringAmount,
    currency: plan.currency,
  };
}
