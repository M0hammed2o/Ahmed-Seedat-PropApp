'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Inspection } from '@propvault/types';
import { INSPECTION_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

const columns: ColumnDef<Inspection, unknown>[] = [
  {
    header: 'Inspection',
    accessorKey: 'inspectionType',
    cell: (info) => (
      <Link
        href={`/inspections/${info.row.original.id}`}
        className="font-medium capitalize text-light-accent hover:underline dark:text-dark-accent"
      >
        {(info.getValue() as string).replace('_', ' ')}
      </Link>
    ),
  },
  {
    header: 'Scheduled',
    accessorKey: 'scheduledAt',
    cell: (info) => new Date(info.getValue() as string).toLocaleString('en-ZA'),
  },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => (
      <StatusBadge
        presentation={INSPECTION_STATUS_PRESENTATION[info.getValue() as Inspection['status']]}
      />
    ),
  },
];

export function InspectionsTable({
  data,
  emptyAction,
}: {
  data: Inspection[];
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage="No inspections yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
