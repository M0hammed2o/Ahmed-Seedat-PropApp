'use client';

import { useRouter } from 'next/navigation';
import type { RentSchedule } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { RentScheduleTable } from '@/components/tables/RentScheduleTable';

// Thin client wrapper to own useRouter().refresh() (invoice-issued re-fetch callback) and the
// search box (PWA_V1_COMPLETION_PLAN.md #6) -- the page itself is an async server component and
// can't call hooks directly. Searches on due date/amount/status since rent_schedules carries no
// lease/tenant display name without a bigger join (the status tabs already narrow by status).
export function RentDueClient({ data, canPost }: { data: RentSchedule[]; canPost: boolean }) {
  const router = useRouter();
  const { query, setQuery, filtered } = useListSearch(
    data,
    (r) => `${r.dueDate} ${r.amount} ${r.status}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search by due date, amount, or status"
      />
      <RentScheduleTable data={filtered} canPost={canPost} onChanged={() => router.refresh()} />
    </div>
  );
}
