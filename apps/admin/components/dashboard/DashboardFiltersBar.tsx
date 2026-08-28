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
];

const selectClass =
  'h-9 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary/40';

export function DashboardFiltersBar({
  properties,
  selectedPropertyId,
  selectedPeriod,
}: {
  properties: DashboardPropertyOption[];
  selectedPropertyId: string;
  selectedPeriod: DashboardPeriod;
}) {
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
          value={selectedPeriod === 'custom' ? 'this_month' : selectedPeriod}
          onChange={(e) => updateParams({ period: e.target.value })}
          className={selectClass}
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
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
