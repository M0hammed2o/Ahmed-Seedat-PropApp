'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Tenant } from '@propvault/types';
import { TENANT_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

const columns: ColumnDef<Tenant, unknown>[] = [
  {
    header: 'Name',
    accessorKey: 'fullName',
    cell: (info) => (
      <Link href={`/tenants/${info.row.original.id}`} className="group flex items-center gap-2.5">
        <Avatar initials={initialsFor(info.row.original.fullName)} tone="muted" className="h-7 w-7 text-[10px]" />
        <span className="font-medium text-light-accent group-hover:underline dark:text-dark-accent">
          {info.row.original.fullName}
        </span>
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
