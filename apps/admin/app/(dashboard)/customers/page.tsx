import Link from 'next/link';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_CUSTOMERS } from '@/lib/demo/adminMockData';

interface CustomerRow {
  id: string;
  displayName: string | null;
  createdAt: string;
  propertyCount: number;
  subscriptionStatus?: string;
}

async function getCustomers(): Promise<CustomerRow[]> {
  const supabase = getServiceRoleClient();
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (!profiles) return [];

  const rows: CustomerRow[] = [];
  for (const profile of profiles) {
    const { count } = await supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', profile.id);
    rows.push({
      id: profile.id,
      displayName: profile.display_name,
      createdAt: profile.created_at,
      propertyCount: count ?? 0,
    });
  }
  return rows;
}

const STATUS_TONE: Record<string, string> = {
  active: 'text-light-statusPaid dark:text-dark-statusPaid',
  trialing: 'text-light-statusProcessing dark:text-dark-statusProcessing',
  grace_period: 'text-light-statusNeedsReview dark:text-dark-statusNeedsReview',
  billing_issue: 'text-light-statusOverdue dark:text-dark-statusOverdue',
  expired: 'text-light-textMuted dark:text-dark-textMuted',
  cancelled: 'text-light-textMuted dark:text-dark-textMuted',
};

export default async function CustomersPage() {
  await requireRole('read_only_admin');

  const customers: CustomerRow[] = ADMIN_DEMO_MODE
    ? DEMO_CUSTOMERS.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        createdAt: c.createdAt,
        propertyCount: c.propertyCount,
        subscriptionStatus: c.subscriptionStatus,
      }))
    : await getCustomers();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Customers
        </h1>
        {ADMIN_DEMO_MODE ? (
          <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
            Demo data
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        {customers.length} {ADMIN_DEMO_MODE ? 'customers' : 'most recently registered customers'}.
      </p>

      <div className="mt-6">
        <AdminDataTable
          emptyMessage="No customers registered yet."
          data={customers}
          columns={[
            {
              header: 'Customer',
              accessorKey: 'id',
              cell: (info) => (
                <Link
                  href={`/customers/${info.row.original.id}`}
                  className="text-light-accent hover:underline dark:text-dark-accent"
                >
                  {info.row.original.displayName || info.row.original.id.slice(0, 8)}
                </Link>
              ),
            },
            { header: 'Properties', accessorKey: 'propertyCount' },
            {
              header: 'Subscription',
              accessorKey: 'subscriptionStatus',
              cell: (info) => {
                const status = info.getValue() as string | undefined;
                if (!status)
                  return <span className="text-light-textMuted dark:text-dark-textMuted">—</span>;
                return (
                  <span className={`text-xs font-semibold ${STATUS_TONE[status] ?? ''}`}>
                    {status.replace('_', ' ')}
                  </span>
                );
              },
            },
            {
              header: 'Registered',
              accessorKey: 'createdAt',
              cell: (info) => new Date(info.getValue() as string).toLocaleDateString(),
            },
          ]}
        />
      </div>
    </div>
  );
}
