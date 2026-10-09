'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { AddMeterWizard } from './AddMeterWizard';
import { DEVICE_MODELS, INTERVALS_BY_CONNECTIVITY, intervalLabel } from '@/lib/smartUtility/catalog';
import {
  api,
  Badge,
  errorClass,
  errorMessage,
  fmtDateTime,
  fmtNumber,
  fmtRand,
  HEALTH_LABEL,
  HEALTH_TONE,
  inputClass,
  labelClass,
  meterLabel,
  noteClass,
  type MeterSummary,
  type Overview,
} from './shared';

// Meter management (docs/SMART_UTILITY_ARCHITECTURE.md §10): hierarchy listing, add/replace meter,
// manual reading with an optional meter photo, decommission. Kept to one form with sensible
// defaults from the hardware catalogue so a non-technical landlord can complete it.

export function MetersSection({
  data,
  canManage,
  onChanged,
}: {
  data: Overview;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState<MeterSummary | null>(null);
  const [readingFor, setReadingFor] = useState<MeterSummary | null>(null);

  const active = data.meters.filter((m) => m.active);
  const ordered = [
    ...active.filter((m) => m.meterRole === 'main'),
    ...active.filter((m) => m.meterRole === 'check'),
    ...active.filter((m) => m.meterRole === 'submeter'),
  ];
  const retired = data.meters.filter((m) => !m.active);

  async function decommission(m: MeterSummary) {
    if (!window.confirm('Decommission this meter? Its reading history is kept.')) return;
    const res = await api(`/api/v1/smart-meters/${m.id}`, 'PATCH', { decommission: true });
    if (!res.ok) window.alert(errorMessage(res.data));
    onChanged();
  }

  return (
    <Panel
      title="Meters"
      description="Main meters, building check meters and unit meters"
      actions={canManage ? <Button size="sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Add meter'}</Button> : null}
    >
      {adding ? <AddMeterWizard data={data} onDone={() => { setAdding(false); onChanged(); }} /> : null}
      {replacing ? (
        <MeterForm data={data} replacing={replacing} onDone={() => { setReplacing(null); onChanged(); }} />
      ) : null}
      {readingFor ? (
        <ManualReadingForm data={data} meter={readingFor} onDone={() => { setReadingFor(null); onChanged(); }} />
      ) : null}

      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No meters yet. Add the municipal (main) meter first, then any unit meters. Meters without smart hardware can still
          be read by hand.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Meter</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Latest reading</th>
                <th className="py-2 pr-3 font-medium">This period</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                {canManage ? <th className="py-2 font-medium" /> : null}
              </tr>
            </thead>
            <tbody>
              {ordered.map((m) => (
                <tr key={m.id} className="border-t border-light-border align-top dark:border-dark-border">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-foreground">{meterLabel(m, data.units)}</div>
                    <div className="text-xs text-muted-foreground">
                      {[m.manufacturer, m.model].filter(Boolean).join(' ') || 'Manual'}
                      {m.ownership === 'municipal' ? ' · Municipal meter' : ''}
                      {m.location ? ` · ${m.location}` : ''}
                    </div>
                  </td>
                  <td className="py-2 pr-3 capitalize">{m.meterRole}</td>
                  <td className="py-2 pr-3">
                    {fmtNumber(m.lastReading, 3)} {m.displayUnit}
                    <div className="text-xs text-muted-foreground">{fmtDateTime(m.lastReadingAt)}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {fmtNumber(m.periodToDate.consumption, 3)} {m.displayUnit}
                    {m.periodToDate.quality === 'partial' ? <span className="ml-1 text-xs text-muted-foreground">(partial)</span> : null}
                    {m.estimatedCostToDate !== null ? (
                      <div className="text-xs text-muted-foreground">≈ {fmtRand(m.estimatedCostToDate)}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={HEALTH_TONE[m.healthStatus] ?? 'neutral'}>{HEALTH_LABEL[m.healthStatus] ?? m.healthStatus}</Badge>
                    {m.readingsLast24h.missing ? (
                      <div className="mt-1 text-[11px] text-light-warning dark:text-dark-warning">
                        {m.readingsLast24h.missing} of {m.readingsLast24h.expected} readings missing (24 h)
                      </div>
                    ) : null}
                    {m.latestReadingStatus === 'suspect' ? <div className="mt-1 text-[11px] text-muted-foreground">Latest reading flagged</div> : null}
                  </td>
                  {canManage ? (
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setReadingFor(m)}>Reading</Button>
                        <Button size="sm" variant="secondary" onClick={() => setReplacing(m)}>Replace</Button>
                        <Button size="sm" variant="secondary" onClick={() => decommission(m)}>Retire</Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {retired.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {retired.length} retired/replaced meter{retired.length === 1 ? '' : 's'} kept for history.
        </p>
      ) : null}
    </Panel>
  );
}

function MeterForm({ data, replacing, onDone }: { data: Overview; replacing?: MeterSummary; onDone: () => void }) {
  const [utilityType, setUtilityType] = useState<'water' | 'electricity'>(replacing?.utilityType ?? 'water');
  const models = useMemo(() => DEVICE_MODELS.filter((m) => m.utilityType === utilityType), [utilityType]);
  const [modelIdx, setModelIdx] = useState(0);
  const model = models[modelIdx] ?? models[0]!;
  const [meterRole, setMeterRole] = useState<'main' | 'submeter' | 'check'>(replacing?.meterRole ?? 'main');
  const [ownership, setOwnership] = useState<'municipal' | 'private'>(replacing?.ownership ?? 'municipal');
  const [unitId, setUnitId] = useState(replacing?.unitId ?? '');
  const [parentMeterId, setParentMeterId] = useState(replacing?.parentMeterId ?? '');
  const [integrationId, setIntegrationId] = useState('');
  const [externalDeviceId, setExternalDeviceId] = useState('');
  const [externalChannel, setExternalChannel] = useState(model.channels[0]?.value ?? '');
  const [multiplier, setMultiplier] = useState(String(model.defaultMultiplier));
  const [startReading, setStartReading] = useState('');
  const [registerDigits, setRegisterDigits] = useState('');
  const [readInterval, setReadInterval] = useState(String(INTERVALS_BY_CONNECTIVITY[model.connectivity][1] ?? ''));
  const [tariff, setTariff] = useState('');
  const [meterNumber, setMeterNumber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const integrations = data.integrations.filter((i) => i.status === 'active' && (!model.provider || i.provider === model.provider || i.provider === 'simulator' || (model.provider === 'generic_json' && i.provider === 'generic_json')));
  const parents = data.meters.filter((m) => m.active && m.utilityType === utilityType && (m.meterRole === 'main' || m.meterRole === 'check'));
  const connected = model.connectivity !== 'manual';

  function pickModel(i: number) {
    setModelIdx(i);
    const m = models[i]!;
    setMultiplier(String(m.defaultMultiplier));
    setExternalChannel(m.channels[0]?.value ?? '');
    setReadInterval(String(INTERVALS_BY_CONNECTIVITY[m.connectivity][1] ?? INTERVALS_BY_CONNECTIVITY[m.connectivity][0] ?? ''));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const offsetBase = startReading ? Number(startReading) * (utilityType === 'water' ? 1000 : 1) : 0;
    const body = {
      utilityType,
      meterRole,
      ownership,
      unitId: unitId || null,
      parentMeterId: meterRole === 'submeter' && parentMeterId ? parentMeterId : null,
      meterNumber: meterNumber || null,
      serialNumber: serialNumber || null,
      manufacturer: model.manufacturer === 'Other' ? null : model.manufacturer,
      model: model.manufacturer === 'Other' ? null : model.model,
      connectivity: model.connectivity,
      integrationId: connected ? integrationId || null : null,
      externalDeviceId: connected ? externalDeviceId.trim() || null : null,
      externalChannel: connected ? externalChannel : '',
      multiplier: Number(multiplier) || 1,
      valueOffset: offsetBase,
      registerDigits: registerDigits ? Number(registerDigits) : null,
      expectedIntervalMinutes: readInterval ? Number(readInterval) : null,
      tariffPerUnit: tariff ? Number(tariff) : null,
      responsibilityMode: meterRole === 'submeter' ? 'tenant_paid_direct' : 'owner_paid',
    };
    const url = replacing
      ? `/api/v1/smart-meters/${replacing.id}/replace`
      : `/api/v1/properties/${data.property.id}/smart-meters`;
    const res = await api(url, 'POST', body);
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res.data));
    onDone();
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-md border border-light-border p-4 dark:border-dark-border">
      <div className="text-sm font-medium text-foreground">
        {replacing ? `Replace ${meterLabel(replacing, data.units)} (history is kept)` : 'Add a meter'}
      </div>
      {error ? <div className={errorClass}>{error}</div> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Utility
          <select className={inputClass} value={utilityType} disabled={!!replacing} onChange={(e) => { setUtilityType(e.target.value as 'water' | 'electricity'); setModelIdx(0); }}>
            <option value="water">Water</option>
            <option value="electricity">Electricity</option>
          </select>
        </label>
        <label className={labelClass}>
          Meter type
          <select className={inputClass} value={meterRole} onChange={(e) => setMeterRole(e.target.value as typeof meterRole)}>
            <option value="main">Main property meter</option>
            <option value="check">Building check meter</option>
            <option value="submeter">Unit meter (submeter)</option>
          </select>
        </label>
        <label className={labelClass}>
          Who owns it
          <select className={inputClass} value={ownership} onChange={(e) => setOwnership(e.target.value as typeof ownership)}>
            <option value="municipal">Municipality (official meter)</option>
            <option value="private">Private (installed by the owner)</option>
          </select>
        </label>
        {meterRole === 'submeter' ? (
          <>
            <label className={labelClass}>
              Unit
              <select className={inputClass} value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
                <option value="">Choose a unit</option>
                {data.units.map((u) => <option key={u.id} value={u.id}>{u.unit_label}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              Fed by (main/check meter)
              <select className={inputClass} value={parentMeterId} onChange={(e) => setParentMeterId(e.target.value)}>
                <option value="">Not specified</option>
                {parents.map((m) => <option key={m.id} value={m.id}>{meterLabel(m, data.units)}</option>)}
              </select>
            </label>
          </>
        ) : null}
        <label className={labelClass}>
          Meter number (as on the meter / account)
          <input className={inputClass} value={meterNumber} onChange={(e) => setMeterNumber(e.target.value)} maxLength={100} />
        </label>
        <label className={labelClass}>
          Serial number
          <input className={inputClass} value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} maxLength={100} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Hardware
          <select className={inputClass} value={modelIdx} onChange={(e) => pickModel(Number(e.target.value))}>
            {models.map((m, i) => <option key={`${m.manufacturer}-${m.model}`} value={i}>{m.manufacturer === 'Other' ? m.model : `${m.manufacturer} ${m.model}`}</option>)}
          </select>
        </label>
      </div>
      <p className={noteClass}>{model.note}{model.billingGrade ? '' : ' Not a billing-grade meter on its own.'}</p>

      {connected ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            Connection
            <select className={inputClass} value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} required>
              <option value="">{integrations.length ? 'Choose a gateway / connection' : 'Create a connection first (Hardware connections)'}</option>
              {integrations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Device ID {model.provider === 'milesight_lorawan' ? '(DevEUI, 16 hex characters)' : ''}
            <input className={inputClass} value={externalDeviceId} onChange={(e) => setExternalDeviceId(e.target.value)} required maxLength={100} />
          </label>
          <label className={labelClass}>
            Channel
            <select className={inputClass} value={externalChannel} onChange={(e) => setExternalChannel(e.target.value)}>
              {model.channels.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Multiplier
            <input className={inputClass} type="number" step="any" min="0" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
            <span className="mt-1 block text-[11px]">{model.multiplierNote}</span>
          </label>
          <label className={labelClass}>
            Dial reading when the device was fitted ({utilityType === 'water' ? 'kL' : 'kWh'})
            <input className={inputClass} type="number" step="any" min="0" value={startReading} onChange={(e) => setStartReading(e.target.value)} />
            <span className="mt-1 block text-[11px]">Aligns the device count with the meter dial.</span>
          </label>
          <label className={labelClass}>
            Reading frequency
            <select className={inputClass} value={readInterval} onChange={(e) => setReadInterval(e.target.value)}>
              {INTERVALS_BY_CONNECTIVITY[model.connectivity].map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
            </select>
            <span className="mt-1 block text-[11px]">Set the same interval on the device or gateway.</span>
          </label>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Tariff for cost estimates (R per {utilityType === 'water' ? 'kL' : 'kWh'})
          <input className={inputClass} type="number" step="any" min="0" value={tariff} onChange={(e) => setTariff(e.target.value)} />
        </label>
        <label className={labelClass}>
          Register digits (optional, for rollover)
          <input className={inputClass} type="number" min="3" max="12" value={registerDigits} onChange={(e) => setRegisterDigits(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : replacing ? 'Replace meter' : 'Add meter'}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function ManualReadingForm({ data, meter, onDone }: { data: Overview; meter: MeterSummary; onDone: () => void }) {
  const [reading, setReading] = useState('');
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 2 * 3_600_000);
    return d.toISOString().slice(0, 16); // SAST wall clock for the datetime-local input
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadPhoto(file: File): Promise<string> {
    const cats = await api('/api/v1/document-categories', 'GET');
    const slug = meter.utilityType === 'water' ? 'water' : 'electricity';
    const categoryId = cats.data?.categories?.find((c: { slug: string }) => c.slug === slug)?.id;
    if (!categoryId) throw new Error('Document category not found.');
    const form = new FormData();
    form.set('file', file);
    form.set('orgId', data.property.org_id);
    form.set('propertyId', data.property.id);
    form.set('categoryId', categoryId);
    form.set('documentType', 'bill');
    const res = await fetch('/api/v1/documents', { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message ?? 'Photo upload failed.');
    return body.document.id as string;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const documentId = photo ? await uploadPhoto(photo) : null;
      const readAt = new Date(`${when}:00+02:00`).toISOString();
      const res = await api(`/api/v1/smart-meters/${meter.id}/telemetry`, 'POST', { readAt, reading: Number(reading), documentId });
      if (!res.ok) throw new Error(errorMessage(res.data));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the reading.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-md border border-light-border p-4 dark:border-dark-border">
      <div className="text-sm font-medium text-foreground">Record a reading — {meterLabel(meter, data.units)}</div>
      {error ? <div className={errorClass}>{error}</div> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Reading on the dial ({meter.displayUnit})
          <input className={inputClass} type="number" step="any" min="0" required value={reading} onChange={(e) => setReading(e.target.value)} />
        </label>
        <label className={labelClass}>
          Date and time (SAST)
          <input className={inputClass} type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className={labelClass}>
          Photo of the meter {meter.ownership === 'municipal' ? '(recommended for municipal submissions)' : '(optional)'}
          <input className={inputClass} type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save reading'}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
