'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Panel } from '@/components/ui/Panel';
import { MiniBarChart } from '@/components/ui/MiniBarChart';
import type { UtilityPortfolio } from '@/lib/smartUtility/portfolio';
import { api, Badge, errorClass, errorMessage, fmtNumber, fmtRand, SOURCE_LABEL, Stat } from './shared';

export function UtilitiesPortfolio() {
  const [data, setData] = useState<UtilityPortfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(12);

  useEffect(() => {
    void (async () => {
      const res = await api(`/api/v1/utilities/portfolio?months=${months}`, 'GET');
      if (!res.ok) setError(errorMessage(res.data, 'Could not load utilities.'));
      else {
        setError(null);
        setData(res.data as UtilityPortfolio);
      }
    })();
  }, [months]);

  if (error) return <div className={errorClass} role="alert">{error}</div>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data.totals) {
    return (
      <Panel title="No utility data yet">
        <p className="text-sm text-muted-foreground">Open a property and use its Utilities tab to add meters, supply sources and tariffs.</p>
      </Panel>
    );
  }
  const t = data.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Properties with utilities" value={String(t.properties)} />
        <Stat label="Open alerts" value={String(t.openAlerts)} hint={t.criticalAlerts ? `${t.criticalAlerts} critical` : undefined} />
        <Stat label="Charges awaiting approval" value={String(t.chargesAwaitingApproval)} hint={fmtRand(t.draftAmount)} />
        <Stat label="Unpaid utility invoices" value={String(t.unpaidInvoices)} hint={fmtRand(t.unpaidOutstanding)} />
        <Stat label="History" value={`${months} months`} hint="from monthly meter snapshots" />
      </div>

      <Panel
        title="Monthly use"
        description="Main consumption meters (or unit meters where there is no main meter), from the monthly snapshots"
        actions={
          <select className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs dark:border-dark-border" aria-label="History length" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
            <option value={24}>24 months</option>
          </select>
        }
      >
        {data.monthly.length === 0 ? (
          <p className="text-sm text-muted-foreground">Monthly history starts after each property’s first billing day.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Water (kL){data.monthly.some((m) => m.partial) ? ' · some months partial' : ''}</div>
              <MiniBarChart bars={data.monthly.map((m) => ({ label: m.month.slice(2), value: m.waterKl }))} />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Electricity (kWh)</div>
              <MiniBarChart bars={data.monthly.map((m) => ({ label: m.month.slice(2), value: m.electricityKwh }))} />
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Properties" description="Most urgent first">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Property</th>
                <th className="py-2 pr-3 font-medium">Sources</th>
                <th className="py-2 pr-3 font-medium">Last period</th>
                <th className="py-2 pr-3 font-medium">Alerts</th>
                <th className="py-2 pr-3 font-medium">Drafts</th>
                <th className="py-2 pr-3 font-medium">Unpaid</th>
              </tr>
            </thead>
            <tbody>
              {data.properties.map((p) => (
                <tr key={p.propertyId} className="border-t border-light-border dark:border-dark-border">
                  <td className="py-2 pr-3">
                    <Link className="font-medium text-foreground underline-offset-2 hover:underline" href={`/properties/${p.propertyId}?tab=Utilities`}>{p.name}</Link>
                    <div className="text-xs text-muted-foreground">{p.city ?? ''} · {p.meters} meter{p.meters === 1 ? '' : 's'}</div>
                  </td>
                  <td className="py-2 pr-3 text-xs">{p.sources.length ? [...new Set(p.sources)].map((s) => SOURCE_LABEL[s] ?? s).join(', ') : <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-2 pr-3 text-xs">
                    {p.lastPeriod ? `${p.lastPeriod.period.slice(0, 7)}: ${fmtNumber(p.lastPeriod.water, 1)} kL · ${fmtNumber(p.lastPeriod.electricity, 0)} kWh` : '—'}
                  </td>
                  <td className="py-2 pr-3">
                    {p.alerts.open ? <Badge tone={p.alerts.critical ? 'bad' : 'warn'}>{p.alerts.open} open</Badge> : <span className="text-xs text-muted-foreground">none</span>}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {p.charges.draftCount ? `${p.charges.draftCount} · ${fmtRand(p.charges.draftAmount)}` : '—'}
                    {p.charges.disputed ? <div className="text-light-danger dark:text-dark-danger">{p.charges.disputed} disputed</div> : null}
                  </td>
                  <td className="py-2 pr-3 text-xs">{p.unpaidInvoices.count ? `${p.unpaidInvoices.count} · ${fmtRand(p.unpaidInvoices.outstanding)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
