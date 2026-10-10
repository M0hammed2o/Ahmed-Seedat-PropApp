'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { INTERVALS_BY_CONNECTIVITY, intervalLabel } from '@/lib/smartUtility/catalog';
import {
  CONNECTION_LABEL,
  METER_CATALOGUE,
  STATUS_LABEL,
  type CatalogueEntry,
  type CatalogueStatus,
} from '@/lib/smartUtility/meterCatalogue';
import { PROVIDERS, type ProviderId } from '@/lib/smartUtility/providers';
import { api, Badge, errorClass, errorMessage, fmtDateTime, fmtNumber, inputClass, labelClass, meterLabel, noteClass, type Overview } from './shared';

// "Add smart meter" (docs/SMART_UTILITIES_PROGRESS.md §5): where → which hardware (catalogue with
// honest status, price, gateway and recurring cost) → connect + configure → guided setup and a live
// connection test that shows the first reading. Unsupported hardware routes to an integration
// request; traditional meters route to manual readings with photos.

const STATUS_TONE: Record<CatalogueStatus, 'good' | 'warn' | 'bad' | 'neutral'> = {
  verified_ready: 'good',
  needs_hardware_testing: 'warn',
  supplier_approval: 'neutral',
  unsupported: 'bad',
};

type Step = 'where' | 'catalogue' | 'configure' | 'connect' | 'request';

// What a register measures (migration 178). Only 'consumption' is ever billed or used by leak rules.
export const MEASUREMENT_KINDS: Record<'water' | 'electricity', { value: string; label: string; sourceTypes?: string[]; sourceUtility?: 'water' }[]> = {
  electricity: [
    { value: 'consumption', label: 'Consumption (what is used)' },
    { value: 'grid_import', label: 'Grid import (bought from municipality/Eskom)', sourceTypes: ['municipal_grid', 'eskom_direct', 'prepaid'] },
    { value: 'grid_export', label: 'Grid export (fed back)', sourceTypes: ['municipal_grid', 'eskom_direct'] },
    { value: 'generation', label: 'Solar generation (inverter PV output)', sourceTypes: ['solar_pv'] },
    { value: 'battery_charge', label: 'Battery charging', sourceTypes: ['battery'] },
    { value: 'battery_discharge', label: 'Battery discharging', sourceTypes: ['battery'] },
    { value: 'generator_output', label: 'Generator output', sourceTypes: ['generator'] },
    { value: 'pump_energy', label: 'Borehole pump energy', sourceTypes: ['borehole'], sourceUtility: 'water' },
    { value: 'transfer', label: 'Internal transfer (not supply)' },
  ],
  water: [
    { value: 'consumption', label: 'Consumption (what is used)' },
    { value: 'source_supply', label: 'Supply from a source (municipal, borehole, rainwater, tanker)', sourceTypes: ['municipal', 'borehole', 'rainwater', 'tanker', 'other'] },
    { value: 'tank_inflow', label: 'Tank inflow (internal)', sourceTypes: ['storage_tank'] },
    { value: 'tank_outflow', label: 'Tank outflow (internal)', sourceTypes: ['storage_tank'] },
    { value: 'transfer', label: 'Internal transfer (not supply)' },
  ],
};

function rand(n: number) {
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AddMeterWizard({ data, onDone }: { data: Overview; onDone: () => void }) {
  const [step, setStep] = useState<Step>('where');
  const [utilityType, setUtilityType] = useState<'water' | 'electricity'>('water');
  const [meterRole, setMeterRole] = useState<'main' | 'check' | 'submeter'>('main');
  const [unitId, setUnitId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [parentMeterId, setParentMeterId] = useState('');
  const [measurementKind, setMeasurementKind] = useState('consumption');
  const [supplySourceId, setSupplySourceId] = useState('');
  const kindDef = MEASUREMENT_KINDS[utilityType].find((k) => k.value === measurementKind) ?? MEASUREMENT_KINDS[utilityType][0]!;
  const kindSources = (data.sources ?? []).filter(
    (s) => s.active && kindDef.sourceTypes?.includes(s.source_type) && s.utility_type === (kindDef.sourceUtility ?? utilityType),
  );
  const [entry, setEntry] = useState<CatalogueEntry | null>(null);
  const [createdMeterId, setCreatedMeterId] = useState<string | null>(null);

  const parents = data.meters.filter((m) => m.active && m.utilityType === utilityType && (m.meterRole === 'main' || m.meterRole === 'check'));

  return (
    <div className="mb-4 space-y-3 rounded-md border border-light-border p-4 dark:border-dark-border">
      <ol className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="Steps">
        {(['where', 'catalogue', 'configure', 'connect'] as Step[]).map((s, i) => (
          <li key={s} className={step === s ? 'font-semibold text-foreground' : ''}>
            {i + 1}. {s === 'where' ? 'Where' : s === 'catalogue' ? 'Choose meter' : s === 'configure' ? 'Details' : 'Connect & test'}
          </li>
        ))}
      </ol>

      {step === 'where' ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              Utility
              <select
                className={inputClass}
                value={utilityType}
                onChange={(e) => {
                  setUtilityType(e.target.value as 'water' | 'electricity');
                  setMeasurementKind('consumption');
                  setSupplySourceId('');
                }}
              >
                <option value="water">Water</option>
                <option value="electricity">Electricity</option>
              </select>
            </label>
            <label className={labelClass}>
              This meter is
              <select className={inputClass} value={meterRole} onChange={(e) => setMeterRole(e.target.value as typeof meterRole)}>
                <option value="main">The property's main meter</option>
                <option value="check">A building or shared-area meter</option>
                <option value="submeter">A unit's own meter</option>
              </select>
            </label>
            {meterRole === 'submeter' ? (
              <label className={labelClass}>
                Unit
                <select className={inputClass} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  <option value="">Choose a unit</option>
                  {data.units.map((u) => <option key={u.id} value={u.id}>{u.unit_label}</option>)}
                </select>
              </label>
            ) : null}
            {meterRole !== 'main' && data.buildings.length ? (
              <label className={labelClass}>
                Building (optional)
                <select className={inputClass} value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                  <option value="">—</option>
                  {data.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            ) : null}
            <label className={labelClass}>
              It measures
              <select
                className={inputClass}
                value={measurementKind}
                onChange={(e) => {
                  setMeasurementKind(e.target.value);
                  setSupplySourceId('');
                }}
              >
                {MEASUREMENT_KINDS[utilityType].map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </label>
            {kindDef.sourceTypes ? (
              <label className={labelClass}>
                Supply source
                <select className={inputClass} value={supplySourceId} onChange={(e) => setSupplySourceId(e.target.value)}>
                  <option value="">{kindSources.length ? 'Choose a source' : 'None yet — add it under Supply & sources'}</option>
                  {kindSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            ) : null}
            {meterRole !== 'main' && parents.length ? (
              <label className={labelClass}>
                Fed by
                <select className={inputClass} value={parentMeterId} onChange={(e) => setParentMeterId(e.target.value)}>
                  <option value="">Not specified</option>
                  {parents.map((m) => <option key={m.id} value={m.id}>{meterLabel(m, data.units)}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button disabled={meterRole === 'submeter' && !unitId} onClick={() => setStep('catalogue')}>Next: choose meter</Button>
            <Button variant="secondary" onClick={onDone}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {step === 'catalogue' ? (
        <CataloguePicker
          utilityType={utilityType}
          meterRole={meterRole}
          onPick={(e) => {
            setEntry(e);
            setStep(e.status === 'supplier_approval' || e.status === 'unsupported' ? 'request' : 'configure');
          }}
          onRequest={() => {
            setEntry(null);
            setStep('request');
          }}
          onBack={() => setStep('where')}
        />
      ) : null}

      {step === 'request' ? (
        <IntegrationRequestForm data={data} utilityType={utilityType} entry={entry} onBack={() => setStep('catalogue')} onDone={onDone} />
      ) : null}

      {step === 'configure' && entry ? (
        <ConfigureMeter
          data={data}
          entry={entry}
          utilityType={utilityType}
          meterRole={meterRole}
          unitId={unitId || null}
          buildingId={buildingId || null}
          parentMeterId={parentMeterId || null}
          measurementKind={measurementKind}
          supplySourceId={supplySourceId || null}
          onBack={() => setStep('catalogue')}
          onCreated={(id) => {
            setCreatedMeterId(id);
            setStep('connect');
          }}
        />
      ) : null}

      {step === 'connect' && entry && createdMeterId ? (
        <ConnectAndTest entry={entry} meterId={createdMeterId} utilityType={utilityType} onDone={onDone} />
      ) : null}
    </div>
  );
}

function CataloguePicker({
  utilityType,
  meterRole,
  onPick,
  onRequest,
  onBack,
}: {
  utilityType: 'water' | 'electricity';
  meterRole: 'main' | 'check' | 'submeter';
  onPick: (e: CatalogueEntry) => void;
  onRequest: () => void;
  onBack: () => void;
}) {
  const [manufacturer, setManufacturer] = useState('');
  const [connection, setConnection] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const base = METER_CATALOGUE.filter((e) => e.utilityType === utilityType && e.roles.includes(meterRole));
  const manufacturers = [...new Set(base.map((e) => e.manufacturer))].sort();
  const connections = [...new Set(base.map((e) => e.connection))];
  const list = base.filter(
    (e) =>
      (!manufacturer || e.manufacturer === manufacturer) &&
      (!connection || e.connection === connection) &&
      (showAll || e.status === 'verified_ready' || e.status === 'needs_hardware_testing') &&
      (!query || `${e.manufacturer} ${e.model}`.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={labelClass}>
          Search
          <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Shelly" />
        </label>
        <label className={labelClass}>
          Manufacturer
          <select className={inputClass} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}>
            <option value="">All</option>
            {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Connection
          <select className={inputClass} value={connection} onChange={(e) => setConnection(e.target.value)}>
            <option value="">All</option>
            {connections.map((c) => <option key={c} value={c}>{CONNECTION_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="flex items-end gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Also show meters that need supplier approval or aren't supported
        </label>
      </div>
      <p className={noteClass}>
        “Awaiting hardware testing” means Proplyst follows the manufacturer's published format but has not yet tested that exact device. Prices are from South African retailer pages on the date shown — get a quote before buying.
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {list.map((e) => (
          <li key={e.id} className="flex flex-col justify-between rounded-md border border-light-border p-3 text-sm dark:border-dark-border">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{e.manufacturer === 'Any' ? e.model : `${e.manufacturer} ${e.model}`}</span>
                <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{e.description}</p>
              <dl className="grid grid-cols-2 gap-x-2 text-xs">
                <dt className="text-muted-foreground">Connection</dt><dd>{CONNECTION_LABEL[e.connection]}</dd>
                <dt className="text-muted-foreground">Price</dt>
                <dd>
                  {e.price ? (
                    <a className="underline" href={e.price.url} target="_blank" rel="noreferrer">
                      {rand(e.price.amountZar)} {e.price.vat === 'incl' ? 'incl VAT' : e.price.vat === 'excl' ? 'excl VAT' : '(VAT not stated)'}
                    </a>
                  ) : 'No hardware cost / not published'}
                  {e.price ? <span className="block text-[11px] text-muted-foreground">{e.price.supplier}, {e.price.seenOn}</span> : null}
                </dd>
                <dt className="text-muted-foreground">Gateway</dt><dd>{e.gateway.required ? 'Required' : 'Not needed'}{e.gateway.note ? ` — ${e.gateway.note}` : ''}</dd>
                <dt className="text-muted-foreground">Ongoing cost</dt><dd>{e.recurringCost}</dd>
                <dt className="text-muted-foreground">Billing-grade</dt><dd>{e.billingGrade ? 'Yes' : 'No — monitoring only'}</dd>
              </dl>
              {e.caveats.map((c) => <p key={c} className="text-[11px] text-muted-foreground">• {c}</p>)}
            </div>
            <div className="mt-2">
              <Button size="sm" variant={e.status === 'supplier_approval' || e.status === 'unsupported' ? 'secondary' : 'primary'} onClick={() => onPick(e)}>
                {e.status === 'supplier_approval' || e.status === 'unsupported' ? 'Request this integration' : 'I have this meter'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button variant="secondary" onClick={onRequest}>My meter isn't listed</Button>
      </div>
    </div>
  );
}

function IntegrationRequestForm({
  data,
  utilityType,
  entry,
  onBack,
  onDone,
}: {
  data: Overview;
  utilityType: 'water' | 'electricity';
  entry: CatalogueEntry | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    manufacturer: entry && entry.manufacturer !== 'Any' ? entry.manufacturer : '',
    model: entry?.model ?? '',
    connectionMethod: '',
    supplier: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const res = await api(`/api/v1/organizations/${data.property.org_id}/meter-integration-requests`, 'POST', {
      ...form,
      propertyId: data.property.id,
      utilityType,
    });
    if (!res.ok) return setError(errorMessage(res.data));
    setSent(true);
  }
  if (sent) {
    return (
      <div className="space-y-2 text-sm">
        <p>Request recorded. Meanwhile you can add the meter as a traditional meter and record readings with photos.</p>
        <Button onClick={onDone}>Close</Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-foreground">Request an integration</p>
      {entry ? <p className={noteClass}>{entry.caveats.join(' ') || STATUS_LABEL[entry.status]}</p> : null}
      {error ? <div className={errorClass}>{error}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {(['manufacturer', 'model', 'connectionMethod', 'supplier'] as const).map((k) => (
          <label key={k} className={labelClass}>
            {k === 'connectionMethod' ? 'How it connects (if known)' : k === 'supplier' ? 'Where you bought it' : k[0]!.toUpperCase() + k.slice(1)}
            <input className={inputClass} required={k === 'manufacturer' || k === 'model'} value={form[k]} maxLength={k === 'supplier' ? 200 : 100} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </label>
        ))}
        <label className={`${labelClass} sm:col-span-2`}>
          Notes
          <textarea className={inputClass} rows={3} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit">Send request</Button>
        <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
      </div>
    </form>
  );
}

function ConfigureMeter({
  data,
  entry,
  utilityType,
  meterRole,
  unitId,
  buildingId,
  parentMeterId,
  measurementKind,
  supplySourceId,
  onBack,
  onCreated,
}: {
  data: Overview;
  entry: CatalogueEntry;
  utilityType: 'water' | 'electricity';
  meterRole: 'main' | 'check' | 'submeter';
  unitId: string | null;
  buildingId: string | null;
  parentMeterId: string | null;
  measurementKind: string;
  supplySourceId: string | null;
  onBack: () => void;
  onCreated: (meterId: string) => void;
}) {
  const connected = entry.meterConnectivity !== 'manual';
  const [integrations, setIntegrations] = useState(data.integrations);
  const usable = integrations.filter((i) => i.status === 'active' && (entry.providers as string[]).includes(i.provider));
  const [form, setForm] = useState({
    meterNumber: '',
    serialNumber: '',
    location: '',
    installedDate: new Date().toISOString().slice(0, 10),
    ownership: meterRole === 'main' ? 'municipal' : 'private',
    integrationId: usable[0]?.id ?? '',
    externalDeviceId: '',
    externalChannel: entry.defaultChannel,
    multiplier: String(entry.defaultMultiplier),
    startReading: '',
    interval: String(INTERVALS_BY_CONNECTIVITY[connected ? 'lorawan' : 'manual'][1] ?? ''),
    tariff: '',
    registerDigits: '',
  });
  const [newConn, setNewConn] = useState<{ provider: ProviderId; name: string; baseUrl: string; apiKey: string } | null>(null);
  const [secret, setSecret] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = integrations.find((i) => i.id === form.integrationId);
  const provider = selected ? PROVIDERS[selected.provider as ProviderId] : entry.providers[0] ? PROVIDERS[entry.providers[0]] : null;
  const unitLabel = utilityType === 'water' ? 'kL' : 'kWh';

  async function createConnection() {
    if (!newConn) return;
    setError(null);
    const body: Record<string, unknown> = { provider: newConn.provider, name: newConn.name || `${entry.manufacturer} connection` };
    if (PROVIDERS[newConn.provider].mode === 'poll') {
      body.config = { baseUrl: newConn.baseUrl };
      body.credentials = { apiKey: newConn.apiKey };
    }
    const res = await api(`/api/v1/properties/${data.property.id}/meter-integrations`, 'POST', body);
    if (!res.ok) return setError(errorMessage(res.data));
    if (res.data.token) setSecret({ token: res.data.token, url: res.data.ingestUrl });
    setIntegrations((list) => [...list, { ...res.data.integration, last_seen_at: null }]);
    setForm({ ...form, integrationId: res.data.integration.id });
    setNewConn(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api(`/api/v1/properties/${data.property.id}/smart-meters`, 'POST', {
      utilityType,
      meterRole,
      ownership: form.ownership,
      unitId,
      buildingId,
      parentMeterId: meterRole === 'main' ? null : parentMeterId,
      measurementKind,
      supplySourceId,
      meterNumber: form.meterNumber || null,
      serialNumber: form.serialNumber || null,
      location: form.location || null,
      installedDate: form.installedDate || null,
      manufacturer: entry.manufacturer === 'Any' ? null : entry.manufacturer,
      model: entry.manufacturer === 'Any' ? null : entry.model,
      connectivity: entry.meterConnectivity,
      integrationId: connected ? form.integrationId || null : null,
      externalDeviceId: connected ? form.externalDeviceId.trim() || null : null,
      externalChannel: connected ? form.externalChannel : '',
      multiplier: Number(form.multiplier) || 1,
      valueOffset: form.startReading ? Number(form.startReading) * (utilityType === 'water' ? 1000 : 1) : 0,
      registerDigits: form.registerDigits ? Number(form.registerDigits) : null,
      expectedIntervalMinutes: form.interval ? Number(form.interval) : null,
      tariffPerUnit: form.tariff ? Number(form.tariff) : null,
      responsibilityMode: meterRole === 'submeter' ? 'tenant_paid_direct' : 'owner_paid',
    });
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res.data));
    onCreated(res.data.meterId);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm font-medium text-foreground">
        {entry.manufacturer === 'Any' ? entry.model : `${entry.manufacturer} ${entry.model}`}
      </p>
      {error ? <div className={errorClass}>{error}</div> : null}
      {secret ? (
        <div className="space-y-1 rounded-md border border-light-warning p-3 text-xs dark:border-dark-warning">
          <div className="font-medium text-foreground">Copy this now — it will not be shown again.</div>
          <div>Address: <code className="break-all">{secret.url}</code></div>
          <div>Header: <code className="break-all">Authorization: Bearer {secret.token}</code></div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Meter number (as on the meter / account)
          <input className={inputClass} value={form.meterNumber} maxLength={100} onChange={(e) => setForm({ ...form, meterNumber: e.target.value })} />
        </label>
        <label className={labelClass}>
          Serial number
          <input className={inputClass} value={form.serialNumber} maxLength={100} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
        </label>
        <label className={labelClass}>
          Location
          <input className={inputClass} value={form.location} maxLength={200} placeholder="e.g. Boundary box, left of gate" onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </label>
        <label className={labelClass}>
          Installation date
          <input className={inputClass} type="date" value={form.installedDate} onChange={(e) => setForm({ ...form, installedDate: e.target.value })} />
        </label>
        <label className={labelClass}>
          Who owns it
          <select className={inputClass} value={form.ownership} onChange={(e) => setForm({ ...form, ownership: e.target.value })}>
            <option value="municipal">Municipality (official meter)</option>
            <option value="private">Private (installed by the owner)</option>
          </select>
        </label>
        <label className={labelClass}>
          Tariff for estimates (R per {unitLabel}, optional)
          <input className={inputClass} type="number" step="any" min="0" value={form.tariff} onChange={(e) => setForm({ ...form, tariff: e.target.value })} />
        </label>
      </div>

      {connected ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              Connection
              <select className={inputClass} value={form.integrationId} required onChange={(e) => setForm({ ...form, integrationId: e.target.value })}>
                <option value="">{usable.length ? 'Choose…' : 'Create one →'}</option>
                {usable.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <button type="button" className="mt-1 text-[11px] underline" onClick={() => setNewConn({ provider: entry.providers[0]!, name: '', baseUrl: '', apiKey: '' })}>
                Create a new connection
              </button>
            </label>
            <label className={labelClass}>
              {provider?.deviceIdLabel ?? 'Device id'}
              <input className={inputClass} required value={form.externalDeviceId} maxLength={100} onChange={(e) => setForm({ ...form, externalDeviceId: e.target.value })} />
            </label>
            <label className={labelClass}>
              Channel / field
              {entry.channels.length ? (
                <select className={inputClass} value={form.externalChannel} onChange={(e) => setForm({ ...form, externalChannel: e.target.value })}>
                  {entry.channels.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              ) : (
                <input className={inputClass} value={form.externalChannel} maxLength={40} onChange={(e) => setForm({ ...form, externalChannel: e.target.value })} />
              )}
              <span className="mt-1 block text-[11px]">{provider?.channelHelp}</span>
            </label>
            <label className={labelClass}>
              Multiplier
              <input className={inputClass} type="number" step="any" min="0" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} />
              <span className="mt-1 block text-[11px]">{entry.multiplierNote}</span>
            </label>
            <label className={labelClass}>
              Dial reading when connected ({unitLabel})
              <input className={inputClass} type="number" step="any" min="0" value={form.startReading} onChange={(e) => setForm({ ...form, startReading: e.target.value })} />
            </label>
            <label className={labelClass}>
              Reading frequency
              <select className={inputClass} value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })}>
                {[15, 60, 1440].map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
              </select>
            </label>
          </div>
          {newConn ? (
            <div className="grid gap-3 rounded-md border border-light-border p-3 sm:grid-cols-3 dark:border-dark-border">
              <label className={labelClass}>
                Type
                <select className={inputClass} value={newConn.provider} onChange={(e) => setNewConn({ ...newConn, provider: e.target.value as ProviderId })}>
                  {entry.providers.map((p) => <option key={p} value={p}>{PROVIDERS[p].label}</option>)}
                </select>
              </label>
              <label className={labelClass}>
                Name
                <input className={inputClass} value={newConn.name} maxLength={100} onChange={(e) => setNewConn({ ...newConn, name: e.target.value })} />
              </label>
              {PROVIDERS[newConn.provider].mode === 'poll' ? (
                <>
                  <label className={labelClass}>
                    Server address
                    <input className={inputClass} placeholder="https://…" value={newConn.baseUrl} onChange={(e) => setNewConn({ ...newConn, baseUrl: e.target.value })} />
                  </label>
                  <label className={labelClass}>
                    API key (stored encrypted)
                    <input className={inputClass} type="password" autoComplete="off" value={newConn.apiKey} onChange={(e) => setNewConn({ ...newConn, apiKey: e.target.value })} />
                  </label>
                </>
              ) : null}
              <div className="flex items-end gap-2">
                <Button type="button" size="sm" onClick={createConnection}>Create</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setNewConn(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className={noteClass}>No hardware to connect. After saving, record readings with a photo from the meter list.</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save meter'}</Button>
        <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
      </div>
    </form>
  );
}

function ConnectAndTest({
  entry,
  meterId,
  utilityType,
  onDone,
}: {
  entry: CatalogueEntry;
  meterId: string;
  utilityType: 'water' | 'electricity';
  onDone: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [first, setFirst] = useState<{ reading: number; readAt: string; status: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const manual = entry.meterConnectivity === 'manual';
  const steps = useMemo(() => entry.setupSteps, [entry]);

  useEffect(() => {
    if (!testing || first) return;
    const timer = setInterval(async () => {
      setElapsed((s) => s + 5);
      const res = await api(`/api/v1/smart-meters/${meterId}/telemetry`, 'GET');
      const r = res.ok ? res.data.readings?.[0] : null;
      if (r) setFirst({ reading: r.reading, readAt: r.readAt, status: r.status });
    }, 5000);
    return () => clearInterval(timer);
  }, [testing, first, meterId]);

  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium text-foreground">Meter saved. {manual ? 'Next: record its first reading.' : 'Next: connect the hardware.'}</p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        {steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      {entry.docsUrl ? <a className="text-xs underline" href={entry.docsUrl} target="_blank" rel="noreferrer">Manufacturer documentation</a> : null}
      {!manual ? (
        <div className="space-y-2 rounded-md border border-light-border p-3 dark:border-dark-border">
          {first ? (
            <p>
              <Badge tone="good">Connected</Badge> First reading {fmtNumber(first.reading, 3)} {utilityType === 'water' ? 'kL' : 'kWh'} at {fmtDateTime(first.readAt)}
              {first.status !== 'valid' ? ` (marked ${first.status})` : ''}.
            </p>
          ) : testing ? (
            <p className="text-xs text-muted-foreground">
              Waiting for the device… {elapsed}s. Battery LoRaWAN devices only report at their interval; you can close this and check the meter list later.
            </p>
          ) : (
            <Button size="sm" onClick={() => setTesting(true)}>Test connection</Button>
          )}
        </div>
      ) : null}
      <Button onClick={onDone}>Done</Button>
    </div>
  );
}

