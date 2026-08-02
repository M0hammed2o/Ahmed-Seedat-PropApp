'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationCategory, NotificationPreference } from '@propvault/types';
import { NOTIFICATION_CATEGORIES } from '@propvault/types';

// A row per NOTIFICATION_CATEGORIES value, each with three independent channel toggles. Categories
// with no notification_preferences row yet default to all-enabled -- matching the DB column
// defaults exactly (email_enabled/push_enabled/whatsapp_enabled all `not null default true`,
// supabase/migrations/20260101000039_notifications.sql), not a guessed UI default. Every toggle
// PATCHes immediately (no separate Save button) -- the endpoint is a per-category upsert, so each
// checkbox is already a complete, idempotent unit of change.

type ChannelKey = 'emailEnabled' | 'pushEnabled' | 'whatsappEnabled';

function defaultsFor(category: NotificationCategory): NotificationPreference {
  return { userId: '', category, emailEnabled: true, pushEnabled: true, whatsappEnabled: true };
}

export function NotificationPreferencesForm({ preferences }: { preferences: NotificationPreference[] }) {
  const router = useRouter();
  const byCategory = new Map(preferences.map((p) => [p.category, p]));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(category: NotificationCategory, channel: ChannelKey, next: boolean) {
    const key = `${category}:${channel}`;
    setBusy(key);
    setError(null);
    try {
      const response = await fetch('/api/v1/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, [channel]: next }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to save preference.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to save preference — check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error ? (
        <p className="mb-4 rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-light-border dark:border-dark-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
            <tr>
              <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Category</th>
              <th className="px-4 py-3 text-center font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Email
              </th>
              <th className="px-4 py-3 text-center font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Push
              </th>
              <th className="px-4 py-3 text-center font-medium text-light-textSecondary dark:text-dark-textSecondary">
                WhatsApp
              </th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((category) => {
              const pref = byCategory.get(category) ?? defaultsFor(category);
              return (
                <tr key={category} className="border-b border-light-border last:border-b-0 dark:border-dark-border">
                  <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">{category}</td>
                  {(['emailEnabled', 'pushEnabled', 'whatsappEnabled'] as ChannelKey[]).map((channel) => (
                    <td key={channel} className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={pref[channel]}
                        disabled={busy === `${category}:${channel}`}
                        onChange={(e) => toggle(category, channel, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
