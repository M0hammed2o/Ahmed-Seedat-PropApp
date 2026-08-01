'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ORGANIZATION_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

export interface CustomerRow {
  id: string;
  displayName: string | null;
  createdAt: string;
  propertyCount: number;
  // Live mode carries real OrganizationStatus values (M19); demo mode still carries the older
  // PropVault-era per-user subscription-status vocabulary (DESIGN_SYSTEM.md's own "needs
  // extending" note) -- typed as a bare string here and looked up defensively below rather than
  // widening ORGANIZATION_STATUS_PRESENTATION's key type to accept values that aren't real
  // OrganizationStatus members.
  subscriptionStatus?: string;
}

// Column defs (with cell render functions) must live in client-side code — a Server Component
// cannot pass functions as props to a Client Component (React Server Components constraint;
// this crashed `/customers` at runtime with "Functions cannot be passed directly to Client
// Components" until this file existed — see WORKLOG.md).
const columns: ColumnDef<CustomerRow, unknown>[] = [
  {
    header: 'Customer',
    accessorKey: 'id',
    cell: (info) => (
      <Link
        href={`/customers/${info.row.original.id}`}
        className="text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.displayName || info.row.original.id.slice(0, 8)}
      </Link>
    ),
  },
  { header: 'Properties', accessorKey: 'propertyCount' },
  {
    header: 'Subscription',
    accessorKey: 'subscriptionStatus',
    cell: (info) => {
      const status = info.getValue() as string | undefined;
      if (!status) return <span className="text-light-textMuted dark:text-dark-textMuted">—</span>;
      const presentation = ORGANIZATION_STATUS_PRESENTATION[status as keyof typeof ORGANIZATION_STATUS_PRESENTATION];
      if (!presentation) {
        // Demo-mode legacy status value -- not a real OrganizationStatus, render plainly rather
        // than crashing or silently dropping it.
        return (
          <span className="text-xs font-semibold text-light-textMuted dark:text-dark-textMuted">
            {status.replace('_', ' ')}
          </span>
        );
      }
      return <StatusBadge presentation={presentation} />;
    },
  },
  {
    header: 'Registered',
    accessorKey: 'createdAt',
    cell: (info) => new Date(info.getValue() as string).toLocaleDateString(),
  },
];

export function CustomersTable({ data }: { data: CustomerRow[] }) {
  return (
    <AdminDataTable emptyMessage="No customers registered yet." data={data} columns={columns} />
  );
}
