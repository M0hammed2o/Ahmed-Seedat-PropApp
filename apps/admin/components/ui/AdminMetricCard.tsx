export interface AdminMetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
}

export function AdminMetricCard({ label, value, hint }: AdminMetricCardProps) {
  return (
    <div className="rounded-lg border border-light-border bg-light-surfaceRaised p-5 dark:border-dark-border dark:bg-dark-surfaceRaised">
      <p className="text-xs uppercase tracking-wide text-light-textMuted dark:text-dark-textMuted">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-light-textSecondary dark:text-dark-textSecondary">{hint}</p>
      ) : null}
    </div>
  );
}
