import { notFound } from 'next/navigation';
import { HealthStatusIndicator } from '@/components/ui/HealthStatusIndicator';
import { PageHeader } from '@/components/ui/PageHeader';
import { getAdminSessionWithoutMfaCheck } from '@/lib/auth';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_FEATURE_FLAGS, DEMO_SYSTEM_HEALTH } from '@/lib/demo/adminMockData';

export default async function SystemPage() {
  // Identity/AAL2 already enforced by the (super-admin) layout's own gate -- this only reads the
  // session data for display, via the same React `cache()`-deduped resolution the layout used, so
  // this never performs an independent auth decision of its own (see lib/auth.ts's
  // resolveAdminGate() comment for the real bug a page-level requireRole() throw used to cause).
  // notFound() is used, not thrown, purely because the layout guarantees this is non-null by the
  // time this page renders -- this branch is unreachable in practice.
  const session = await getAdminSessionWithoutMfaCheck();
  if (!session) notFound();

  return (
    <div>
      <PageHeader
        title="System"
        subtitle={`Signed in as ${session.displayName} (${session.role.replace('_', ' ')}).`}
        actions={
          ADMIN_DEMO_MODE ? (
            <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
              Demo data
            </span>
          ) : undefined
        }
      />

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
