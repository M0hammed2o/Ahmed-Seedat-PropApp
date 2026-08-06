'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Owner } from '@propvault/types';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { Avatar } from '@/components/ui/Avatar';
import { Pill } from '@/components/ui/Pill';

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

const columns: ColumnDef<Owner, unknown>[] = [
  {
    header: 'Name',
    accessorKey: 'name',
    cell: (info) => (
      <Link href={`/owners/${info.row.original.id}`} className="group flex items-center gap-2.5">
        <Avatar
          initials={initialsFor(info.row.original.name)}
          tone="muted"
          className="h-7 w-7 text-[10px]"
        />
        <span className="font-medium text-light-accent group-hover:underline dark:text-dark-accent">
          {info.row.original.name}
        </span>
      </Link>
    ),
  },
  {
    header: 'Type',
    accessorKey: 'ownerType',
    cell: (info) => <span className="capitalize">{info.getValue() as string}</span>,
  },
  {
    header: 'Email',
    accessorKey: 'email',
    cell: (info) => (info.getValue() as string | null) ?? '—',
  },
  {
    header: 'Phone',
    accessorKey: 'phone',
    cell: (info) => (info.getValue() as string | null) ?? '—',
  },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => (
      <Pill tone={(info.getValue() as Owner['status']) === 'active' ? 'success' : 'neutral'} dot>
        {(info.getValue() as Owner['status']) === 'active' ? 'Active' : 'Inactive'}
      </Pill>
    ),
  },
];

export function OwnersTable({ data, emptyAction }: { data: Owner[]; emptyAction?: ReactNode }) {
  return (
    <AdminDataTable
      emptyMessage="No owners yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
