'use client';

import { useState } from 'react';
import { Columns3, Rows3 } from 'lucide-react';
import type { MaintenanceTicket } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { MaintenanceTable } from '@/components/tables/MaintenanceTable';
import { MaintenanceBoard } from './MaintenanceBoard';

// Adapted from reference/lovable-ui-reference's maintenance/index.tsx Board/Table view toggle
// (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md), added alongside the existing real
// MaintenanceBoard (already a genuine grouped-by-status kanban, PROPVIEW_SCREENSHOT_AUDIT.md
// IMG_7967-7968) rather than replacing it. Table view reuses the existing MaintenanceTable
// (AdminDataTable-based, same component the Property Detail maintenance tab already uses).
export function MaintenanceFilterClient({ tickets }: { tickets: MaintenanceTicket[] }) {
  const [view, setView] = useState<'board' | 'table'>('board');
  const { query, setQuery, filtered } = useListSearch(
    tickets,
    (t) => `${t.summary} ${t.description ?? ''} ${t.priority}`,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-md flex-1">
          <SearchBar value={query} onChange={setQuery} placeholder="Search maintenance tickets" />
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setView('board')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium ${
              view === 'board' ? 'bg-primary-soft text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Columns3 className="h-3.5 w-3.5" aria-hidden="true" /> Board
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium ${
              view === 'table' ? 'bg-primary-soft text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Rows3 className="h-3.5 w-3.5" aria-hidden="true" /> Table
          </button>
        </div>
      </div>

      {view === 'board' ? <MaintenanceBoard tickets={filtered} /> : <MaintenanceTable data={filtered} />}
    </div>
  );
}
