'use client';

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';

export interface AdminDataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  emptyMessage?: string;
}

export function AdminDataTable<TData>({
  columns,
  data,
  emptyMessage = 'No results.',
}: AdminDataTableProps<TData>) {
  const table = useReactTable({ columns, data, getCoreRowModel: getCoreRowModel() });

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-light-border p-8 text-center text-sm text-light-textSecondary dark:border-dark-border dark:text-dark-textSecondary">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-light-border dark:border-dark-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
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
