'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { OwnerStatement } from '@propvault/types';
import { OWNER_STATEMENT_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

export type OwnerStatementWithOwnerName = OwnerStatement & { ownerName: string };

const columns: ColumnDef<OwnerStatementWithOwnerName, unknown>[] = [
  {
    header: 'Owner',
    accessorKey: 'ownerName',
    cell: (info) => (
      <Link
        href={`/accounting/owner-statements/${info.row.original.id}`}
        className="font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.ownerName}
      </Link>
    ),
  },
  {
    header: 'Period',
    id: 'period',
    cell: (info) => `${info.row.original.periodStart} – ${info.row.original.periodEnd}`,
  },
  {
    header: 'Rent collected',
    accessorKey: 'rentCollected',
    cell: (info) => `R${(info.getValue() as number).toLocaleString('en-ZA')}`,
  },
  {
    header: 'Net payable',
    accessorKey: 'netPayable',
    cell: (info) => `R${(info.getValue() as number).toLocaleString('en-ZA')}`,
  },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => (
      <StatusBadge
        presentation={
          OWNER_STATEMENT_STATUS_PRESENTATION[info.getValue() as OwnerStatement['status']]
        }
      />
    ),
  },
];

export function OwnerStatementsTable({
  data,
  emptyAction,
}: {
  data: OwnerStatementWithOwnerName[];
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage="No owner statements yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
