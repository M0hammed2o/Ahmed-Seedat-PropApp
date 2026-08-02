'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Owner } from '@propvault/types';
import { AdminDataTable } from '@/components/ui/AdminDataTable';

// Owner.status ('active' | 'inactive') is a plain inline union on the Owner type, not a named
// enum in packages/types/src/enums.ts -- a small local badge here rather than growing
// StatusPresentation for a two-value field with no other consumer.
function OwnerStatusBadge({ status }: { status: Owner['status'] }) {
  const isActive = status === 'active';
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        isActive
          ? 'text-light-statusPaid dark:text-dark-statusPaid'
          : 'text-light-textMuted dark:text-dark-textMuted'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isActive ? 'bg-light-statusPaid dark:bg-dark-statusPaid' : 'bg-light-border dark:bg-dark-border'
        }`}
      />
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

const columns: ColumnDef<Owner, unknown>[] = [
  {
    header: 'Name',
    accessorKey: 'name',
    cell: (info) => (
      <Link
        href={`/owners/${info.row.original.id}`}
        className="font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.name}
      </Link>
    ),
  },
  {
    header: 'Type',
    accessorKey: 'ownerType',
    cell: (info) => <span className="capitalize">{info.getValue() as string}</span>,
  },
  { header: 'Email', accessorKey: 'email', cell: (info) => (info.getValue() as string | null) ?? '—' },
  { header: 'Phone', accessorKey: 'phone', cell: (info) => (info.getValue() as string | null) ?? '—' },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => <OwnerStatusBadge status={info.getValue() as Owner['status']} />,
  },
];

export function OwnersTable({
  data,
  emptyAction,
}: {
  data: Owner[];
  emptyAction?: ReactNode;
}) {
  return <AdminDataTable emptyMessage="No owners yet" emptyAction={emptyAction} data={data} columns={columns} />;
}
