'use client';

import type { Inspection } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { InspectionsTable } from './InspectionsTable';

export function InspectionsFilterClient({ inspections }: { inspections: Inspection[] }) {
  const { query, setQuery, filtered } = useListSearch(
    inspections,
    (i) => `${i.inspectionType} ${i.status}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search inspections by type or status"
      />
      <InspectionsTable data={filtered} />
    </div>
  );
}
