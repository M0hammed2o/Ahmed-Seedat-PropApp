export type HealthStatus = 'connected' | 'not_connected' | 'degraded';

const PRESENTATION: Record<HealthStatus, { label: string; dotClass: string }> = {
  connected: { label: 'Connected', dotClass: 'bg-light-statusPaid dark:bg-dark-statusPaid' },
  degraded: {
    label: 'Degraded',
    dotClass: 'bg-light-statusNeedsReview dark:bg-dark-statusNeedsReview',
  },
  not_connected: {
    label: 'Not yet connected',
    dotClass: 'bg-light-textMuted dark:bg-dark-textMuted',
  },
};

/**
 * Status always paired with a text label, never colour alone (DESIGN_SYSTEM.md accessibility
 * rule, applied consistently across mobile and admin).
 *
 * `detail` (optional, final pre-UAT engineering pass, WORKLOG.md this date): a short identifier
 * shown alongside the connected/not-connected dot -- e.g. a provider name ("google-document-ai")
 * so Mohammed can confirm WHICH vendor is actually active without reading server logs or a
 * database column. Never a credential value -- only ever a `providerName` string, which every
 * provider abstraction in this codebase already exposes as non-secret identity metadata.
 */
export function HealthStatusIndicator({
  label,
  status,
  detail,
}: {
  label: string;
  status: HealthStatus;
  detail?: string;
}) {
  const presentation = PRESENTATION[status];
  return (
    <div className="flex items-center justify-between border-b border-light-border py-3 last:border-b-0 dark:border-dark-border">
      <span className="text-sm text-light-textPrimary dark:text-dark-textPrimary">{label}</span>
      <span className="flex items-center gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
        <span className={`h-2 w-2 rounded-full ${presentation.dotClass}`} />
        {presentation.label}
        {detail ? (
          <span className="text-light-textMuted dark:text-dark-textMuted">({detail})</span>
        ) : null}
      </span>
    </div>
  );
}
