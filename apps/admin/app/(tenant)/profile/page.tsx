import type { NotificationPreference } from '@propvault/types';
import { AccountSettingsForm } from '@/components/settings/AccountSettingsForm';
import { LinkedAccountsPanel } from '@/components/settings/LinkedAccountsPanel';
import { TenantContactForm } from '@/components/tenant-portal/TenantContactForm';
import { NotificationPreferencesForm } from '@/components/notifications/NotificationPreferencesForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';
import { mapNotificationPreferenceRow } from '@/lib/notifications';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

/**
 * GET /profile -- PWA_V1_COMPLETION_PLAN.md #11. Two independent sections: account identity
 * (display name/email/password -- same shared form #7 uses, since every authenticated user gets
 * one `profiles` row regardless of which identity system they also belong to) and tenant contact
 * info (email/phone on the caller's own `tenants` row, tenants_update_self-gated).
 */
export default async function TenantProfilePage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="My Profile" />
        <AccountSettingsForm
          initialDisplayName="Demo Tenant"
          initialEmail="demo-tenant@example.com"
        />
        <LinkedAccountsPanel />
        <TenantContactForm
          fullName="Demo Tenant"
          initialEmail="demo-tenant@example.com"
          initialPhone="+27 82 555 0100"
        />
        <div>
          <h2 className="mb-2 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Communication preferences
          </h2>
          <NotificationPreferencesForm preferences={[]} />
        </div>
      </div>
    );
  }

  const session = await resolveTenantSession();
  if (!session) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="My Profile" />
        <p className="text-sm text-light-danger dark:text-dark-danger">Sign in required.</p>
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const [userResult, profileResult, tenantResult, preferencesResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('profiles').select('display_name').eq('id', session.userId).maybeSingle(),
    supabase.from('tenants').select('full_name, email, phone').eq('id', session.tenantId).single(),
    supabase.from('notification_preferences').select('*'),
  ]);
  if (tenantResult.error)
    throw new Error(`Failed to load tenant profile: ${tenantResult.error.message}`);
  if (preferencesResult.error)
    throw new Error(`Failed to load notification preferences: ${preferencesResult.error.message}`);

  const preferences: NotificationPreference[] = (preferencesResult.data ?? []).map(
    mapNotificationPreferenceRow,
  );

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="My Profile" subtitle="Your account and contact details." />
      <AccountSettingsForm
        initialDisplayName={profileResult.data?.display_name ?? ''}
        initialEmail={userResult.data.user?.email ?? ''}
      />
      <LinkedAccountsPanel />
      <TenantContactForm
        fullName={tenantResult.data.full_name}
        initialEmail={tenantResult.data.email ?? ''}
        initialPhone={tenantResult.data.phone ?? ''}
      />
      {/* Tenant communication preferences (WORKLOG.md this date) -- reuses the existing,
          purely user_id-keyed notification_preferences table/form as-is (notification_preferences_
          all_own's RLS already scopes this correctly for a tenant identity, same as it already
          does for staff/owner) rather than a second, tenant-specific preferences system. Channel
          availability (email/WhatsApp) still ultimately depends on what the landlord org's own
          dispatch logic and WhatsApp automation actually send -- not implemented in this task. */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Communication preferences
        </h2>
        <NotificationPreferencesForm preferences={preferences} />
      </div>
    </div>
  );
}
