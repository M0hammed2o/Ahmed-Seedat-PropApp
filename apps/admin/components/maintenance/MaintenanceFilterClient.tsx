'use client';

import type { MaintenanceTicket } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { MaintenanceBoard } from './MaintenanceBoard';

export function MaintenanceFilterClient({ tickets }: { tickets: MaintenanceTicket[] }) {
  const { query, setQuery, filtered } = useListSearch(
    tickets,
    (t) => `${t.summary} ${t.description ?? ''} ${t.priority}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar value={query} onChange={setQuery} placeholder="Search maintenance tickets" />
      <MaintenanceBoard tickets={filtered} />
    </div>
  );
}
