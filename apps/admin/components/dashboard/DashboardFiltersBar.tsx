'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { DashboardPeriod } from '@/lib/dashboardKpis';

// Portfolio dashboard filters pass (V1 launch-completion, this date): property + period filter bar
// for the main dashboard, same URL-state pattern as DocumentsFilterClient.tsx (updateParams merges
// into the existing querystring via useSearchParams, then router.push -- shareable/bookmarkable,
// survives the back button). Only the property select and the 3 period presets are exposed in the
// UI; `period=custom&from=&to=` is supported by resolvePeriodRange (lib/dashboardKpis.ts) for future
// use but has no date-picker here -- a deliberate "keep it simple" scope cut, not an oversight.

export interface DashboardPropertyOption {
  id: string;
  nickname: string;
}

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'last_12_months', label: 'Last 12 months' },
];

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

const selectClass =
  'h-9 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary/40';

export function DashboardFiltersBar({
  properties,
  selectedPropertyId,
  selectedPeriod,
  selectedFrom,
  selectedTo,
}: {
  properties: DashboardPropertyOption[];
  selectedPropertyId: string;
  selectedPeriod: DashboardPeriod;
  /** Bounds of a custom range (period=custom), used to show the chosen month or year. */
  selectedFrom?: string;
  selectedTo?: string;
}) {
  const thisYear = new Date().getFullYear();
  const isWholeMonth =
    selectedPeriod === 'custom' &&
    Boolean(selectedFrom?.endsWith('-01')) &&
    selectedTo === lastDayOfMonth(selectedFrom!.slice(0, 7));
  const isWholeYear =
    selectedPeriod === 'custom' &&
    Boolean(selectedFrom?.endsWith('-01-01')) &&
    selectedTo === `${selectedFrom!.slice(0, 4)}-12-31`;
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // A custom range only makes sense alongside period=custom -- switching the period preset away
    // from custom drops any stale from/to bounds instead of silently keeping them around unused.
    if (next.period && next.period !== 'custom') {
      params.delete('from');
      params.delete('to');
    }
    const qs = params.toString();
    router.push(qs ? `/dashboard?${qs}` : '/dashboard');
  }

  return (
    <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        Property
        <select
          value={selectedPropertyId}
          onChange={(e) => updateParams({ propertyId: e.target.value || null })}
          className={selectClass}
        >
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nickname}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        Period
        <select
          value={selectedPeriod === 'custom' ? 'custom' : selectedPeriod}
          onChange={(e) => updateParams({ period: e.target.value })}
          className={selectClass}
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {selectedPeriod === 'custom' ? <option value="custom">Chosen month / year</option> : null}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        Month
        <input
          type="month"
          aria-label="Show a single month"
          value={isWholeMonth ? selectedFrom!.slice(0, 7) : ''}
          max={`${thisYear}-12`}
          onChange={(e) =>
            e.target.value
              ? updateParams({
                  period: 'custom',
                  from: `${e.target.value}-01`,
                  to: lastDayOfMonth(e.target.value),
                })
              : undefined
          }
          className={selectClass}
        />
      </label>

      <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        Year
        <select
          aria-label="Show a calendar year"
          value={isWholeYear ? selectedFrom!.slice(0, 4) : ''}
          onChange={(e) =>
            e.target.value
              ? updateParams({
                  period: 'custom',
                  from: `${e.target.value}-01-01`,
                  to: `${e.target.value}-12-31`,
                })
              : undefined
          }
          className={selectClass}
        >
          <option value="">—</option>
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>

      {selectedPropertyId || selectedPeriod !== 'this_month' ? (
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
