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
 */
export function HealthStatusIndicator({ label, status }: { label: string; status: HealthStatus }) {
  const presentation = PRESENTATION[status];
  return (
    <div className="flex items-center justify-between border-b border-light-border py-3 last:border-b-0 dark:border-dark-border">
      <span className="text-sm text-light-textPrimary dark:text-dark-textPrimary">{label}</span>
      <span className="flex items-center gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
        <span className={`h-2 w-2 rounded-full ${presentation.dotClass}`} />
        {presentation.label}
      </span>
    </div>
  );
}
