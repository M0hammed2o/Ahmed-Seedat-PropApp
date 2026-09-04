'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { lastTwelveMonthOptions } from '@/lib/budgetMonths';

// Budget page filters (WORKLOG.md this date, §11 of the web property financial setup pass) --
// same URL-state pattern as DashboardFiltersBar.tsx: property + month, shareable/bookmarkable,
// survives the back button.

export interface BudgetPropertyOption {
  id: string;
  nickname: string;
}

const selectClass =
  'h-9 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary/40';

export function BudgetFiltersBar({
  properties,
  selectedPropertyId,
  selectedMonth,
}: {
  properties: BudgetPropertyOption[];
  selectedPropertyId: string;
  selectedMonth: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const monthOptions = lastTwelveMonthOptions();

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `/budget?${qs}` : '/budget');
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
        Month
        <select
          value={selectedMonth}
          onChange={(e) => updateParams({ month: e.target.value })}
          className={selectClass}
        >
          {monthOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {selectedPropertyId ? (
        <button
          type="button"
          onClick={() => router.push('/budget')}
          className="text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
