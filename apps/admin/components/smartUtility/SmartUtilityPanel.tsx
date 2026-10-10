'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { MiniLineChart } from '@/components/ui/MiniLineChart';
import { BillingSection } from './BillingSection';
import { IntegrationsSection } from './IntegrationsSection';
import { MetersSection } from './MetersSection';
import { SubmissionsSection } from './SubmissionsSection';
import { api, Badge, errorClass, errorMessage, fmtDateTime, fmtNumber, fmtRand, noteClass, Stat, type Overview } from './shared';

// Smart Utility Monitoring tab (docs/SMART_UTILITY_ARCHITECTURE.md §10). One GET feeds everything;
// every child re-fetches through onChanged after a write.

export function SmartUtilityPanel({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');

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
            value={latest ? latest.status.replace(/_/g, ' ') : data.submission.settings ? 'No packs yet' : 'Not set up'}
            hint={latest ? `${latest.periodStart} → ${latest.periodEnd}` : data.submission.settings ? 'First pack is prepared before the billing day' : 'Set up below'}
          />
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs" role="tablist" aria-label="Chart period">
          {(['daily', 'weekly', 'monthly'] as const).map((g) => (
            <button
              key={g}
              role="tab"
              aria-selected={granularity === g}
              className={`rounded-full border px-3 py-1 ${granularity === g ? 'border-foreground text-foreground' : 'border-light-border text-muted-foreground dark:border-dark-border'}`}
              onClick={() => setGranularity(g)}
            >
              {g === 'daily' ? 'Daily (30 days)' : g === 'weekly' ? 'Weekly (12 weeks)' : 'Monthly (billing periods)'}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {data.totals.filter((t) => t.meterCount > 0).map((t) => {
            const series =
              granularity === 'monthly'
                ? t.monthly.map((m) => ({ label: m.periodStart.slice(0, 7), value: m.consumption, partial: m.quality !== 'complete' }))
                : (granularity === 'weekly' ? t.weekly : t.daily).map((d) => ({ label: d.date.slice(5), value: d.consumption, partial: false }));
            const pts = series.filter((d) => d.value !== null).map((d) => ({ label: d.label, value: d.value as number }));
            const gaps = series.length - pts.length;
            return (
              <div key={t.utilityType}>
                <div className="mb-1 text-xs text-muted-foreground">
                  {t.utilityType === 'water' ? 'Water' : 'Electricity'} use ({t.displayUnit})
                  {gaps > 0 ? ` · ${gaps} period${gaps === 1 ? '' : 's'} without enough readings` : ''}
                  {series.some((d) => d.partial) ? ' · some months are partial' : ''}
                </div>
                {pts.length >= 2 ? (
                  <MiniLineChart points={pts} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Not enough readings yet{granularity === 'monthly' ? ' (monthly history starts after the first billing day)' : ''}.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Figures are calculated from cumulative meter readings. “Partial” means some readings were missing or a meter was reset or
          replaced; costs are estimates from the tariff you entered.
        </p>
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

      {data.unitComparison.length > 0 ? (
        <Panel title="Units compared" description="This billing period, from each unit's own meters">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Unit</th>
                  <th className="py-2 pr-3 font-medium">Water (kL)</th>
                  <th className="py-2 pr-3 font-medium">Electricity (kWh)</th>
                  <th className="py-2 pr-3 font-medium">Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {data.unitComparison.map((u) => (
                  <tr key={u.unitId} className="border-t border-light-border dark:border-dark-border">
                    <td className="py-2 pr-3">
                      {u.unitLabel}
                      {u.status === 'vacant' ? <span className="ml-1 text-xs text-muted-foreground">(vacant)</span> : null}
                    </td>
                    {(['water', 'electricity'] as const).map((k) => {
                      const v = u[k];
                      return (
                        <td key={k} className="py-2 pr-3">
                          {v ? `${fmtNumber(v.consumption, 3)}${v.partial ? ' (partial)' : ''}` : <span className="text-xs text-muted-foreground">no meter</span>}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-3">
                      {u.water?.estimatedCost != null || u.electricity?.estimatedCost != null
                        ? fmtRand((u.water?.estimatedCost ?? 0) + (u.electricity?.estimatedCost ?? 0))
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {canManage ? <AlertSettings data={data} onSaved={() => void load()} /> : null}

      <MetersSection data={data} canManage={canManage} onChanged={() => void load()} />
      <IntegrationsSection data={data} canManage={canManage} onChanged={() => void load()} />
      <SubmissionsSection data={data} canManage={canManage} onChanged={() => void load()} />
      <BillingSection data={data} canManage={canManage} />
    </div>
  );
}

function AlertSettings({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(data.alertSettings);
  const [msg, setMsg] = useState<string | null>(null);
  const fields: [keyof typeof form, string, string][] = [
    ['discrepancyThresholdPct', 'Unallocated main-meter use alert above (%)', '15'],
    ['spikeMultiple', 'Spike: day use above × typical day', '3'],
    ['nightFlowLitresPerHour', 'Possible leak: water every night hour above (L/h)', '5'],
    ['nightBaseLoadRatio', 'High night electricity: night/day ratio above', '0.6'],
    ['vacantWaterLitresPerDay', 'Vacant unit water above (L/day)', '50'],
    ['vacantElectricityKwhPerDay', 'Vacant unit electricity above (kWh/day)', '2'],
  ];
  async function save() {
    const res = await api(`/api/v1/properties/${data.property.id}/utility-alert-settings`, 'PUT', form);
    setMsg(res.ok ? 'Saved.' : errorMessage(res.data));
    if (res.ok) onSaved();
  }
  return (
    <Panel
      title="Alert sensitivity"
      description="Higher values mean fewer alerts. Spikes are only judged after several days of history."
      actions={
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Adjust'}
        </Button>
      }
    >
      {open ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {fields.map(([k, label, def]) => (
              <label key={k} className="block text-xs text-muted-foreground">
                {label} <span className="text-[10px]">(default {def})</span>
                <input
                  className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border"
                  type="number"
                  step="any"
                  min="0"
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save}>Save</Button>
            {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Leak alert above {data.alertSettings.nightFlowLitresPerHour} L/h overnight · spike above {data.alertSettings.spikeMultiple}× typical ·
          unallocated above {data.alertSettings.discrepancyThresholdPct}%.
        </p>
      )}
    </Panel>
  );
}
