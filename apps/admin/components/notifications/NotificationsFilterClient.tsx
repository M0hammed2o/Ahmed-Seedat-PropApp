'use client';

import type { AppNotification } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { NotificationsList } from './NotificationsList';

export function NotificationsFilterClient({ notifications }: { notifications: AppNotification[] }) {
  const { query, setQuery, filtered } = useListSearch(
    notifications,
    (n) => `${n.title} ${n.body ?? ''}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar value={query} onChange={setQuery} placeholder="Search notifications" />
      <NotificationsList notifications={filtered} />
    </div>
  );
}
