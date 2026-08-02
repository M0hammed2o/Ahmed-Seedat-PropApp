import Link from 'next/link';
import type { NotificationPreference } from '@propvault/types';
import { NotificationPreferencesForm } from '@/components/notifications/NotificationPreferencesForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapNotificationPreferenceRow } from '@/lib/notifications';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NotificationPreferencesPage() {
  const preferences: NotificationPreference[] = ADMIN_DEMO_MODE ? [] : await loadPreferences();

  return (
    <div>
      <Link
        href="/notifications"
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to notifications
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Notification preferences
      </h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Choose which channels each type of notification uses. All channels are on by default.
      </p>

      <div className="mt-6">
        <NotificationPreferencesForm preferences={preferences} />
      </div>
    </div>
  );
}

async function loadPreferences(): Promise<NotificationPreference[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('notification_preferences').select('*');
  if (error) throw new Error(`Failed to load notification preferences: ${error.message}`);
  return (data ?? []).map(mapNotificationPreferenceRow);
}
