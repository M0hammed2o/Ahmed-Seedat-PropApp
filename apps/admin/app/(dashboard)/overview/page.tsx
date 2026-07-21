import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { HealthStatusIndicator } from '@/components/ui/HealthStatusIndicator';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

async function getCounts() {
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
  const counts = await getCounts();

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
