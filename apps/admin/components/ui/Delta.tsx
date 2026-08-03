// Adapted from reference/lovable-ui-reference's kit.tsx `Delta` (UI_INTEGRATION_PLAN.md) -- a
// period-over-period change indicator. Only rendered where PropertyVault actually computes a
// real prior-period comparison; never a placeholder or estimated figure.

export function Delta({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span
      className={`tabular-nums-feature inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        up
          ? 'bg-light-statusPaid/12 text-light-statusPaid dark:bg-dark-statusPaid/12 dark:text-dark-statusPaid'
          : 'bg-light-statusOverdue/12 text-light-statusOverdue dark:bg-dark-statusOverdue/12 dark:text-dark-statusOverdue'
      }`}
    >
      {up ? '▲' : '▼'} {Math.abs(value)}
      {suffix}
    </span>
  );
}
