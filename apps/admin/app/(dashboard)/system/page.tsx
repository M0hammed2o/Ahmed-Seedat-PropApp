import { HealthStatusIndicator } from '@/components/ui/HealthStatusIndicator';
import { requireRole } from '@/lib/auth';

export default async function SystemPage() {
  const session = await requireRole('read_only_admin');

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        System
      </h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Signed in as {session.displayName} ({session.role.replace('_', ' ')}).
      </p>

      <div className="mt-6 rounded-lg border border-light-border bg-light-surfaceRaised px-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <h2 className="pt-4 text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          Integrations
        </h2>
        <div className="mt-2">
          <HealthStatusIndicator label="Supabase" status="connected" />
          <HealthStatusIndicator label="RevenueCat webhook" status="not_connected" />
          <HealthStatusIndicator label="Document intelligence provider" status="not_connected" />
          <HealthStatusIndicator label="Push notification service" status="not_connected" />
        </div>
      </div>

      <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
        Feature flags, configurable plan limits, maintenance banner, and the admin audit log viewer
        are designed (DATABASE.md, ADMIN_DASHBOARD.md) but not yet backed by tables/UI in Phase 1 —
        see TODO.md.
      </p>
    </div>
  );
}
