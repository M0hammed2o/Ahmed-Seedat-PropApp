'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { DashboardPeriod } from '@/lib/dashboardKpis';

// V1 pre-deployment closeout, Section 1: period-only filter for the property Accounting tab --
// same URL-state pattern as DashboardFiltersBar.tsx (portfolio dashboard), minus the property
// selector (already fixed by page context here). Deliberately the same 3 presets, no
// custom-range picker, for the same "keep it simple" reason DashboardFiltersBar states.

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'ytd', label: 'Year to date' },
];

const selectClass =
  'h-9 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary/40';

export function PropertyAccountingFilterBar({ selectedPeriod }: { selectedPeriod: DashboardPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setPeriod(period: DashboardPeriod) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('period', period);
    params.delete('from');
    params.delete('to');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      Period
      <select
        value={selectedPeriod === 'custom' ? 'this_month' : selectedPeriod}
        onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}
        className={selectClass}
      >
        {PERIOD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
