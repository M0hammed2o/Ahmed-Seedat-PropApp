'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { InvoicesTable, type InvoiceRow } from './InvoicesTable';

const DISPLAY_STATUSES: InvoiceRow['displayStatus'][] = [
  'Draft',
  'Issued',
  'Partially paid',
  'Paid',
  'Overdue',
  'Void',
];

// Landlord rent-invoicing pass (WORKLOG.md this date): same client-side filter-over-already-fetched
// pattern as UnitsFilterClient/PropertiesGridClient -- Property/Unit/Tenant filters are select
// dropdowns built from the rows actually present (never a fabricated list), Status is a tab bar
// like UnitsFilterClient's, search covers invoice number + tenant name per the task's spec.
export function InvoicesFilterClient({
  invoices,
  canSend = false,
  onSent = () => {},
}: {
  invoices: InvoiceRow[];
  canSend?: boolean;
  onSent?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<InvoiceRow['displayStatus'] | 'all'>('all');
  const [propertyId, setPropertyId] = useState('all');
  const [unitId, setUnitId] = useState('all');
  const [tenantId, setTenantId] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const properties = useMemo(() => {
    const seen = new Map<string, string>();
    for (const inv of invoices) seen.set(inv.propertyId, inv.propertyNickname);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);

  const units = useMemo(() => {
    const seen = new Map<string, string>();
    for (const inv of invoices) {
      if (propertyId === 'all' || inv.propertyId === propertyId) seen.set(inv.unitId, inv.unitLabel);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices, propertyId]);

  const tenants = useMemo(() => {
    const seen = new Map<string, string>();
    for (const inv of invoices) seen.set(inv.tenantId, inv.tenantName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);

  const filtered = useMemo(
    () =>
      invoices.filter(
        (inv) =>
          (status === 'all' || inv.displayStatus === status) &&
          (propertyId === 'all' || inv.propertyId === propertyId) &&
          (unitId === 'all' || inv.unitId === unitId) &&
          (tenantId === 'all' || inv.tenantId === tenantId) &&
          (from === '' || inv.period >= from) &&
          (to === '' || inv.period <= to) &&
          (inv.invoiceNumber + inv.tenantName).toLowerCase().includes(query.toLowerCase()),
      ),
    [invoices, status, propertyId, unitId, tenantId, from, to, query],
  );

  const selectClass =
    'h-9 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary/40';

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoice # or tenant"
            className="h-9 w-[220px] rounded-xl border border-border bg-card pr-3 pl-9 text-[13px] text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
          />
        </div>

        <select
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setUnitId('all');
          }}
          className={selectClass}
        >
          <option value="all">All properties</option>
          {properties.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>

        <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={selectClass}>
          <option value="all">All units</option>
          {units.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>

        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={selectClass}>
          <option value="all">All tenants</option>
          {tenants.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as InvoiceRow['displayStatus'] | 'all')}
          className={selectClass}
        >
          <option value="all">All statuses</option>
          {DISPLAY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectClass} />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectClass} />
        </label>
      </div>

      <InvoicesTable
        data={filtered}
        canSend={canSend}
        onSent={onSent}
        emptyMessage="No invoices match this filter"
      />

      <p className="text-[12px] text-muted-foreground">
        Showing {filtered.length} of {invoices.length} invoices
      </p>
    </div>
  );
}
