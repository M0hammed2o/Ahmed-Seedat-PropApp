'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { TenantsTable } from './TenantsTable';
import type { TenantWithTenancy } from '@/app/(dashboard)/tenants/page';
import type { TenantPortalStatus } from '@/lib/tenantPortalStatus';

const PORTAL_STATUS_OPTIONS: { value: TenantPortalStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All portal statuses' },
  { value: 'not_invited', label: 'Not invited' },
  { value: 'pending', label: 'Invitation pending' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Invitation expired' },
];

const selectClass =
  'rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

// Tenant/occupancy V1 pass: Property and Portal-status filters, additive to the existing
// text-search-only filtering -- "at minimum Property should be filterable" per the product spec.
// Kept as plain client-side state (matching this file's own existing pattern, useListSearch) since
// the tenant list is already fetched in full server-side; no new endpoint/query needed.
export function TenantsFilterClient({
  tenants,
  emptyAction,
}: {
  tenants: TenantWithTenancy[];
  emptyAction?: ReactNode;
}) {
  const { query, setQuery, filtered } = useListSearch(
    tenants,
    (t) => `${t.fullName} ${t.email ?? ''} ${t.phone ?? ''} ${t.tenancy?.propertyNickname ?? ''} ${t.tenancy?.unitLabel ?? ''}`,
  );

  const propertyOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of tenants) {
      if (t.tenancy) seen.set(t.tenancy.propertyId, t.tenancy.propertyNickname);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tenants]);

  const [propertyId, setPropertyId] = useState('all');
  const [portalStatus, setPortalStatus] = useState<TenantPortalStatus | 'all'>('all');

  const visible = useMemo(() => {
    return filtered.filter((t) => {
      if (propertyId !== 'all' && t.tenancy?.propertyId !== propertyId) return false;
      if (portalStatus !== 'all' && t.portalStatus.status !== portalStatus) return false;
      return true;
    });
  }, [filtered, propertyId, portalStatus]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search tenants by name, email, phone, property, or unit"
          />
        </div>
        {propertyOptions.length > 0 ? (
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className={selectClass}
            aria-label="Filter by property"
          >
            <option value="all">All properties</option>
            {propertyOptions.map(([id, nickname]) => (
              <option key={id} value={id}>
                {nickname}
              </option>
            ))}
          </select>
        ) : null}
        <select
          value={portalStatus}
          onChange={(e) => setPortalStatus(e.target.value as TenantPortalStatus | 'all')}
          className={selectClass}
          aria-label="Filter by portal status"
        >
          {PORTAL_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <TenantsTable data={visible} emptyAction={emptyAction} />
    </div>
  );
}
