'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Application } from '@propvault/types';
import { applicationDisplayPresentation } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

// V1-simplified columns (DECISIONS.md 2026-08-01): a single status column showing the actual
// outcome (New/Reviewing/Approved/Declined/Withdrawn) via applicationDisplayPresentation, no
// separate raw "Decision" column -- that was redundant once the status badge itself shows the
// decision for a decided row.
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
  {
    header: 'Email',
    accessorKey: 'applicantEmail',
    cell: (info) => (info.getValue() as string | null) ?? '—',
  },
  {
    header: 'Applied',
    accessorKey: 'createdAt',
    cell: (info) => new Date(info.getValue() as string).toLocaleDateString('en-ZA'),
  },
  {
    header: 'Status',
    id: 'displayStatus',
    cell: (info) => (
      <StatusBadge presentation={applicationDisplayPresentation(info.row.original)} />
    ),
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
    <AdminDataTable
      emptyMessage="No applications yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
