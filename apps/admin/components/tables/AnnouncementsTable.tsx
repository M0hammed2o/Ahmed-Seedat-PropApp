'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Announcement } from '@propvault/types';
import { AdminDataTable } from '@/components/ui/AdminDataTable';

const columns: ColumnDef<Announcement, unknown>[] = [
  { header: 'Title', accessorKey: 'title' },
  {
    header: 'Published',
    accessorKey: 'publishedAt',
    cell: (info) => new Date(info.getValue() as string).toLocaleDateString('en-ZA'),
  },
  {
    header: 'Expires',
    accessorKey: 'expiresAt',
    cell: (info) => {
      const value = info.getValue() as string | null;
      return value ? new Date(value).toLocaleDateString('en-ZA') : 'Never';
    },
  },
  {
    header: 'Acknowledgement',
    accessorKey: 'requiresAcknowledgement',
    cell: (info) => ((info.getValue() as boolean) ? 'Required' : 'Not required'),
  },
];

export function AnnouncementsTable({
  data,
  emptyAction,
}: {
  data: Announcement[];
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage="No announcements yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
