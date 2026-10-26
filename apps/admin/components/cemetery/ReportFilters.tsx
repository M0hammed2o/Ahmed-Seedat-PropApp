'use client';

import { useRouter, useSearchParams } from 'next/navigation';

const selectClass =
  'h-9 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary/40';

/** URL-state filters for the cemetery reports (same pattern as DashboardFiltersBar): period, then a month to inspect. */
export function ReportFilters({
  basePath,
  periods,
  period,
  months,
  month,
}: {
  basePath: string;
  periods: { value: string; label: string }[];
  period: string;
  months: { value: string; label: string }[];
  month: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  function update(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }
  return (
    <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        Period
        <select
          value={period}
          onChange={(e) => update({ period: e.target.value, month: null })}
          className={selectClass}
          aria-label="Report period"
        >
          {periods.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        Month
        <select
          value={month}
          onChange={(e) => update({ month: e.target.value || null })}
          className={selectClass}
          aria-label="Inspect month"
        >
          <option value="">Whole period</option>
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
