'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Tenant } from '@propvault/types';
import { TENANT_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

const columns: ColumnDef<Tenant, unknown>[] = [
  {
    header: 'Name',
    accessorKey: 'fullName',
    cell: (info) => (
      <Link
        href={`/tenants/${info.row.original.id}`}
        className="font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.fullName}
      </Link>
    ),
  },
  { header: 'Email', accessorKey: 'email', cell: (info) => (info.getValue() as string | null) ?? '—' },
  { header: 'Phone', accessorKey: 'phone', cell: (info) => (info.getValue() as string | null) ?? '—' },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => <StatusBadge presentation={TENANT_STATUS_PRESENTATION[info.getValue() as Tenant['status']]} />,
  },
];

export function TenantsTable({
  data,
  emptyAction,
}: {
  data: Tenant[];
  emptyAction?: ReactNode;
}) {
  return <AdminDataTable emptyMessage="No tenants yet" emptyAction={emptyAction} data={data} columns={columns} />;
}
