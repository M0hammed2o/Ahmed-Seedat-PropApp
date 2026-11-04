import Link from 'next/link';
import type { AppNotification } from '@propvault/types';
import { NotificationsFilterClient } from '@/components/notifications/NotificationsFilterClient';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapNotificationRow, resolvedAlertNotificationIds } from '@/lib/notifications';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'demo-notification-1',
    userId: 'demo-user-1',
    type: 'rent_overdue',
    title: 'Rent overdue',
    body: 'Sea Point Apartment — Unit 1 rent is 3 days overdue.',
    relatedEntityType: 'rent_schedule',
    relatedEntityId: 'demo-rent-schedule-1',
    readAt: null,
    createdAt: '2026-08-01T08:00:00Z',
  },
];

/**
 * GET /notifications -- tenth module in the M20 sequence (TASKS.md), a personal inbox (RLS-scoped
 * to the caller's own rows, notifications_select_own — not org data, so no role gate applies at
 * all, unlike every module before it). Same direct-RLS-read pattern as every list page this
 * milestone.
 */
export default async function NotificationsPage() {
  const { notifications, resolvedIds } = ADMIN_DEMO_MODE
    ? { notifications: DEMO_NOTIFICATIONS, resolvedIds: [] as string[] }
    : await loadNotifications();
  const unreadCount = notifications.filter((n) => !n.readAt).length;
  const resolvedCount = resolvedIds.length;
  const activeCount = notifications.length - resolvedCount;

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Notifications"
        subtitle={`${unreadCount} unread · ${activeCount} active${resolvedCount ? ` · ${resolvedCount} about resolved alerts` : ''}.`}
        actions={
          <Link
            href="/notifications/preferences"
            className="text-sm font-medium text-light-accent hover:underline dark:text-dark-accent"
          >
            Preferences
          </Link>
        }
      />

      <NotificationsFilterClient notifications={notifications} resolvedIds={resolvedIds} />
    </div>
  );
}

async function loadNotifications(): Promise<{
  notifications: AppNotification[];
  resolvedIds: string[];
}> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load notifications: ${error.message}`);
  const rows = data ?? [];
  const resolved = await resolvedAlertNotificationIds(supabase, rows);
  return { notifications: rows.map(mapNotificationRow), resolvedIds: [...resolved] };
}
