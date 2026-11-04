'use client';

import { useMemo, useState } from 'react';
import type { AppNotification } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { NotificationsList } from './NotificationsList';

// Active vs resolved (2026-11-04): a notification about a utility alert that has since been
// resolved is kept as history but listed separately, so resolved alerts (e.g. a meter that went
// offline and came back) never bury what still needs attention. Nothing is deleted.
export function NotificationsFilterClient({
  notifications,
  resolvedIds = [],
}: {
  notifications: AppNotification[];
  resolvedIds?: string[];
}) {
  const [view, setView] = useState<'active' | 'resolved'>('active');
  const { active, resolved } = useMemo(() => {
    const ids = new Set(resolvedIds);
    return {
      active: notifications.filter((n) => !ids.has(n.id)),
      resolved: notifications.filter((n) => ids.has(n.id)),
    };
  }, [notifications, resolvedIds]);
  const { query, setQuery, filtered } = useListSearch(
    view === 'active' ? active : resolved,
    (n) => `${n.title} ${n.body ?? ''}`,
  );

  return (
    <div className="space-y-4">
      {resolved.length > 0 ? (
        <div
          role="tablist"
          aria-label="Notification view"
          className="flex w-full items-center gap-1 rounded-xl bg-surface p-1 sm:w-fit"
        >
          {(
            [
              ['active', `Active (${active.length})`],
              ['resolved', `Resolved alerts (${resolved.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`flex-1 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors sm:flex-none ${
                view === key
                  ? 'bg-card text-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <SearchBar value={query} onChange={setQuery} placeholder="Search notifications" />
      <NotificationsList notifications={filtered} />
    </div>
  );
}
