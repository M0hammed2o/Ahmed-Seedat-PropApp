import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_CUSTOMERS } from '@/lib/demo/adminMockData';

interface SubscriptionRow {
  id: string;
  owner_user_id: string;
  plan_id: string;
  status: string;
  platform: string;
  renewal_or_expiry_date: string | null;
}

export default async function SubscriptionsPage() {
  await requireRole('read_only_admin');

  const data: SubscriptionRow[] = ADMIN_DEMO_MODE
    ? DEMO_CUSTOMERS.map((c) => ({
        id: c.id,
        owner_user_id: c.id,
        plan_id: 'propvault_base',
        status: c.subscriptionStatus,
        platform: c.id.charCodeAt(5) % 2 === 0 ? 'ios' : 'android',
        renewal_or_expiry_date: new Date(
          new Date(c.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }))
    : ((
        await getServiceRoleClient()
          .from('subscriptions')
          .select(
            'id, owner_user_id, plan_id, status, platform, renewal_or_expiry_date, last_synced_at',
          )
          .order('updated_at', { ascending: false })
          .limit(50)
      ).data ?? []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Subscriptions
        </h1>
        {ADMIN_DEMO_MODE ? (
          <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
            Demo data
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        No admin action here can set an active paid entitlement directly — see DECISIONS.md.
      </p>
      <div className="mt-6">
        <AdminDataTable
          emptyMessage="No subscriptions recorded yet."
          data={data}
          columns={[
            {
              header: 'Customer',
              accessorKey: 'owner_user_id',
              cell: (info) => (info.getValue() as string).slice(0, 8),
            },
            { header: 'Plan', accessorKey: 'plan_id' },
            {
              header: 'Status',
              accessorKey: 'status',
              cell: (info) => (info.getValue() as string).replace('_', ' '),
            },
            { header: 'Platform', accessorKey: 'platform' },
            {
              header: 'Renews / expires',
              accessorKey: 'renewal_or_expiry_date',
              cell: (info) =>
                info.getValue() ? new Date(info.getValue() as string).toLocaleDateString() : '—',
            },
          ]}
        />
      </div>
    </div>
  );
}
