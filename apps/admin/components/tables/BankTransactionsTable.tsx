'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { BankTransaction, RentSchedule } from '@propvault/types';
import { BANK_TRANSACTION_MATCH_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MatchTransactionControl } from '@/components/accounting/MatchTransactionControl';

function buildColumns(
  canPost: boolean,
  rentScheduleCandidates: RentSchedule[],
): ColumnDef<BankTransaction, unknown>[] {
  const columns: ColumnDef<BankTransaction, unknown>[] = [
    { header: 'Date', accessorKey: 'transactionDate' },
    {
      header: 'Description',
      accessorKey: 'description',
      cell: (info) => (info.getValue() as string | null) ?? '—',
    },
    {
      header: 'Amount',
      accessorKey: 'amount',
      cell: (info) => `R${(info.getValue() as number).toLocaleString('en-ZA')}`,
    },
    {
      header: 'Status',
      accessorKey: 'matchStatus',
      cell: (info) => (
        <StatusBadge
          presentation={
            BANK_TRANSACTION_MATCH_STATUS_PRESENTATION[
              info.getValue() as BankTransaction['matchStatus']
            ]
          }
        />
      ),
    },
  ];

  if (canPost) {
    columns.push({
      header: '',
      id: 'actions',
      cell: (info) =>
        info.row.original.matchStatus === 'unmatched' ? (
          <MatchTransactionControl
            bankTransactionId={info.row.original.id}
            candidates={rentScheduleCandidates}
          />
        ) : null,
    });
  }

  return columns;
}

export function BankTransactionsTable({
  data,
  canPost,
  rentScheduleCandidates,
}: {
  data: BankTransaction[];
  canPost: boolean;
  rentScheduleCandidates: RentSchedule[];
}) {
  return (
    <AdminDataTable
      emptyMessage="No transactions yet"
      data={data}
      columns={buildColumns(canPost, rentScheduleCandidates)}
    />
  );
}
