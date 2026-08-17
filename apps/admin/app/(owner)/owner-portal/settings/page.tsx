import type { NotificationPreference } from '@propvault/types';
import { NotificationPreferencesForm } from '@/components/notifications/NotificationPreferencesForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapNotificationPreferenceRow } from '@/lib/notifications';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

/**
 * GET /owner-portal/settings -- WhatsApp V1 final pre-production pass, Phase 8 (WORKLOG.md this
 * date). Owners are real auth.users rows once linked (owners.user_id) -- notification_preferences
 * is keyed by user_id with zero schema change needed, so this page is the same
 * NotificationPreferencesForm the staff dashboard and tenant profile already use, just mounted
 * inside the owner-portal shell. Human-readable category labels (never a raw category or Meta
 * template name) live in the shared form component itself.
 */
export default async function OwnerNotificationSettingsPage() {
  const preferences: NotificationPreference[] = ADMIN_DEMO_MODE ? [] : await loadPreferences();

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Notification settings"
        subtitle="Choose which channels each type of notification uses, including your monthly property summary."
      />
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
