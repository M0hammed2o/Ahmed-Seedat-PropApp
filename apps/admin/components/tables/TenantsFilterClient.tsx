'use client';

import type { ReactNode } from 'react';
import type { Tenant } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { TenantsTable } from './TenantsTable';

export function TenantsFilterClient({ tenants, emptyAction }: { tenants: Tenant[]; emptyAction?: ReactNode }) {
  const { query, setQuery, filtered } = useListSearch(
    tenants,
    (t) => `${t.fullName} ${t.email ?? ''} ${t.phone ?? ''}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar value={query} onChange={setQuery} placeholder="Search tenants by name, email, or phone" />
      <TenantsTable data={filtered} emptyAction={emptyAction} />
    </div>
  );
}
