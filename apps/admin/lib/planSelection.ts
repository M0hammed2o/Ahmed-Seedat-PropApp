export type PlanTier = 'starter' | 'professional' | 'business';
export type Interval = 'monthly' | 'annual';

const VALID_TIERS = new Set<PlanTier>(['starter', 'professional', 'business']);
const VALID_INTERVALS = new Set<Interval>(['monthly', 'annual']);

export interface PlanSelection {
  tier: PlanTier | null;
  interval: Interval | null;
}

/**
 * Entry-path preservation audit + commercial onboarding fix (this date). Validates a
 * caller-supplied plan/interval pair (from /onboarding/choose-plan's own `?plan=`/`?interval=`
 * query params, themselves carried end-to-end through registration/OAuth/email-confirmation by
 * the existing `next=` continuation mechanism) against the fixed, safe enum. Anything else --
 * missing, misspelled, or an attacker-crafted value -- silently defaults to `null` (no
 * preselection) rather than being trusted, echoed, or surfaced as an error. This is only ever
 * used as a UI pre-selection default; the actual amount charged always comes from
 * `startTrialActivationCheckout()`'s own server-side `planTier`+`interval` -> `plans` row lookup
 * (apps/admin/lib/billing.ts), never from this value or any client-supplied price/amount.
 */
export function parsePlanSelection(
  rawTier: string | undefined,
  rawInterval: string | undefined,
): PlanSelection {
  return {
    tier: rawTier && VALID_TIERS.has(rawTier as PlanTier) ? (rawTier as PlanTier) : null,
    interval:
      rawInterval && VALID_INTERVALS.has(rawInterval as Interval) ? (rawInterval as Interval) : null,
  };
}

/** The choose-plan page's own dynamic self-reference, used as `next=` when it bounces a caller
 *  through /legal-consent or /complete-account -- unlike /onboarding/create-organization's
 *  hardcoded `?next=%2Fonboarding%2Fcreate-organization`, this carries whatever validated
 *  plan/interval selection the caller arrived with back to the exact same page. */
export function buildChoosePlanSelfPath(selection: PlanSelection): string {
  const query = new URLSearchParams();
  if (selection.tier) query.set('plan', selection.tier);
  if (selection.interval) query.set('interval', selection.interval);
  const qs = query.toString();
  return `/onboarding/choose-plan${qs ? `?${qs}` : ''}`;
}
