'use client';

import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { SubscriptionsTable, type SubscriptionRow } from './SubscriptionsTable';

export function SubscriptionsFilterClient({ subscriptions }: { subscriptions: SubscriptionRow[] }) {
  const { query, setQuery, filtered } = useListSearch(
    subscriptions,
    (s) => `${s.legalName} ${s.planName ?? ''} ${s.subscriptionStatus ?? ''}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search subscriptions by organization or plan"
      />
      <SubscriptionsTable data={filtered} />
    </div>
  );
}
