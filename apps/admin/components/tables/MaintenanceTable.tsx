'use client';

import { useMemo, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { MaintenanceTicket } from '@propvault/types';
import { MAINTENANCE_PRIORITY_PRESENTATION, MAINTENANCE_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

function buildColumns(
  unitLabelById?: Map<string, string>,
): ColumnDef<MaintenanceTicket, unknown>[] {
  return [
    {
      header: 'Ticket',
      accessorKey: 'summary',
      cell: (info) => (
        <Link
          href={`/maintenance/${info.row.original.id}`}
          className="font-medium text-light-accent hover:underline dark:text-dark-accent"
        >
          {info.row.original.summary}
        </Link>
      ),
    },
    {
      header: 'Unit',
      id: 'unit',
      cell: (info) => {
        const unitId = info.row.original.unitId;
        const label = unitId ? unitLabelById?.get(unitId) : undefined;
        return (
          <span className="text-light-textSecondary dark:text-dark-textSecondary">
            {unitId ? (label ?? 'Unit') : 'Common area'}
          </span>
        );
      },
    },
    {
      header: 'Priority',
      accessorKey: 'priority',
      cell: (info) => (
        <StatusBadge
          presentation={
            MAINTENANCE_PRIORITY_PRESENTATION[info.getValue() as MaintenanceTicket['priority']]
          }
        />
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info) => (
        <StatusBadge
          presentation={
            MAINTENANCE_STATUS_PRESENTATION[info.getValue() as MaintenanceTicket['status']]
          }
        />
      ),
    },
  ];
}

export function MaintenanceTable({
  data,
  emptyAction,
  unitLabelById,
}: {
  data: MaintenanceTicket[];
  emptyAction?: ReactNode;
  /** Property-scoped caller (e.g. the Property Detail maintenance tab) can supply real labels;
   * omitted entirely on the portfolio-wide /maintenance list, which spans many properties and
   * would need a much larger per-property unit fetch to resolve labels there too -- falls back to
   * the generic "Unit" placeholder rather than blocking on that out-of-scope work. */
  unitLabelById?: Map<string, string>;
}) {
  const columns = useMemo(() => buildColumns(unitLabelById), [unitLabelById]);
  return (
    <AdminDataTable
      emptyMessage="No maintenance tickets yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
