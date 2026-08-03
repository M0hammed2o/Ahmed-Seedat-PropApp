'use client';

import type { Application } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { ApplicationsTable } from './ApplicationsTable';

export function ApplicationsFilterClient({ applications }: { applications: Application[] }) {
  const { query, setQuery, filtered } = useListSearch(
    applications,
    (a) => `${a.applicantName} ${a.applicantEmail ?? ''}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar value={query} onChange={setQuery} placeholder="Search applications by applicant name or email" />
      <ApplicationsTable data={filtered} />
    </div>
  );
}
