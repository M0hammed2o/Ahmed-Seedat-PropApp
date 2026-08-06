'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { MaintenanceTicket } from '@propvault/types';
import { MAINTENANCE_PRIORITY_PRESENTATION, MAINTENANCE_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

const columns: ColumnDef<MaintenanceTicket, unknown>[] = [
  {
    header: 'Ticket',
    accessorKey: 'summary',
    cell: (info) => (
      <Link
        href={`/maintenance/${info.row.original.id}`}
        className="font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.summary}
      </Link>
    ),
  },
  {
    header: 'Priority',
    accessorKey: 'priority',
    cell: (info) => (
      <StatusBadge
        presentation={
          MAINTENANCE_PRIORITY_PRESENTATION[info.getValue() as MaintenanceTicket['priority']]
        }
      />
    ),
  },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => (
      <StatusBadge
        presentation={
          MAINTENANCE_STATUS_PRESENTATION[info.getValue() as MaintenanceTicket['status']]
        }
      />
    ),
  },
];

export function MaintenanceTable({
  data,
  emptyAction,
}: {
  data: MaintenanceTicket[];
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage="No maintenance tickets yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
