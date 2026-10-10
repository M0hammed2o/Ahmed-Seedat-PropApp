'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { MiniLineChart } from '@/components/ui/MiniLineChart';
import type { HybridDashboard } from '@/lib/smartUtility/hybridDashboard';
import { api, Badge, errorClass, errorMessage, Figure, fmtDateTime, fmtNumber, fmtRand, inputClass, KIND_LABEL, labelClass, noteClass, SOURCE_LABEL, type Overview } from './shared';

// Supply & sources (docs/HYBRID_UTILITIES_ARCHITECTURE.md §G): any date range; every figure shows its basis.

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
function sastToday(): string {
  return iso(new Date(Date.now() + 2 * 3_600_000));
}
function preset(kind: '7' | '30' | '90' | 'month' | 'last_month'): { from: string; to: string } {
  const today = sastToday();
  const tomorrow = iso(new Date(Date.parse(`${today}T00:00:00Z`) + DAY));
  if (kind === 'month') return { from: `${today.slice(0, 7)}-01`, to: tomorrow };
  if (kind === 'last_month') {
    const first = new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00Z`));
    const prev = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));
    return { from: iso(prev), to: iso(first) };
  }
  return { from: iso(new Date(Date.parse(`${tomorrow}T00:00:00Z`) - Number(kind) * DAY)), to: tomorrow };
}

const ELECTRICITY_TYPES = ['municipal_grid', 'eskom_direct', 'prepaid', 'solar_pv', 'battery', 'generator', 'other'];
const WATER_TYPES = ['municipal', 'borehole', 'rainwater', 'storage_tank', 'tanker', 'other'];

export function HybridSection({ data, canManage, onChanged }: { data: Overview; canManage: boolean; onChanged: () => void }) {
  const [range, setRange] = useState(preset('30'));
  const [dash, setDash] = useState<HybridDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [logFor, setLogFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await api(`/api/v1/properties/${data.property.id}/utility-dashboard?from=${range.from}&to=${range.to}`, 'GET');
    if (!res.ok) return setError(errorMessage(res.data, 'Could not load supply figures.'));
    setDash(res.data as HybridDashboard);
  }, [data.property.id, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    void load();
    onChanged();
  };

  return (
    <Panel
      title="Supply & sources"
      description="Grid, solar, battery, generator, municipal water, borehole, tanks and tankers — balanced without double counting"
      actions={canManage ? <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Add source'}</Button> : null}
    >
      {adding ? <AddSourceForm data={data} onDone={() => { setAdding(false); refresh(); }} /> : null}

      <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
        {([['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month'], ['last_month', 'Last month']] as const).map(([k, label]) => (
          <button key={k} className="rounded-full border border-light-border px-3 py-1 text-muted-foreground hover:text-foreground dark:border-dark-border" onClick={() => setRange(preset(k))}>
            {label}
          </button>
        ))}
        <label className={labelClass}>
          From
          <input className={inputClass} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </label>
        <label className={labelClass}>
          To (exclusive)
          <input className={inputClass} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </label>
      </div>

      {error ? <div className={errorClass} role="alert">{error}</div> : null}
      {!dash && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {dash ? (
        <div className="space-y-5">
          <section aria-label="Electricity balance">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Electricity · {dash.range.from} to {dash.range.to} ({dash.range.days} days)</h3>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <Figure label="Grid import" value={dash.electricity.gridImport.value} unit="kWh" basis={dash.electricity.gridImport.basis} />
              <Figure label="Solar generated" value={dash.electricity.generation.value} unit="kWh" basis={dash.electricity.generation.basis} />
              <Figure label="Solar used on site" value={dash.electricity.solarSelfConsumption.value} unit="kWh" basis={dash.electricity.solarSelfConsumption.basis} />
              <Figure label="Battery out / in" value={dash.electricity.batteryDischarge.value} unit="kWh" basis={dash.electricity.batteryDischarge.basis} hint={`charged ${fmtNumber(dash.electricity.batteryCharge.value)} kWh`} />
              <Figure label="Generator" value={dash.electricity.generatorOutput.value} unit="kWh" basis={dash.electricity.generatorOutput.basis} />
              <Figure label="Exported" value={dash.electricity.gridExport.value} unit="kWh" basis={dash.electricity.gridExport.basis} />
              <Figure label="Site supply" value={dash.electricity.siteSupply.value} unit="kWh" basis={dash.electricity.siteSupply.basis} />
              <Figure label="Measured use" value={dash.electricity.measuredConsumption.value} unit="kWh" basis={dash.electricity.measuredConsumption.basis} />
              <Figure label="Supply − use" value={dash.electricity.variance.value} unit="kWh" basis={dash.electricity.variance.basis} hint={dash.electricity.variancePct !== null ? `${dash.electricity.variancePct}% — losses or unmetered loads` : undefined} />
              <Figure label="Borehole pump" value={dash.electricity.pumpEnergy.value} unit="kWh" basis={dash.electricity.pumpEnergy.basis} />
            </div>
            {dash.electricity.siteSupply.value ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Where the energy came from: grid {dash.electricity.contribution.grid ?? 0}% · solar {dash.electricity.contribution.solar ?? 0}% · battery {dash.electricity.contribution.battery ?? 0}% · generator {dash.electricity.contribution.generator ?? 0}%
              </p>
            ) : null}
          </section>

          <section aria-label="Water balance">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Water</h3>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              {dash.water.bySource.map((s) => (
                <Figure key={s.sourceType} label={SOURCE_LABEL[s.sourceType] ?? s.label} value={s.volume.value} unit="kL" basis={s.volume.basis} />
              ))}
              <Figure label="Total supply" value={dash.water.totalSupply.value} unit="kL" basis={dash.water.totalSupply.basis} />
              <Figure label="Stored in tanks" value={dash.water.storageChange.value} unit="kL" basis={dash.water.storageChange.basis} hint="positive = tanks filled" />
              <Figure label="Used on site" value={dash.water.siteUse.value} unit="kL" basis={dash.water.siteUse.basis} />
              <Figure label="Measured use" value={dash.water.measuredConsumption.value} unit="kL" basis={dash.water.measuredConsumption.basis} />
              <Figure label="Supply − use" value={dash.water.variance.value} unit="kL" basis={dash.water.variance.basis} hint={dash.water.variancePct !== null ? `${dash.water.variancePct}% — possible leak, losses or missing meters` : undefined} />
            </div>
          </section>

          {[...dash.electricity.gaps, ...dash.water.gaps].length ? (
            <div className={noteClass}>
              <p className="font-medium">Data gaps</p>
              <ul className="list-disc pl-4">
                {[...dash.electricity.gaps, ...dash.water.gaps].map((g, i) => (
                  <li key={i}>
                    {g.label}: {g.kind === 'source_not_metered' ? 'no meter measures this source' : g.kind === 'tank_level_unknown' ? 'no tank level at the start or end of the range' : g.kind === 'meter_missing_data' ? 'no readings in this range' : g.kind === 'meter_incomplete' ? 'readings incomplete' : 'no consumption meter'}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <section aria-label="Source mix">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Per {dash.series[0]?.bucket ?? 'day'}</h3>
            <div className="grid gap-4 lg:grid-cols-3">
              {dash.series.flatMap((s) =>
                s.kinds.map((k) => {
                  const pts = k.points.filter((p) => p.value !== null).map((p) => ({ label: p.date.slice(5), value: p.value as number }));
                  return (
                    <div key={`${s.utilityType}-${k.kind}`}>
                      <div className="mb-1 text-xs text-muted-foreground">
                        {s.utilityType === 'water' ? 'Water' : 'Electricity'} · {KIND_LABEL[k.kind] ?? k.kind} ({s.utilityType === 'water' ? 'kL' : 'kWh'})
                      </div>
                      {pts.length >= 2 ? <MiniLineChart points={pts} height={90} /> : <p className="text-xs text-muted-foreground">Not enough readings.</p>}
                    </div>
                  );
                }),
              )}
            </div>
          </section>

          <section aria-label="Cost recovery">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Recovery</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Utility</th>
                    <th className="py-1 pr-2 font-medium">Grid / municipal cost (est.)</th>
                    <th className="py-1 pr-2 font-medium">Fuel & tanker (logged)</th>
                    <th className="py-1 pr-2 font-medium">Recharged (approved + invoiced)</th>
                    <th className="py-1 pr-2 font-medium">Drafts</th>
                    <th className="py-1 pr-2 font-medium">Recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.recovery.map((r) => (
                    <tr key={r.utilityType} className="border-t border-light-border dark:border-dark-border">
                      <td className="py-1 pr-2 capitalize">{r.utilityType}</td>
                      <td className="py-1 pr-2">{r.gridOrMunicipalCost === null ? <span className="text-muted-foreground">needs a tariff and intake meter</span> : `${fmtRand(r.gridOrMunicipalCost)} (${fmtNumber(r.intakeQuantity)} ${r.utilityType === 'water' ? 'kL' : 'kWh'})`}</td>
                      <td className="py-1 pr-2">{fmtRand(r.loggedSupplyCost)}</td>
                      <td className="py-1 pr-2">{fmtRand(r.charges.approved + r.charges.invoiced)}</td>
                      <td className="py-1 pr-2">{fmtRand(r.charges.draft)}{r.disputed ? ` · ${r.disputed} disputed` : ''}</td>
                      <td className="py-1 pr-2 font-medium">{r.recoveryPct === null ? '—' : `${r.recoveryPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{dash.notes.join(' ')}</p>
          </section>

          <section aria-label="Sources">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Sources</h3>
            {dash.sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No supply sources yet. Add the grid connection, solar, battery, generator, municipal water, borehole or tanks to see the full picture.</p>
            ) : (
              <ul className="space-y-2">
                {dash.sources.map((s) => (
                  <li key={s.id} className="rounded-md border border-light-border p-3 text-sm dark:border-dark-border">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{s.name}</span>
                        <span className="text-xs text-muted-foreground">{SOURCE_LABEL[s.sourceType] ?? s.sourceType}</span>
                        {!s.active ? <Badge tone="neutral">inactive</Badge> : null}
                        {s.metered ? <Badge tone="good">metered</Badge> : s.sourceType === 'storage_tank' ? null : <Badge tone="warn">not metered</Badge>}
                        {s.levelStatus !== 'unknown' ? <Badge tone={s.levelStatus === 'normal' ? 'good' : 'bad'}>{s.levelStatus === 'low' ? 'low' : s.levelStatus === 'high' ? 'near full' : 'normal'}</Badge> : null}
                      </div>
                      {canManage ? <Button size="sm" variant="secondary" onClick={() => setLogFor(logFor === s.id ? null : s.id)}>{logFor === s.id ? 'Close' : 'Add reading / log'}</Button> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.level ? `Latest ${s.level.metric.replace(/_/g, ' ')}: ${fmtNumber(s.level.value)}${s.level.pct !== null && !s.level.metric.endsWith('_pct') ? ` (${s.level.pct}%)` : ''} · ${fmtDateTime(s.level.readAt)}` : 'No level reading in the last 7 days.'}
                      {s.runHours ? ` · ${fmtNumber(s.runHours)} h run` : ''}
                      {s.fuelLitres ? ` · ${fmtNumber(s.fuelLitres)} L fuel` : ''}
                    </p>
                    {logFor === s.id ? <SourceEntryForm propertyId={data.property.id} source={s} onDone={() => { setLogFor(null); refresh(); }} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </Panel>
  );
}

function AddSourceForm({ data, onDone }: { data: Overview; onDone: () => void }) {
  const [form, setForm] = useState({ utilityType: 'electricity' as 'water' | 'electricity', sourceType: 'solar_pv', name: '', capacityValue: '', capacityUnit: '', lowLevelPct: '20', highLevelPct: '98', expectedDailyRunHours: '', fuelType: '' });
  const [error, setError] = useState<string | null>(null);
  const types = form.utilityType === 'electricity' ? ELECTRICITY_TYPES : WATER_TYPES;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const num = (v: string) => (v === '' ? null : Number(v));
    const res = await api(`/api/v1/properties/${data.property.id}/utility-sources`, 'POST', {
      utilityType: form.utilityType,
      sourceType: form.sourceType,
      name: form.name,
      capacityValue: num(form.capacityValue),
      capacityUnit: form.capacityUnit || null,
      lowLevelPct: Number(form.lowLevelPct),
      highLevelPct: Number(form.highLevelPct),
      expectedDailyRunHours: num(form.expectedDailyRunHours),
      fuelType: form.fuelType || null,
    });
    if (!res.ok) return setError(errorMessage(res.data));
    onDone();
  }
  return (
    <form onSubmit={submit} className="mb-4 space-y-2 rounded-md border border-light-border p-3 dark:border-dark-border">
      {error ? <div className={errorClass} role="alert">{error}</div> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={labelClass}>
          Utility
          <select className={inputClass} value={form.utilityType} onChange={(e) => { const u = e.target.value as 'water' | 'electricity'; setForm({ ...form, utilityType: u, sourceType: u === 'water' ? 'borehole' : 'solar_pv' }); }}>
            <option value="electricity">Electricity</option>
            <option value="water">Water</option>
          </select>
        </label>
        <label className={labelClass}>
          Type
          <select className={inputClass} value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>
            {types.map((t) => <option key={t} value={t}>{SOURCE_LABEL[t] ?? t}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Name
          <input className={inputClass} required maxLength={100} placeholder="e.g. Roof PV 8 kWp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className={labelClass}>
          Capacity
          <div className="flex gap-1">
            <input className={inputClass} type="number" min="0" step="any" value={form.capacityValue} onChange={(e) => setForm({ ...form, capacityValue: e.target.value })} />
            <select className={inputClass} value={form.capacityUnit} onChange={(e) => setForm({ ...form, capacityUnit: e.target.value })}>
              <option value="">unit</option>
              {['kWp', 'kWh', 'kVA', 'kW', 'litres', 'kL_per_hour'].map((u) => <option key={u} value={u}>{u.replace('_per_', '/')}</option>)}
            </select>
          </div>
        </label>
        {['storage_tank', 'rainwater', 'battery', 'generator'].includes(form.sourceType) ? (
          <>
            <label className={labelClass}>
              Low alert below (%)
              <input className={inputClass} type="number" min="0" max="100" value={form.lowLevelPct} onChange={(e) => setForm({ ...form, lowLevelPct: e.target.value })} />
            </label>
            {form.sourceType !== 'battery' && form.sourceType !== 'generator' ? (
              <label className={labelClass}>
                Overflow alert above (%)
                <input className={inputClass} type="number" min="0" max="100" value={form.highLevelPct} onChange={(e) => setForm({ ...form, highLevelPct: e.target.value })} />
              </label>
            ) : null}
          </>
        ) : null}
        {form.sourceType === 'generator' ? (
          <>
            <label className={labelClass}>
              Fuel
              <select className={inputClass} value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })}>
                <option value="">—</option>
                <option value="diesel">Diesel</option>
                <option value="petrol">Petrol</option>
                <option value="gas">Gas</option>
              </select>
            </label>
            <label className={labelClass}>
              Expected run hours per day
              <input className={inputClass} type="number" min="0" max="24" step="any" value={form.expectedDailyRunHours} onChange={(e) => setForm({ ...form, expectedDailyRunHours: e.target.value })} />
            </label>
          </>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Measure a source by adding a meter with “It measures” set to its register (e.g. solar generation). Tank levels and battery charge can come from a sensor or be entered by hand.
      </p>
      <Button type="submit" size="sm">Save source</Button>
    </form>
  );
}

function SourceEntryForm({ propertyId, source, onDone }: { propertyId: string; source: HybridDashboard['sources'][number]; onDone: () => void }) {
  const levelMetrics =
    source.sourceType === 'storage_tank' || source.sourceType === 'rainwater'
      ? ['tank_level_pct', 'tank_level_litres']
      : source.sourceType === 'battery'
        ? ['battery_soc_pct']
        : source.sourceType === 'generator'
          ? ['fuel_level_pct', 'run_hours']
          : [];
  const logTypes =
    source.sourceType === 'generator'
      ? ['fuel_purchase', 'fuel_added', 'run_hours', 'maintenance', 'service']
      : source.sourceType === 'storage_tank' || source.sourceType === 'tanker'
        ? ['tanker_delivery', 'maintenance', 'other']
        : ['maintenance', 'service', 'other'];
  const nowLocal = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 16);
  const [kind, setKind] = useState<'reading' | 'log'>(levelMetrics.length ? 'reading' : 'log');
  const [form, setForm] = useState({ metric: levelMetrics[0] ?? '', value: '', at: nowLocal, logType: logTypes[0]!, quantity: '', quantityUnit: source.sourceType === 'generator' ? 'litres' : 'kL', cost: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const at = `${form.at}:00+02:00`;
    const body =
      kind === 'reading'
        ? { kind, metric: form.metric, readAt: at, value: Number(form.value) }
        : { kind, logType: form.logType, occurredAt: at, quantity: form.quantity === '' ? null : Number(form.quantity), quantityUnit: form.quantity === '' ? null : form.logType === 'run_hours' ? 'hours' : form.quantityUnit, costAmount: form.cost === '' ? null : Number(form.cost), notes: form.notes || null };
    const res = await api(`/api/v1/properties/${propertyId}/utility-sources/${source.id}`, 'POST', body);
    if (!res.ok) return setError(errorMessage(res.data));
    onDone();
  }
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 border-t border-light-border pt-2 dark:border-dark-border">
      {error ? <div className={errorClass} role="alert">{error}</div> : null}
      <div className="flex gap-2 text-xs">
        {levelMetrics.length ? <label><input type="radio" checked={kind === 'reading'} onChange={() => setKind('reading')} /> Level / counter reading</label> : null}
        <label><input type="radio" checked={kind === 'log'} onChange={() => setKind('log')} /> Log entry</label>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className={labelClass}>
          When (SAST)
          <input className={inputClass} type="datetime-local" required value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
        </label>
        {kind === 'reading' ? (
          <>
            <label className={labelClass}>
              Measure
              <select className={inputClass} value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>
                {levelMetrics.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ').replace('pct', '%')}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              Value
              <input className={inputClass} type="number" min="0" step="any" required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </label>
          </>
        ) : (
          <>
            <label className={labelClass}>
              Type
              <select className={inputClass} value={form.logType} onChange={(e) => setForm({ ...form, logType: e.target.value })}>
                {logTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              Quantity {form.logType === 'run_hours' ? '(hours)' : ''}
              <div className="flex gap-1">
                <input className={inputClass} type="number" min="0" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                {form.logType !== 'run_hours' ? (
                  <select className={inputClass} value={form.quantityUnit} onChange={(e) => setForm({ ...form, quantityUnit: e.target.value })}>
                    <option value="litres">litres</option>
                    <option value="kL">kL</option>
                    <option value="kWh">kWh</option>
                  </select>
                ) : null}
              </div>
            </label>
            <label className={labelClass}>
              Cost incl. VAT (R)
              <input className={inputClass} type="number" min="0" step="any" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            </label>
          </>
        )}
      </div>
      <Button type="submit" size="sm">Save</Button>
    </form>
  );
}
