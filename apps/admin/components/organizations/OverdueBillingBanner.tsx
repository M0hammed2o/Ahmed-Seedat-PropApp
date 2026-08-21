import Link from 'next/link';

/**
 * V1 commercial onboarding pass, Phase 18 -- advance warning during the 7-day grace period
 * (organizations.status = 'overdue', see expire_trials_and_suspend_overdue() migration
 * 20260101000076). Deliberately NOT a redirect/dead-end like /access-restricted (suspended/
 * cancelled orgs) -- full access continues during the grace period, this banner just makes the
 * risk visible everywhere, not only to a principal who happens to open the billing page. Renders
 * inside AppShell's `banner` slot, same slot SupportModeBanner uses.
 */
export function OverdueBillingBanner({ canManageBilling }: { canManageBilling: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-light-warning px-4 py-2 text-xs font-medium text-white dark:bg-dark-warning">
      <span>
        Your last payment didn&rsquo;t go through. Full access continues during a 7-day grace
        period, but access will be restricted if this isn&rsquo;t resolved.
      </span>
      {canManageBilling ? (
        <Link
          href="/organization/billing"
          className="shrink-0 rounded-md border border-white/40 px-2.5 py-1 hover:bg-white/10"
        >
          Update payment method
        </Link>
      ) : null}
    </div>
  );
}
