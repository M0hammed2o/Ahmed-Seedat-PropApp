'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { BankAccount } from '@propvault/types';
import { AdminDataTable } from '@/components/ui/AdminDataTable';

const columns: ColumnDef<BankAccount, unknown>[] = [
  { header: 'Bank', accessorKey: 'bankName' },
  {
    header: 'Class',
    accessorKey: 'accountClass',
    cell: (info) => <span className="capitalize">{info.getValue() as string}</span>,
  },
];

export function BankAccountsTable({
  data,
  emptyAction,
}: {
  data: BankAccount[];
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage="No bank accounts yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
