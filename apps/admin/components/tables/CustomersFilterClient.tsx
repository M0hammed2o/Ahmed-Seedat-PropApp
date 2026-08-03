'use client';

import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { CustomersTable, type CustomerRow } from './CustomersTable';

export function CustomersFilterClient({ customers }: { customers: CustomerRow[] }) {
  const { query, setQuery, filtered } = useListSearch(customers, (c) => `${c.displayName ?? ''} ${c.id}`);

  return (
    <div className="space-y-4">
      <SearchBar value={query} onChange={setQuery} placeholder="Search organizations by name" />
      <CustomersTable data={filtered} />
    </div>
  );
}
