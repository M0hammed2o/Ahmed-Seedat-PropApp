'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Expense } from '@propvault/types';
import { EXPENSE_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

const columns: ColumnDef<Expense, unknown>[] = [
  {
    header: 'Category',
    accessorKey: 'category',
    cell: (info) => (
      <Link
        href={`/accounting/expenses/${info.row.original.id}`}
        className="font-medium text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.category}
      </Link>
    ),
  },
  {
    header: 'Amount',
    accessorKey: 'amount',
    cell: (info) => `R${(info.getValue() as number).toLocaleString('en-ZA')}`,
  },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => <StatusBadge presentation={EXPENSE_STATUS_PRESENTATION[info.getValue() as Expense['status']]} />,
  },
];

export function ExpensesTable({ data, emptyAction }: { data: Expense[]; emptyAction?: ReactNode }) {
  return <AdminDataTable emptyMessage="No expenses yet" emptyAction={emptyAction} data={data} columns={columns} />;
}
