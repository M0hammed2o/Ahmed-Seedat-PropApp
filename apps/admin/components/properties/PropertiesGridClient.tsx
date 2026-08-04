'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { LayoutGrid, List, Search, SlidersHorizontal } from 'lucide-react';
import { PropertyCard, type PropertyCardData } from '@/components/properties/PropertyCard';
import { PropertiesTable } from '@/components/tables/PropertiesTable';
import type { Property } from '@propvault/types';

// Adapted from reference/lovable-ui-reference's properties/index.tsx search/filter/view-toggle
// bar (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md) -- client-side filter/toggle
// over the real properties already fetched server-side, no new data fetching.
//
// Lovable's own status filter tabs (All/Stabilised/Leasing/Renovation) are deliberately not
// ported: those are operational-lifecycle labels PropertyVault's schema has no equivalent for --
// `properties.status` is only ever `active`/`archived` (this page already only ever shows
// `active` rows), and leasing/occupancy state lives on `units`, not `properties`. Fabricating
// three property-level statuses with no real backing field would misrepresent every property's
// actual state, so the tabs are omitted rather than wired to something they don't mean.
//
// The "Filters" button IS kept, unwired -- checked against Lovable's own source first: its
// onClick is empty there too (a real, pre-existing gap in the donor project itself, not something
// introduced here), so reproducing it exactly is the literal-adaptation choice, not a new fake
// affordance invented for this app.
export function PropertiesGridClient({
  cards,
  tableData,
  emptyAction,
}: {
  cards: PropertyCardData[];
  tableData: Property[];
  emptyAction?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const filteredCards = useMemo(
    () => cards.filter((c) => (c.nickname + c.city + c.fullAddress).toLowerCase().includes(query.toLowerCase())),
    [cards, query],
  );
  const filteredIds = useMemo(() => new Set(filteredCards.map((c) => c.id)), [filteredCards]);
  const filteredTableData = useMemo(() => tableData.filter((p) => filteredIds.has(p.id)), [tableData, filteredIds]);

  if (cards.length === 0) {
    return <PropertiesTable data={[]} emptyAction={emptyAction} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search properties"
              className="h-9 w-[220px] rounded-xl border border-border bg-card pr-3 pl-9 text-[13px] text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
            />
          </div>
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-[12px] font-medium text-muted-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Filters
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setView('grid')}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            className={`grid h-7 w-7 place-items-center rounded-lg ${view === 'grid' ? 'bg-primary-soft text-primary' : 'text-muted-foreground'}`}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            aria-label="List view"
            aria-pressed={view === 'list'}
            className={`grid h-7 w-7 place-items-center rounded-lg ${view === 'list' ? 'bg-primary-soft text-primary' : 'text-muted-foreground'}`}
          >
            <List className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {view === 'grid' ? (
        filteredCards.length === 0 ? (
          <p className="panel py-12 text-center text-sm text-muted-foreground">No properties match &quot;{query}&quot;.</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredCards.map((c) => (
              <PropertyCard key={c.id} property={c} />
            ))}
          </div>
        )
      ) : (
        <PropertiesTable data={filteredTableData} />
      )}
    </div>
  );
}
