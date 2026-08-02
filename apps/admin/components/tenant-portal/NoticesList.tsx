'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Announcement } from '@propvault/types';
import { Button } from '@/components/ui/Button';

export function NoticesList({
  announcements,
  acknowledgedIds,
}: {
  announcements: Announcement[];
  acknowledgedIds: string[];
}) {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(new Set(acknowledgedIds));
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/announcements/${id}/acknowledge`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to acknowledge notice.');
        return;
      }
      setAcknowledged((prev) => new Set(prev).add(id));
      router.refresh();
    } catch {
      setError('Failed to acknowledge notice — check your connection and try again.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}
      {announcements.map((a) => {
        const isAcknowledged = acknowledged.has(a.id);
        return (
          <div
            key={a.id}
            className="rounded-lg border border-light-border bg-light-surfaceRaised p-5 dark:border-dark-border dark:bg-dark-surfaceRaised"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">{a.title}</p>
                <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
                  {a.publishedAt.slice(0, 10)}
                </p>
              </div>
              {a.requiresAcknowledgement ? (
                isAcknowledged ? (
                  <span className="whitespace-nowrap text-xs font-medium text-light-statusPaid dark:text-dark-statusPaid">
                    Acknowledged
                  </span>
                ) : (
                  <Button size="sm" disabled={pendingId === a.id} onClick={() => acknowledge(a.id)}>
                    {pendingId === a.id ? 'Acknowledging…' : 'Acknowledge'}
                  </Button>
                )
              ) : null}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-light-textSecondary dark:text-dark-textSecondary">
              {a.body}
            </p>
          </div>
        );
      })}
    </div>
  );
}
