'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { LEASE_STATUS_PRESENTATION } from '@propvault/ui';
import type { TenantWithTenancy } from '@/app/(dashboard)/tenants/page';
import { PORTAL_STATUS_TONE } from '@/lib/tenantPortalStatus';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function currency(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

const columns: ColumnDef<TenantWithTenancy, unknown>[] = [
  {
    header: 'Name',
    accessorKey: 'fullName',
    cell: (info) => (
      <Link href={`/tenants/${info.row.original.id}`} className="group flex items-center gap-2.5">
        <Avatar
          initials={initialsFor(info.row.original.fullName)}
          tone="muted"
          className="h-7 w-7 text-[10px]"
        />
        <span className="font-medium text-light-accent group-hover:underline dark:text-dark-accent">
          {info.row.original.fullName}
        </span>
      </Link>
    ),
  },
  {
    header: 'Property',
    id: 'property',
    accessorFn: (row) => row.tenancy?.propertyNickname ?? '',
    cell: (info) => {
      const tenancy = info.row.original.tenancy;
      if (!tenancy) return <span className="text-light-textMuted dark:text-dark-textMuted">—</span>;
      return (
        <Link
          href={`/properties/${tenancy.propertyId}`}
          className="hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {tenancy.propertyNickname}
        </Link>
      );
    },
  },
  {
    header: 'Unit',
    id: 'unit',
    accessorFn: (row) => row.tenancy?.unitLabel ?? '',
    cell: (info) => {
      const tenancy = info.row.original.tenancy;
      if (!tenancy) return <span className="text-light-textMuted dark:text-dark-textMuted">—</span>;
      return (
        <Link
          href={`/properties/${tenancy.propertyId}/units/${tenancy.unitId}`}
          className="hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {tenancy.unitLabel}
        </Link>
      );
    },
  },
  {
    header: 'Rent',
    id: 'rent',
    accessorFn: (row) => row.tenancy?.rentAmount ?? 0,
    cell: (info) => {
      const tenancy = info.row.original.tenancy;
      if (!tenancy) return <span className="text-light-textMuted dark:text-dark-textMuted">—</span>;
      return (
        <span className="tabular">
          {currency(tenancy.rentAmount)}
          <span className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
            {tenancy.rentFrequency === 'monthly' ? '/mo' : `/${tenancy.rentFrequency}`}
          </span>
        </span>
      );
    },
  },
  {
    header: 'Lease',
    id: 'leaseStatus',
    accessorFn: (row) => row.tenancy?.leaseStatus ?? '',
    cell: (info) => {
      const tenancy = info.row.original.tenancy;
      if (!tenancy)
        return <span className="text-light-textMuted dark:text-dark-textMuted">No lease</span>;
      return (
        <StatusBadge
          presentation={LEASE_STATUS_PRESENTATION[tenancy.leaseStatus as keyof typeof LEASE_STATUS_PRESENTATION]}
        />
      );
    },
  },
  {
    header: 'Portal',
    id: 'portalStatus',
    accessorFn: (row) => row.portalStatus.label,
    cell: (info) => {
      const portalStatus = info.row.original.portalStatus;
      return (
        <span className={`text-xs font-medium ${PORTAL_STATUS_TONE[portalStatus.status]}`}>
          {portalStatus.label}
        </span>
      );
    },
  },
];

export function TenantsTable({
  data,
  emptyAction,
}: {
  data: TenantWithTenancy[];
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage="No tenants yet"
      emptyAction={emptyAction}
      data={data}
      columns={columns}
    />
  );
}
