import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export default async function SubscriptionsPage() {
  await requireRole('read_only_admin');
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from('subscriptions')
    .select('id, owner_user_id, plan_id, status, platform, renewal_or_expiry_date, last_synced_at')
    .order('updated_at', { ascending: false })
    .limit(50);

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Subscriptions
      </h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        No RevenueCat webhook is connected yet in Phase 1, so this table is empty until real
        subscription events flow in (SUBSCRIPTIONS.md). No admin action here can set an active paid
        entitlement directly — see DECISIONS.md.
      </p>
      <div className="mt-6">
        <AdminDataTable
          emptyMessage="No subscriptions recorded yet."
          data={data ?? []}
          columns={[
            {
              header: 'Customer',
              accessorKey: 'owner_user_id',
              cell: (info) => (info.getValue() as string).slice(0, 8),
            },
            { header: 'Plan', accessorKey: 'plan_id' },
            { header: 'Status', accessorKey: 'status' },
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
