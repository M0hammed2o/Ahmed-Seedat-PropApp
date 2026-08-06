'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import type { Property } from '@propvault/types';
import { AdminDataTable } from '@/components/ui/AdminDataTable';

const columns: ColumnDef<Property, unknown>[] = [
  {
    header: 'Property',
    accessorKey: 'nickname',
    cell: (info) => (
      <Link
        href={`/properties/${info.row.original.id}`}
        className="font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.nickname}
      </Link>
    ),
  },
  { header: 'Address', accessorKey: 'fullAddress' },
  {
    header: 'Type',
    accessorKey: 'propertyType',
    cell: (info) => (info.getValue() as string).replace('_', ' '),
  },
  { header: 'City', accessorKey: 'city' },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => (
      <span className="text-xs font-medium capitalize text-light-textSecondary dark:text-dark-textSecondary">
        {info.getValue() as string}
      </span>
    ),
  },
];

export function PropertiesTable({
  data,
  emptyAction,
}: {
  data: Property[];
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage="No properties yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
