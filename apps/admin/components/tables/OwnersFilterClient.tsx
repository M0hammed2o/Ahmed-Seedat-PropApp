'use client';

import type { ReactNode } from 'react';
import type { Owner } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { OwnersTable } from './OwnersTable';

export function OwnersFilterClient({
  owners,
  emptyAction,
}: {
  owners: Owner[];
  emptyAction?: ReactNode;
}) {
  const { query, setQuery, filtered } = useListSearch(
    owners,
    (o) => `${o.name} ${o.email ?? ''} ${o.phone ?? ''}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search owners by name, email, or phone"
      />
      <OwnersTable data={filtered} emptyAction={emptyAction} />
    </div>
  );
}
