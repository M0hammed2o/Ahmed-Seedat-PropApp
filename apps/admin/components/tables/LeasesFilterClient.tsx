'use client';

import type { ReactNode } from 'react';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { LeasesTable, type LeaseRow } from './LeasesTable';

export function LeasesFilterClient({
  leases,
  emptyMessage,
  emptyAction,
}: {
  leases: LeaseRow[];
  emptyMessage?: string;
  emptyAction?: ReactNode;
}) {
  const { query, setQuery, filtered } = useListSearch(
    leases,
    (l) => `${l.unitLabel ?? ''} ${l.propertyNickname ?? ''} ${l.status}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar value={query} onChange={setQuery} placeholder="Search leases by unit or property" />
      <LeasesTable data={filtered} showUnit emptyMessage={emptyMessage} emptyAction={emptyAction} />
    </div>
  );
}
