'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { AdminDataTable } from '@/components/ui/AdminDataTable';

export interface ProcessingRow {
  id: string;
  document_id: string;
  status: string;
  attempt: number;
  provider_name: string | null;
  error_message: string | null;
  created_at: string;
}

const STATUS_TONE: Record<string, string> = {
  succeeded: 'text-light-statusPaid dark:text-dark-statusPaid',
  failed: 'text-light-statusOverdue dark:text-dark-statusOverdue',
  processing: 'text-light-statusProcessing dark:text-dark-statusProcessing',
  queued: 'text-light-textMuted dark:text-dark-textMuted',
};

const columns: ColumnDef<ProcessingRow, unknown>[] = [
  { header: 'Document', accessorKey: 'document_id' },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => {
      const status = info.getValue() as string;
      return <span className={`text-xs font-semibold ${STATUS_TONE[status] ?? ''}`}>{status}</span>;
    },
  },
  { header: 'Attempt', accessorKey: 'attempt' },
  { header: 'Provider', accessorKey: 'provider_name', cell: (info) => info.getValue() ?? '—' },
  { header: 'Error', accessorKey: 'error_message', cell: (info) => info.getValue() ?? '—' },
];

export function ProcessingTable({ data }: { data: ProcessingRow[] }) {
  return <AdminDataTable emptyMessage="No extraction jobs yet." data={data} columns={columns} />;
}
