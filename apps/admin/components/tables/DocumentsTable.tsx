'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { DocumentRecord } from '@propvault/types';
import { AdminDataTable } from '@/components/ui/AdminDataTable';

const columns: ColumnDef<DocumentRecord, unknown>[] = [
  {
    header: 'File',
    accessorKey: 'originalFileName',
    cell: (info) => (
      <Link
        href={`/documents/${info.row.original.id}`}
        className="font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.originalFileName}
      </Link>
    ),
  },
  {
    header: 'Type',
    accessorKey: 'documentType',
    cell: (info) => <span className="capitalize">{(info.getValue() as string).replace('_', ' ')}</span>,
  },
  {
    header: 'Size',
    accessorKey: 'fileSizeBytes',
    cell: (info) => `${((info.getValue() as number) / 1024 / 1024).toFixed(2)} MB`,
  },
  {
    header: 'Uploaded',
    accessorKey: 'createdAt',
    cell: (info) => new Date(info.getValue() as string).toLocaleDateString('en-ZA'),
  },
];

export function DocumentsTable({ data, emptyAction }: { data: DocumentRecord[]; emptyAction?: ReactNode }) {
  return <AdminDataTable emptyMessage="No documents yet" emptyAction={emptyAction} data={data} columns={columns} />;
}
