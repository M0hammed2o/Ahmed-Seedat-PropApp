import type { EntitlementFeature, Subscription } from '@propvault/types';
import { canWrite } from './subscriptionPolicy';
import { getPlan } from './planLimits';

export interface EntitlementCheckContext {
  subscription: Pick<Subscription, 'status' | 'planId'> | null;
  currentPropertyCount?: number;
}

/**
 * The one function every screen/route should call to gate a paid action — never a bespoke
 * `if (subscription.status === 'active')` inline. See SUBSCRIPTIONS.md.
 */
export function hasEntitlement(feature: EntitlementFeature, ctx: EntitlementCheckContext): boolean {
  if (!ctx.subscription) return false;
  if (!canWrite(ctx.subscription.status)) return false;

  const plan = getPlan(ctx.subscription.planId);
  if (!plan) return false;

  if (feature === 'add_property' && ctx.currentPropertyCount !== undefined) {
    return ctx.currentPropertyCount < plan.limits.maxProperties;
  }

  return true;
}
