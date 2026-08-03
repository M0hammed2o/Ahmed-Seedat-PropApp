'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { UnitStatus } from '@propvault/types';
import { UnitsTable, type UnitRow } from '@/components/tables/UnitsTable';

const STATUSES: readonly UnitStatus[] = ['vacant', 'occupied', 'maintenance'];

// Adapted from reference/lovable-ui-reference's units/index.tsx status-tab + search bar
// (UI_INTEGRATION_PLAN.md) -- client-side filter over the real units already fetched server-side,
// same "no new data fetching" approach as PropertiesGridClient.
export function UnitsFilterClient({ units }: { units: UnitRow[] }) {
  const [status, setStatus] = useState<UnitStatus | 'all'>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = { all: units.length };
    for (const s of STATUSES) byStatus[s] = units.filter((u) => u.status === s).length;
    return byStatus;
  }, [units]);

  const filtered = useMemo(
    () =>
      units.filter(
        (u) =>
          (status === 'all' || u.status === status) &&
          (u.unitLabel + (u.propertyNickname ?? '')).toLowerCase().includes(query.toLowerCase()),
      ),
    [units, status, query],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-light-border bg-light-surfaceRaised p-3 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl bg-light-surface p-1 dark:bg-dark-surface">
          {(['all', ...STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
                status === s
                  ? 'bg-light-surfaceRaised text-light-textPrimary shadow-sm dark:bg-dark-surfaceRaised dark:text-dark-textPrimary'
                  : 'text-light-textMuted hover:text-light-textSecondary dark:text-dark-textMuted dark:hover:text-dark-textSecondary'
              }`}
            >
              {s}
              <span className="tabular-nums-feature rounded-md bg-light-surfaceStrong px-1.5 text-[10px] dark:bg-dark-surfaceStrong">
                {counts[s] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="relative shrink-0">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-light-textMuted dark:text-dark-textMuted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search units or properties"
            className="h-9 w-full rounded-xl border border-light-border bg-light-surface pr-3 pl-9 text-[13px] text-light-textPrimary outline-none focus:border-light-accent/40 focus:bg-light-surfaceRaised focus:ring-4 focus:ring-light-accent/10 sm:w-[240px] dark:border-dark-border dark:bg-dark-surface dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:bg-dark-surfaceRaised dark:focus:ring-dark-accent/10"
          />
        </div>
      </div>

      <UnitsTable data={filtered} showProperty emptyMessage="No units match this filter" />
    </div>
  );
}
