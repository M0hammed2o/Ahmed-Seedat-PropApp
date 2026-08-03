export interface ActivityItem {
  id: string;
  description: string;
  timestamp: string;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

// Real audit_events feed (UI_REDESIGN_PLAN.md) -- server component, no client JS needed since
// there's no interaction here beyond reading a list.
export function RecentActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-light-textMuted dark:text-dark-textMuted">
        No activity recorded yet. Actions across your portfolio will appear here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-light-border dark:divide-dark-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <span className="min-w-0 truncate text-sm text-light-textPrimary dark:text-dark-textPrimary">
            {item.description}
          </span>
          <span className="shrink-0 text-xs text-light-textMuted dark:text-dark-textMuted">
            {relativeTime(item.timestamp)}
          </span>
        </li>
      ))}
    </ul>
  );
}
