import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { HealthStatusIndicator } from '@/components/ui/HealthStatusIndicator';
import { MiniLineChart } from '@/components/ui/MiniLineChart';
import { MiniBarChart } from '@/components/ui/MiniBarChart';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import {
  DEMO_ACTIVITY,
  DEMO_OVERVIEW_STATS,
  DEMO_REVENUE_SERIES,
  DEMO_SIGNUP_SERIES,
  DEMO_SYSTEM_HEALTH,
} from '@/lib/demo/adminMockData';

async function getLiveCounts() {
  const supabase = getServiceRoleClient();
  const [customers, properties, documents, subscriptionsActive] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('properties').select('id', { count: 'exact', head: true }),
    supabase.from('documents').select('id', { count: 'exact', head: true }),
    supabase
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
  ]);
  return {
    customers: customers.count ?? 0,
    properties: properties.count ?? 0,
    documents: documents.count ?? 0,
    activeSubscriptions: subscriptionsActive.count ?? 0,
  };
}

export default async function OverviewPage() {
  await requireRole('read_only_admin');

  if (ADMIN_DEMO_MODE) {
    const s = DEMO_OVERVIEW_STATS;
    return (
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Overview
          </h1>
          <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
            Demo data
          </span>
        </div>
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          SaaS operations control centre — realistic mock data for demonstration purposes.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <AdminMetricCard
            label="Registered customers"
            value={s.totalCustomers}
            hint={`+${s.newRegistrationsLast30Days} last 30 days`}
          />
          <AdminMetricCard label="Active subscribers" value={s.activeSubscribers} />
          <AdminMetricCard
            label="Monthly recurring revenue"
            value={`R${s.monthlyRecurringRevenueZar.toLocaleString('en-ZA')}`}
          />
          <AdminMetricCard label="Trialing" value={s.trialingCustomers} />
          <AdminMetricCard
            label="Billing issues"
            value={s.billingIssues}
            hint={s.billingIssues > 0 ? 'Needs attention' : undefined}
          />
          <AdminMetricCard label="Expired" value={s.expiredSubscriptions} />
          <AdminMetricCard label="Total properties" value={s.totalProperties} />
          <AdminMetricCard label="Total documents" value={s.totalDocuments} />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-light-border bg-light-surfaceRaised p-5 dark:border-dark-border dark:bg-dark-surfaceRaised">
            <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
              Monthly recurring revenue
            </h2>
            <p className="mt-1 text-2xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              R{s.monthlyRecurringRevenueZar.toLocaleString('en-ZA')}
            </p>
            <div className="mt-4">
              <MiniLineChart
                points={DEMO_REVENUE_SERIES.map((p) => ({ label: p.month, value: p.mrr }))}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-light-textMuted dark:text-dark-textMuted">
              {DEMO_REVENUE_SERIES.map((p) => (
                <span key={p.month}>{p.month}</span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-light-border bg-light-surfaceRaised p-5 dark:border-dark-border dark:bg-dark-surfaceRaised">
            <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
              New signups
            </h2>
            <p className="mt-1 text-2xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {DEMO_SIGNUP_SERIES[DEMO_SIGNUP_SERIES.length - 1]!.signups} this month
            </p>
            <div className="mt-4">
              <MiniBarChart
                bars={DEMO_SIGNUP_SERIES.map((p) => ({ label: p.month, value: p.signups }))}
              />
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-light-border bg-light-surfaceRaised px-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
            <h2 className="px-0 pt-4 text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
              System health
            </h2>
            <div className="mt-2">
              <HealthStatusIndicator
                label="Supabase (Postgres)"
                status={DEMO_SYSTEM_HEALTH.supabasePostgres}
              />
              <HealthStatusIndicator
                label="Supabase Storage"
                status={DEMO_SYSTEM_HEALTH.supabaseStorage}
              />
              <HealthStatusIndicator
                label="RevenueCat webhook"
                status={DEMO_SYSTEM_HEALTH.revenueCatWebhook}
              />
              <HealthStatusIndicator
                label="Document intelligence provider"
                status={DEMO_SYSTEM_HEALTH.ocrProvider}
              />
              <HealthStatusIndicator
                label="Push notification delivery"
                status={DEMO_SYSTEM_HEALTH.notificationService}
              />
            </div>
            <div className="flex justify-between border-t border-light-border py-3 text-xs text-light-textMuted dark:border-dark-border dark:text-dark-textMuted">
              <span>API latency: {DEMO_SYSTEM_HEALTH.apiLatencyMs}ms</span>
              <span>Error rate: {DEMO_SYSTEM_HEALTH.errorRatePercent}%</span>
              <span>Uptime: {DEMO_SYSTEM_HEALTH.uptimePercent}%</span>
            </div>
          </div>

          <div className="rounded-lg border border-light-border bg-light-surfaceRaised px-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
            <h2 className="px-0 pt-4 text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
              Recent activity
            </h2>
            <div className="mt-2">
              {DEMO_ACTIVITY.map((event, i) => (
                <div
                  key={event.id}
                  className={`flex items-start justify-between gap-4 py-3 text-sm ${i === DEMO_ACTIVITY.length - 1 ? '' : 'border-b border-light-border dark:border-dark-border'}`}
                >
                  <div>
                    <span className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      {event.actor}
                    </span>{' '}
                    <span className="text-light-textSecondary dark:text-dark-textSecondary">
                      {event.action}
                    </span>
                    <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
                      {event.target}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-light-textMuted dark:text-dark-textMuted">
                    {new Date(event.createdAt).toLocaleTimeString('en-ZA', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const counts = await getLiveCounts();

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Overview
      </h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Live counts from the database. Integrations not yet connected in Phase 1 are shown
        explicitly below rather than displaying fabricated numbers.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <AdminMetricCard label="Registered customers" value={counts.customers} />
        <AdminMetricCard label="Active subscribers" value={counts.activeSubscriptions} />
        <AdminMetricCard label="Total properties" value={counts.properties} />
        <AdminMetricCard label="Total documents" value={counts.documents} />
      </div>

      <div className="mt-8 rounded-lg border border-light-border bg-light-surfaceRaised px-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <h2 className="px-0 pt-4 text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          System health
        </h2>
        <div className="mt-2">
          <HealthStatusIndicator label="Supabase (Postgres)" status="connected" />
          <HealthStatusIndicator label="Supabase Storage" status="connected" />
          <HealthStatusIndicator label="RevenueCat webhook" status="not_connected" />
          <HealthStatusIndicator label="Document intelligence provider" status="not_connected" />
          <HealthStatusIndicator label="Push notification delivery" status="not_connected" />
        </div>
      </div>
    </div>
  );
}
