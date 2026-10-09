'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { MiniLineChart } from '@/components/ui/MiniLineChart';
import { IntegrationsSection } from './IntegrationsSection';
import { MetersSection } from './MetersSection';
import { SubmissionsSection } from './SubmissionsSection';
import { api, Badge, errorClass, errorMessage, fmtDateTime, fmtNumber, fmtRand, noteClass, Stat, type Overview } from './shared';

// Smart Utility Monitoring tab (docs/SMART_UTILITY_ARCHITECTURE.md §10). One GET feeds everything;
// every child re-fetches through onChanged after a write.

export function SmartUtilityPanel({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/api/v1/properties/${propertyId}/smart-utility`, 'GET');
    if (!res.ok) {
      setError(errorMessage(res.data, 'Could not load utility monitoring.'));
      return;
    }
    setError(null);
    setData(res.data as Overview);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className={errorClass}>{error}</div>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading utility monitoring…</p>;

  const connected = data.meters.filter((m) => m.active && m.healthStatus !== 'manual');
  const unhealthy = connected.filter((m) => m.healthStatus === 'stale' || m.healthStatus === 'offline' || m.healthStatus === 'error');
  const openAlerts = data.alerts.filter((a) => a.status === 'open');
  const latest = data.submission.history[0];
  const costs = data.totals.map((t) => t.estimatedCost).filter((c): c is number => c !== null);

  async function setAlert(id: string, status: 'acknowledged' | 'resolved') {
    const res = await api(`/api/v1/utility-alerts/${id}`, 'PATCH', { status });
    if (!res.ok) window.alert(errorMessage(res.data));
    void load();
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Utility monitoring"
        description={`Billing period ${data.period.current.start} to ${data.period.current.end} (billing day ${data.period.billingDay})`}
        actions={<Button size="sm" variant="secondary" onClick={() => void load()}>Refresh</Button>}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {data.totals.map((t) => (
            <Stat
              key={t.utilityType}
              label={t.utilityType === 'water' ? 'Water this period' : 'Electricity this period'}
              value={`${fmtNumber(t.consumption, 2)} ${t.displayUnit}`}
              hint={t.meterCount === 0 ? 'No meters' : t.basis === 'main_meter' ? 'From the main meter' : 'Sum of unit meters'}
            />
          ))}
          <Stat label="Estimated cost so far" value={costs.length ? fmtRand(costs.reduce((a, b) => a + b, 0)) : '—'} hint="Set a tariff on each meter for estimates" />
          <Stat
            label="Connected meters"
            value={`${connected.length - unhealthy.length} / ${connected.length} online`}
            hint={unhealthy.length ? `${unhealthy.length} need attention` : connected.length ? 'All reporting' : 'Manual readings only'}
          />
          <Stat label="Open alerts" value={String(openAlerts.length)} hint={openAlerts.some((a) => a.rule === 'water_continuous_night_flow') ? 'Includes a possible leak' : undefined} />
          <Stat
            label="Municipal readings"
            value={latest ? latest.status.replace('_', ' ') : 'Not set up'}
            hint={latest ? `${latest.periodStart} → ${latest.periodEnd}` : 'Set up below'}
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {data.totals.filter((t) => t.meterCount > 0).map((t) => {
            const pts = t.daily.filter((d) => d.consumption !== null).map((d) => ({ label: d.date.slice(5), value: d.consumption as number }));
            return (
              <div key={t.utilityType}>
                <div className="mb-1 text-xs text-muted-foreground">
                  Daily {t.utilityType} use, last 30 days ({t.displayUnit})
                </div>
                {pts.length >= 2 ? <MiniLineChart points={pts} /> : <p className="text-xs text-muted-foreground">Not enough readings yet.</p>}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Alerts" description="Rule-based checks. They flag possibilities to look into — not confirmed faults.">
        {data.alerts.length === 0 ? <p className="text-sm text-muted-foreground">No alerts.</p> : (
          <ul className="space-y-2">
            {data.alerts.slice(0, 20).map((a) => (
              <li key={a.id} className="rounded-md border border-light-border p-3 text-sm dark:border-dark-border">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={a.status !== 'open' ? 'neutral' : a.severity === 'critical' ? 'bad' : 'warn'}>{a.status === 'open' ? a.severity : a.status}</Badge>
                      <span className="font-medium text-foreground">{a.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.message}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {fmtDateTime(a.created_at)}{a.estimated_cost !== null ? ` · estimated impact ${fmtRand(Number(a.estimated_cost))}` : ''}
                    </p>
                  </div>
                  {canManage && a.status === 'open' ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setAlert(a.id, 'acknowledged')}>Acknowledge</Button>
                      <Button size="sm" variant="secondary" onClick={() => setAlert(a.id, 'resolved')}>Resolved</Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Main meter vs unit meters" description={`Last complete period ${data.period.lastComplete.start} to ${data.period.lastComplete.end}`}>
        {data.reconciliation.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a main meter and unit meters to compare them.</p>
        ) : (
          <div className="space-y-3">
            {data.reconciliation.map((r) => (
              <div key={r.mainMeterId} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium capitalize text-foreground">{r.utilityType}</span>
                  <Badge tone={r.status === 'within_threshold' ? 'good' : r.status === 'above_threshold' ? 'warn' : 'neutral'}>
                    {r.status === 'within_threshold' ? 'Within threshold' : r.status === 'above_threshold' ? 'Above threshold' : r.status === 'submeters_exceed_main' ? 'Units exceed main — check readings' : 'Not enough data'}
                  </Badge>
                  {r.approximate ? <span className="text-xs text-muted-foreground">(approximate)</span> : null}
                </div>
                <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                  <div>Main meter: <strong>{fmtNumber(r.main, 3)} {r.displayUnit}</strong></div>
                  <div>Units combined: <strong>{fmtNumber(r.submeterTotal, 3)} {r.displayUnit}</strong></div>
                  <div>Unallocated: <strong>{fmtNumber(r.unallocated, 3)} {r.displayUnit}</strong>{r.unallocatedPct !== null ? ` (${r.unallocatedPct}%)` : ''}</div>
                </div>
                {r.missing.length ? <p className="mt-1 text-xs text-muted-foreground">No data for: {r.missing.join(', ')}</p> : null}
              </div>
            ))}
            <p className={noteClass}>
              Unallocated use can be common-area consumption, timing differences between readings, measurement error or a leak. It is not attributed to any tenant.
            </p>
          </div>
        )}
      </Panel>

      <MetersSection data={data} canManage={canManage} onChanged={() => void load()} />
      <IntegrationsSection data={data} canManage={canManage} onChanged={() => void load()} />
      <SubmissionsSection data={data} canManage={canManage} onChanged={() => void load()} />
    </div>
  );
}
