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

// Final pre-production pass, Phase 8: human-readable labels, never a raw category/template name
// rendered verbatim (this codebase's own category values already read fine capitalized, except
// 'owner_summary' -- 'Owner_summary' isn't a real phrase, so every category gets an explicit,
// considered label instead of leaving the fallback to guesswork per-category).
const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  rent: 'Rent & payments',
  maintenance: 'Maintenance',
  lease: 'Lease',
  inspections: 'Inspections',
  announcements: 'Announcements',
  security: 'Security',
  promotional: 'Promotional',
  owner_summary: 'Monthly property summary',
};

function defaultsFor(category: NotificationCategory): NotificationPreference {
  return {
    userId: '',
    category,
    emailEnabled: true,
    pushEnabled: true,
    whatsappEnabled: true,
    preferredSummaryDay: null,
  };
}

export function NotificationPreferencesForm({
  preferences,
}: {
  preferences: NotificationPreference[];
}) {
  const router = useRouter();
  const byCategory = new Map(preferences.map((p) => [p.category, p]));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(category: NotificationCategory, key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch('/api/v1/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, ...body }),
      });
      if (!response.ok) {
        const responseBody = await response.json();
        setError(responseBody.error?.message ?? 'Failed to save preference.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to save preference — check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(category: NotificationCategory, channel: ChannelKey, next: boolean) {
    await patch(category, `${category}:${channel}`, { [channel]: next });
  }

  async function setPreferredDay(category: NotificationCategory, day: number | null) {
    await patch(category, `${category}:preferredSummaryDay`, { preferredSummaryDay: day });
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
              <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Category
              </th>
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
                <tr
                  key={category}
                  className="border-b border-light-border last:border-b-0 dark:border-dark-border"
                >
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    <div>{CATEGORY_LABELS[category]}</div>
                    {category === 'owner_summary' ? (
                      <label className="mt-1 flex items-center gap-1.5 text-xs text-light-textMuted dark:text-dark-textMuted">
                        Send on day
                        <select
                          className="rounded border border-light-border bg-transparent px-1 py-0.5 text-xs dark:border-dark-border"
                          value={pref.preferredSummaryDay ?? ''}
                          disabled={busy === `${category}:preferredSummaryDay`}
                          onChange={(e) =>
                            setPreferredDay(
                              category,
                              e.target.value === '' ? null : Number(e.target.value),
                            )
                          }
                        >
                          <option value="">1 (default)</option>
                          {Array.from({ length: 28 }, (_, i) => i + 1)
                            .filter((day) => day !== 1)
                            .map((day) => (
                              <option key={day} value={day}>
                                {day}
                              </option>
                            ))}
                        </select>
                        of the month
                      </label>
                    ) : null}
                  </td>
                  {(['emailEnabled', 'pushEnabled', 'whatsappEnabled'] as ChannelKey[]).map(
                    (channel) => (
                      <td key={channel} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={pref[channel]}
                          disabled={busy === `${category}:${channel}`}
                          onChange={(e) => toggle(category, channel, e.target.checked)}
                        />
                      </td>
                    ),
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
