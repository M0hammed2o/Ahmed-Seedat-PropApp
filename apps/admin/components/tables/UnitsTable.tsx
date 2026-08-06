'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { Unit } from '@propvault/types';
import { UNIT_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

export interface UnitRow extends Unit {
  propertyNickname?: string;
}

// Reused by both the per-property units section (apps/admin/app/(dashboard)/properties/[id])
// and the org-wide Units list (apps/admin/app/(dashboard)/units) -- the `propertyNickname` column
// only renders when at least one row carries it, so the per-property context (where every row is
// obviously the same property) doesn't show a redundant column.
function buildColumns(showProperty: boolean): ColumnDef<UnitRow, unknown>[] {
  const columns: ColumnDef<UnitRow, unknown>[] = [
    {
      header: 'Unit',
      accessorKey: 'unitLabel',
      cell: (info) => (
        <Link
          href={`/properties/${info.row.original.propertyId}/units/${info.row.original.id}`}
          className="font-medium text-light-accent hover:underline dark:text-dark-accent"
        >
          {info.row.original.unitLabel}
        </Link>
      ),
    },
  ];

  if (showProperty) {
    columns.push({
      header: 'Property',
      accessorKey: 'propertyNickname',
      cell: (info) => (
        <Link
          href={`/properties/${info.row.original.propertyId}`}
          className="text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          {info.row.original.propertyNickname ?? '—'}
        </Link>
      ),
    });
  }

  columns.push(
    {
      header: 'Beds / Baths',
      accessorKey: 'bedrooms',
      cell: (info) => {
        const unit = info.row.original;
        return `${unit.bedrooms ?? '—'} / ${unit.bathrooms ?? '—'}`;
      },
    },
    {
      header: 'Size (m²)',
      accessorKey: 'sizeSqm',
      cell: (info) => (info.getValue() as number | null) ?? '—',
    },
    {
      header: 'Market rent',
      accessorKey: 'marketRent',
      cell: (info) => {
        const value = info.getValue() as number | null;
        return value != null ? `R${value.toLocaleString('en-ZA')}` : '—';
      },
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info) => (
        <StatusBadge presentation={UNIT_STATUS_PRESENTATION[info.getValue() as Unit['status']]} />
      ),
    },
  );

  return columns;
}

export function UnitsTable({
  data,
  showProperty = false,
  emptyMessage = 'No units yet',
  emptyAction,
}: {
  data: UnitRow[];
  showProperty?: boolean;
  emptyMessage?: string;
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage={emptyMessage}
      emptyAction={emptyAction}
      data={data}
      columns={buildColumns(showProperty)}
    />
  );
}
