import Link from 'next/link';
import { Lock } from 'lucide-react';

/**
 * V1 commercial UX pass -- a consistent "locked, upgrade to unlock" treatment for a feature the
 * org's current plan doesn't include. Backend entitlements (org_feature_enabled(), migration
 * 20260101000102) remain the real, unbypassable enforcement -- this is purely presentational, so a
 * customer sees WHY a control is unavailable and what to do about it, rather than the control
 * simply vanishing or silently failing server-side. "Do not hide everything completely where
 * showing the capability is commercially useful" -- always names the feature and the plan that
 * unlocks it.
 */
export function FeatureLockNotice({
  feature,
  requiredPlanName,
}: {
  feature: string;
  requiredPlanName: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-light-border bg-light-surfaceStrong px-3 py-2 text-sm dark:border-dark-border dark:bg-dark-surfaceStrong">
      <Lock size={16} className="shrink-0 text-light-textMuted dark:text-dark-textMuted" />
      <span className="text-light-textSecondary dark:text-dark-textSecondary">
        {feature} is available on {requiredPlanName}.
      </span>
      <Link
        href="/organization/billing"
        className="ml-auto shrink-0 text-xs font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        Upgrade
      </Link>
    </div>
  );
}
