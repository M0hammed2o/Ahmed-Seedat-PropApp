'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { UnitStatus } from '@propvault/types';
import { UnitsTable, type UnitRow } from '@/components/tables/UnitsTable';

const STATUSES: readonly UnitStatus[] = ['vacant', 'occupied', 'maintenance'];

// Adapted from reference/lovable-ui-reference's units/index.tsx status-tab + search bar literal
// structure (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md) -- client-side filter
// over the real units already fetched server-side, no new data fetching. Lovable's own status set
// (All/Occupied/Vacant/Notice/Maintenance) includes "Notice", which has no equivalent in
// PropertyVault's real `unit_status` enum (vacant/occupied/maintenance only -- "notice" is a
// lease-level concept, not tracked on the unit itself) -- omitted rather than fabricated. Lovable's
// fake "Previous 1 2 Next" pagination footer is also omitted: this page has no real pagination
// (every unit loads in one query), so clickable page-number buttons that go nowhere would be a
// fabricated affordance; a real "Showing X of Y" count replaces it instead.
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
      {/* A separate card above the table, not one seamlessly merged panel like Lovable's --
          AdminDataTable (shared by every list page in this app) always renders its own bordered/
          rounded/shadowed wrapper, and changing that shared component to conditionally drop its
          own chrome would touch every other table page outside this batch's scope. Two visually
          distinct stacked cards is the closest fidelity achievable without that wider change. */}
      <div className="panel grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl bg-surface p-1">
          {(['all', ...STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
                status === s ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
              <span className="tabular rounded-md bg-surface-strong px-1.5 text-[10px]">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search units or properties"
            className="h-9 w-full rounded-xl border border-border bg-card pr-3 pl-9 text-[13px] text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10 sm:w-[240px]"
          />
        </div>
      </div>

      <UnitsTable data={filtered} showProperty emptyMessage="No units match this filter" />

      <p className="text-[12px] text-muted-foreground">
        Showing {filtered.length} of {units.length} units
      </p>
    </div>
  );
}
