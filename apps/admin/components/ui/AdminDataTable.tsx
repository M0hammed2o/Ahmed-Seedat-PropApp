'use client';

import type { ReactNode } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { EmptyState } from './EmptyState';

// Generic inbox glyph -- no icon library dependency (matches HealthStatusIndicator's established
// plain-shape convention). AdminDataTable is used by every list page in this codebase, so this
// one change upgrades every existing caller's empty state to DESIGN_SYSTEM.md's formula for free
// (icon badge -> headline -> CTA) without each call site needing to opt in separately.
function InboxIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path
        d="M3 12h4.5l1.5 3h6l1.5-3H21M4 7l-1 5v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7l-1-5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface AdminDataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  emptyMessage?: string;
  emptyAction?: ReactNode;
}

export function AdminDataTable<TData>({
  columns,
  data,
  emptyMessage = 'No results.',
  emptyAction,
}: AdminDataTableProps<TData>) {
  const table = useReactTable({ columns, data, getCoreRowModel: getCoreRowModel() });

  if (data.length === 0) {
    return (
      <div className="rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
        <EmptyState icon={<InboxIcon />} title={emptyMessage} action={emptyAction} />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-light-border last:border-b-0 dark:border-dark-border"
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
