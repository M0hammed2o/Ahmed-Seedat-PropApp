import Link from 'next/link';
import type { NotificationPreference } from '@propvault/types';
import { NotificationPreferencesForm } from '@/components/notifications/NotificationPreferencesForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapNotificationPreferenceRow } from '@/lib/notifications';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NotificationPreferencesPage() {
  const preferences: NotificationPreference[] = ADMIN_DEMO_MODE ? [] : await loadPreferences();

  return (
    <div className="space-y-5 animate-rise">
      <div>
        <Link
          href="/notifications"
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to notifications
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Notification preferences"
            subtitle="Choose which channels each type of notification uses. All channels are on by default."
          />
        </div>
      </div>

      <NotificationPreferencesForm preferences={preferences} />
    </div>
  );
}

async function loadPreferences(): Promise<NotificationPreference[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('notification_preferences').select('*');
  if (error) throw new Error(`Failed to load notification preferences: ${error.message}`);
  return (data ?? []).map(mapNotificationPreferenceRow);
}
