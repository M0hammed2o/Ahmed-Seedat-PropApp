'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Application } from '@propvault/types';
import { APPLICATION_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

const columns: ColumnDef<Application, unknown>[] = [
  {
    header: 'Applicant',
    accessorKey: 'applicantName',
    cell: (info) => (
      <Link
        href={`/applications/${info.row.original.id}`}
        className="font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.applicantName}
      </Link>
    ),
  },
  { header: 'Email', accessorKey: 'applicantEmail', cell: (info) => (info.getValue() as string | null) ?? '—' },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => (
      <StatusBadge presentation={APPLICATION_STATUS_PRESENTATION[info.getValue() as Application['status']]} />
    ),
  },
  {
    header: 'Decision',
    accessorKey: 'decision',
    cell: (info) => {
      const decision = info.getValue() as Application['decision'];
      return decision ? <span className="text-xs capitalize">{decision}</span> : '—';
    },
  },
];

export function ApplicationsTable({
  data,
  emptyAction,
}: {
  data: Application[];
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable emptyMessage="No applications yet" emptyAction={emptyAction} data={data} columns={columns} />
  );
}
