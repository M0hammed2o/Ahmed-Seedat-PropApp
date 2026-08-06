'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Lease } from '@propvault/types';
import { LEASE_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

export interface LeaseRow extends Lease {
  unitLabel?: string;
  propertyId?: string;
  propertyNickname?: string;
}

// Reused by the embedded per-unit leases section (property/[id]/units/[unitId]) and the org-wide
// /leases list -- the unit/property columns only render when showUnit is set, same convention
// UnitsTable established for its own showProperty flag.
function buildColumns(showUnit: boolean): ColumnDef<LeaseRow, unknown>[] {
  const columns: ColumnDef<LeaseRow, unknown>[] = [
    {
      header: 'Lease',
      accessorKey: 'startDate',
      cell: (info) => (
        <Link
          href={`/leases/${info.row.original.id}`}
          className="font-medium text-light-accent hover:underline dark:text-dark-accent"
        >
          {info.row.original.startDate} – {info.row.original.endDate ?? 'open-ended'}
        </Link>
      ),
    },
  ];

  if (showUnit) {
    columns.push({
      header: 'Unit',
      accessorKey: 'unitLabel',
      cell: (info) => {
        const row = info.row.original;
        return row.propertyId ? (
          <Link
            href={`/properties/${row.propertyId}/units/${row.unitId}`}
            className="text-light-textSecondary hover:underline dark:text-dark-textSecondary"
          >
            {row.propertyNickname
              ? `${row.propertyNickname} — ${row.unitLabel ?? '—'}`
              : (row.unitLabel ?? '—')}
          </Link>
        ) : (
          (row.unitLabel ?? '—')
        );
      },
    });
  }

  columns.push(
    {
      header: 'Rent',
      accessorKey: 'rentAmount',
      cell: (info) =>
        `R${(info.getValue() as number).toLocaleString('en-ZA')} / ${info.row.original.rentFrequency}`,
    },
    {
      header: 'Deposit',
      accessorKey: 'depositAmount',
      cell: (info) => `R${(info.getValue() as number).toLocaleString('en-ZA')}`,
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info) => (
        <StatusBadge presentation={LEASE_STATUS_PRESENTATION[info.getValue() as Lease['status']]} />
      ),
    },
  );

  return columns;
}

export function LeasesTable({
  data,
  showUnit = false,
  emptyMessage = 'No leases yet',
  emptyAction,
}: {
  data: LeaseRow[];
  showUnit?: boolean;
  emptyMessage?: string;
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage={emptyMessage}
      emptyAction={emptyAction}
      data={data}
      columns={buildColumns(showUnit)}
    />
  );
}
