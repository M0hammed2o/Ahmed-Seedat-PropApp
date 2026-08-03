'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { LayoutGrid, List, Search } from 'lucide-react';
import { PropertyCard, type PropertyCardData } from '@/components/properties/PropertyCard';
import { PropertiesTable } from '@/components/tables/PropertiesTable';
import type { Property } from '@propvault/types';

// Adapted from reference/lovable-ui-reference's properties/index.tsx view toggle
// (UI_INTEGRATION_PLAN.md) -- client-side filter/toggle over the real properties already fetched
// server-side, no new data fetching. List view reuses the existing AdminDataTable-based
// PropertiesTable rather than duplicating a second table implementation.
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-light-textMuted dark:text-dark-textMuted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search properties"
            className="h-9 w-[240px] rounded-xl border border-light-border bg-light-surfaceRaised pr-3 pl-9 text-[13px] text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:bg-dark-surfaceRaised dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-light-border bg-light-surfaceRaised p-1 dark:border-dark-border dark:bg-dark-surfaceRaised">
          <button
            type="button"
            onClick={() => setView('grid')}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            className={`grid h-7 w-7 place-items-center rounded-lg ${
              view === 'grid'
                ? 'bg-light-accentSoft text-light-accent dark:bg-dark-accentSoft dark:text-dark-accent'
                : 'text-light-textMuted dark:text-dark-textMuted'
            }`}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            aria-label="List view"
            aria-pressed={view === 'list'}
            className={`grid h-7 w-7 place-items-center rounded-lg ${
              view === 'list'
                ? 'bg-light-accentSoft text-light-accent dark:bg-dark-accentSoft dark:text-dark-accent'
                : 'text-light-textMuted dark:text-dark-textMuted'
            }`}
          >
            <List size={15} />
          </button>
        </div>
      </div>

      {view === 'grid' ? (
        filteredCards.length === 0 ? (
          <p className="rounded-card border border-light-border bg-light-surfaceRaised py-12 text-center text-sm text-light-textMuted dark:border-dark-border dark:bg-dark-surfaceRaised dark:text-dark-textMuted">
            No properties match &quot;{query}&quot;.
          </p>
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
