import { HealthStatusIndicator } from '@/components/ui/HealthStatusIndicator';
import { requireRole } from '@/lib/auth';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_FEATURE_FLAGS, DEMO_SYSTEM_HEALTH } from '@/lib/demo/adminMockData';

export default async function SystemPage() {
  const session = await requireRole('read_only_admin');

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          System
        </h1>
        {ADMIN_DEMO_MODE ? (
          <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
            Demo data
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Signed in as {session.displayName} ({session.role.replace('_', ' ')}).
      </p>

      <div className="mt-6 rounded-lg border border-light-border bg-light-surfaceRaised px-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <h2 className="pt-4 text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          Integrations
        </h2>
        <div className="mt-2">
          <HealthStatusIndicator label="Supabase" status="connected" />
          <HealthStatusIndicator
            label="RevenueCat webhook"
            status={ADMIN_DEMO_MODE ? DEMO_SYSTEM_HEALTH.revenueCatWebhook : 'not_connected'}
          />
          <HealthStatusIndicator
            label="Document intelligence provider"
            status={ADMIN_DEMO_MODE ? DEMO_SYSTEM_HEALTH.ocrProvider : 'not_connected'}
          />
          <HealthStatusIndicator
            label="Push notification service"
            status={ADMIN_DEMO_MODE ? DEMO_SYSTEM_HEALTH.notificationService : 'not_connected'}
          />
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-light-border bg-light-surfaceRaised px-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <h2 className="pt-4 text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          Feature flags
        </h2>
        <div className="mt-2">
          {DEMO_FEATURE_FLAGS.map((flag, i) => (
            <div
              key={flag.key}
              className={`flex items-center justify-between py-3 ${i === DEMO_FEATURE_FLAGS.length - 1 ? '' : 'border-b border-light-border dark:border-dark-border'}`}
            >
              <div>
                <p className="text-sm text-light-textPrimary dark:text-dark-textPrimary">
                  {flag.label}
                </p>
                <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
                  {flag.description}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  flag.enabled
                    ? 'bg-light-statusPaid/10 text-light-statusPaid dark:bg-dark-statusPaid/10 dark:text-dark-statusPaid'
                    : 'bg-light-border/60 text-light-textMuted dark:bg-dark-border/60 dark:text-dark-textMuted'
                }`}
              >
                {flag.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
        The admin audit log viewer, configurable plan limits editor, and maintenance banner are
        designed (DATABASE.md, ADMIN_DASHBOARD.md) but not yet backed by a mutating UI — see
        TODO.md.
      </p>
    </div>
  );
}
