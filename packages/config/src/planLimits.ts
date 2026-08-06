import type { PlanConfig } from '@propvault/types';
import { branding } from './branding';

/**
 * V1 has exactly one plan. Values marked TO_BE_CONFIRMED are commercial decisions for
 * Mohammed, not engineering defaults — see SUBSCRIPTIONS.md. Numeric limits are configurable
 * placeholders chosen to be generous enough not to block early customers.
 */
export const PROPVAULT_BASE_PLAN: PlanConfig = {
  planId: 'propvault_base',
  displayName: `${branding.productName} Base`,
  monthlyPrice: 'TO_BE_CONFIRMED',
  annualPrice: null,
  trialDays: 'TO_BE_CONFIRMED',
  limits: {
    maxProperties: 10,
    storageAllowanceMb: 2048,
    maxFileSizeMb: 25,
    ocrPagesPerMonth: 200,
  },
};

export const PLANS: Record<string, PlanConfig> = {
  [PROPVAULT_BASE_PLAN.planId]: PROPVAULT_BASE_PLAN,
};

export function getPlan(planId: string): PlanConfig | undefined {
  return PLANS[planId];
}
