import Link from 'next/link';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

interface CustomerRow {
  id: string;
  displayName: string | null;
  createdAt: string;
  propertyCount: number;
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

export default async function CustomersPage() {
  await requireRole('read_only_admin');
  const customers = await getCustomers();

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Customers
      </h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        {customers.length} most recently registered customers.
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
