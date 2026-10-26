'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { formatZar } from '@/lib/cemetery/terms';

export interface PurchaserListRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  sites: string[];
  reserved: string[];
  paid: number;
  outstanding: number;
}

export function PurchaserSearch({
  rows,
  holderLabel,
}: {
  rows: PurchaserListRow[];
  holderLabel: string;
}) {
  const [q, setQ] = useState('');
  const [owing, setOwing] = useState(false);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!owing || r.outstanding > 0) &&
      (!needle ||
        [r.name, r.phone, r.email, ...r.sites, ...r.reserved]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)),
  );
  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, e-mail or site (e.g. B-012)"
            aria-label={`Search ${holderLabel.toLowerCase()}s`}
            className="h-9 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-foreground"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={owing} onChange={(e) => setOwing(e.target.checked)} />{' '}
          Outstanding only
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">No matches.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5">{holderLabel}</th>
                <th className="px-3 py-2.5">Contact</th>
                <th className="px-3 py-2.5">Grave sites</th>
                <th className="px-3 py-2.5 text-right">Paid</th>
                <th className="px-5 py-2.5 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-surface">
                  <td className="px-5 py-2.5">
                    <Link
                      href={`/cemetery/purchasers/${r.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {r.phone ?? '—'}
                    {r.email ? <span className="block">{r.email}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-foreground">
                    {r.sites.join(', ') || '—'}
                    {r.reserved.length ? (
                      <span className="block text-muted-foreground">
                        reserved: {r.reserved.join(', ')}
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{formatZar(r.paid)}</td>
                  <td
                    className={`tabular px-5 py-2.5 text-right font-semibold ${r.outstanding > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {formatZar(r.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
