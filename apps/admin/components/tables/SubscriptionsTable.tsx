'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ORGANIZATION_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

// Rebuilt for TASKS.md M19 (Super Admin): rows are organizations with their current subscription,
// not individual owner-operator app-store subscriptions (SUPER_ADMIN.md: "subscriptions/page.tsx
// needs to move from a single hardcoded plan to the plans/organization_subscriptions model" --
// the old "platform" (ios/android) column is meaningless for an org subscription and was dropped
// rather than kept as dead/misleading data).
export interface SubscriptionRow {
  orgId: string;
  legalName: string;
  planName: string | null;
  effectivePrice: number | null;
  discountPct: number | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
}

const columns: ColumnDef<SubscriptionRow, unknown>[] = [
  {
    header: 'Organization',
    accessorKey: 'legalName',
    cell: (info) => (
      <Link
        href={`/customers/${info.row.original.orgId}`}
        className="text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.legalName}
      </Link>
    ),
  },
  {
    header: 'Plan',
    accessorKey: 'planName',
    cell: (info) => (info.getValue() as string | null) ?? '—',
  },
  {
    header: 'Price',
    accessorKey: 'effectivePrice',
    cell: (info) => {
      const value = info.getValue() as number | null;
      return value === null ? '—' : `R${value.toFixed(2)}`;
    },
  },
  {
    header: 'Discount',
    accessorKey: 'discountPct',
    cell: (info) => {
      const value = info.getValue() as number | null;
      return value ? `${value}%` : '—';
    },
  },
  {
    header: 'Status',
    accessorKey: 'subscriptionStatus',
    cell: (info) => {
      const value = info.getValue() as string | null;
      if (!value) return '—';
      const presentation =
        ORGANIZATION_STATUS_PRESENTATION[value as keyof typeof ORGANIZATION_STATUS_PRESENTATION];
      return presentation ? <StatusBadge presentation={presentation} /> : value.replace('_', ' ');
    },
  },
  {
    header: 'Renews / expires',
    accessorKey: 'currentPeriodEnd',
    cell: (info) =>
      info.getValue() ? new Date(info.getValue() as string).toLocaleDateString('en-ZA') : '—',
  },
];

export function SubscriptionsTable({ data }: { data: SubscriptionRow[] }) {
  return (
    <AdminDataTable emptyMessage="No subscriptions recorded yet." data={data} columns={columns} />
  );
}
