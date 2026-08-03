import Link from 'next/link';
import { AccountSettingsForm } from '@/components/settings/AccountSettingsForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

/**
 * GET /settings -- PWA_V1_COMPLETION_PLAN.md #7. Own-account settings only (name/email/password);
 * organization-level settings live at /organization/settings (#8) as a separate, role-gated page
 * per PERMISSIONS.md's "Organisation settings" column (agent/accountant/viewer are view-only
 * there, but every role manages their own account here).
 */
export default async function SettingsPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Account settings" subtitle="Your name, email, and password." />
        <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Account settings require a live Supabase project. Turn off demo mode to test this flow.
        </p>
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Account settings" />
        <p className="text-sm text-light-danger dark:text-dark-danger">Sign in required.</p>
      </div>
    );
  }

  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Account settings" subtitle="Your name, email, and password." />
      <AccountSettingsForm initialDisplayName={profile?.display_name ?? ''} initialEmail={user.email ?? ''} />
      <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Manage which emails and notifications you receive at{' '}
        <Link href="/notifications/preferences" className="text-light-accent hover:underline dark:text-dark-accent">
          Notification preferences
        </Link>
        .
      </p>
    </div>
  );
}
