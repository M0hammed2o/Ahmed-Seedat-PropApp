'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AppNotification } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

// Personal inbox (not org-scoped -- RLS's notifications_select_own/notifications_update_own
// already limit this to the caller's own rows, no role gate applies at all). "Mark as read" is
// the only write action; notifications themselves are always system-generated (no create UI --
// there is no POST /api/v1/notifications endpoint).
export function NotificationsList({ notifications }: { notifications: AppNotification[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function markRead(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: 'POST' });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (notifications.length === 0) {
    return (
      <div className="rounded-lg border border-light-border dark:border-dark-border">
        <EmptyState icon={<span className="text-lg">🔔</span>} title="No notifications yet" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`flex items-start justify-between rounded-lg border p-3 text-sm ${
            n.readAt
              ? 'border-light-border dark:border-dark-border'
              : 'border-light-accent/40 bg-light-accent/5 dark:border-dark-accent/40 dark:bg-dark-accent/5'
          }`}
        >
          <div>
            <p className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
              {n.title}
            </p>
            {n.body ? (
              <p className="mt-0.5 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                {n.body}
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-light-textMuted dark:text-dark-textMuted">
              {new Date(n.createdAt).toLocaleString('en-ZA')}
            </p>
          </div>
          {!n.readAt ? (
            <Button size="sm" disabled={busyId === n.id} onClick={() => markRead(n.id)}>
              Mark as read
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
