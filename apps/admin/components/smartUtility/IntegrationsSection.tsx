'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { api, Badge, errorClass, errorMessage, fmtDateTime, inputClass, labelClass, noteClass, type Overview } from './shared';

// Hardware connections: one per gateway / Shelly fleet / Modbus gateway. The bearer token is shown
// once, right after create or rotate; only its hash is stored.

const PROVIDERS = [
  { value: 'milesight_lorawan', label: 'Milesight LoRaWAN gateway (UG63 / UG56 / UG65)' },
  { value: 'shelly_gen2', label: 'Shelly Gen2+ devices (Wi-Fi)' },
  { value: 'generic_json', label: 'Modbus gateway / other (JSON)' },
  { value: 'simulator', label: 'Simulator (testing only)' },
];

const SETUP_HINT: Record<string, string> = {
  milesight_lorawan:
    'Gateway web UI → Network Server → Applications → add an HTTP(S) data transport: Uplink data URL = the address below, header "Authorization: Bearer <token>". Add each EM300-DI with its DevEUI, then add the same DevEUI here as a meter.',
  shelly_gen2:
    'Add the Proplyst script to the device (see docs/SMART_UTILITY_ARCHITECTURE.md): it POSTs EMData/EM1Data/Input counters to the address below with the Bearer token. Use the device id (e.g. shellypro3em-xxxx) as the meter Device ID.',
  generic_json:
    'Configure the gateway to POST {"readings":[{"deviceId","channel","readAt","value"}]} to the address below with the Bearer token.',
  simulator: 'Run apps/admin/scripts/simulate-meter-feed.mjs with this token to send synthetic readings.',
};

interface IngestEvent {
  id: string;
  outcome: 'accepted' | 'partial' | 'rejected';
  accepted_count: number;
  duplicate_count: number;
  rejected_count: number;
  received_at: string;
  details?: { rejected?: { reason: string; deviceId?: string }[] };
}

export function IntegrationsSection({ data, canManage, onChanged }: { data: Overview; canManage: boolean; onChanged: () => void }) {
  const [provider, setProvider] = useState('milesight_lorawan');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<{ token: string; url: string; provider: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<{ id: string; rows: IngestEvent[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api(`/api/v1/properties/${data.property.id}/meter-integrations`, 'POST', { provider, name });
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res.data));
    setSecret({ token: res.data.token, url: res.data.ingestUrl, provider });
    setName('');
    onChanged();
  }

  async function action(id: string, providerName: string, act: 'rotate' | 'revoke') {
    if (act === 'revoke' && !window.confirm('Revoke this connection? Its devices will stop reporting immediately.')) return;
    const res = await api(`/api/v1/meter-integrations/${id}`, 'POST', { action: act });
    if (!res.ok) return setError(errorMessage(res.data));
    if (act === 'rotate') {
      setSecret({
        token: res.data.token,
        url: `${window.location.origin}/api/v1/integrations/meters/ingest`,
        provider: providerName,
        note: `The previous token keeps working until ${fmtDateTime(res.data.previousTokenValidUntil)}.`,
      });
    }
    onChanged();
  }

  async function showEvents(id: string) {
    const res = await api(`/api/v1/meter-integrations/${id}`, 'GET');
    setEvents({ id, rows: res.ok ? res.data.events : [] });
  }

  return (
    <Panel title="Hardware connections" description="Gateways and devices that send readings to Proplyst">
      {error ? <div className={`${errorClass} mb-3`}>{error}</div> : null}
      {secret ? (
        <div className="mb-4 space-y-2 rounded-md border border-light-warning p-3 text-xs dark:border-dark-warning">
          <div className="font-medium text-foreground">Copy this token now — it will not be shown again.</div>
          <div><span className="text-muted-foreground">Address: </span><code className="break-all">{secret.url}</code></div>
          <div><span className="text-muted-foreground">Header: </span><code className="break-all">Authorization: Bearer {secret.token}</code></div>
          <div className="text-muted-foreground">{SETUP_HINT[secret.provider]}</div>
          {secret.note ? <div className="text-muted-foreground">{secret.note}</div> : null}
          <Button size="sm" variant="secondary" onClick={() => setSecret(null)}>I have saved it</Button>
        </div>
      ) : null}

      {data.integrations.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">No hardware connected. Meters can still be read by hand.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {data.integrations.map((i) => (
            <li key={i.id} className="rounded-md border border-light-border p-3 text-sm dark:border-dark-border">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">{i.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {PROVIDERS.find((p) => p.value === i.provider)?.label} · last data {fmtDateTime(i.last_seen_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={i.status === 'active' ? (i.last_seen_at ? 'good' : 'neutral') : 'bad'}>
                    {i.status === 'active' ? (i.last_seen_at ? 'Receiving' : 'Waiting for data') : 'Revoked'}
                  </Badge>
                  <Button size="sm" variant="secondary" onClick={() => showEvents(i.id)}>Test / log</Button>
                  {canManage && i.status === 'active' ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => action(i.id, i.provider, 'rotate')}>Rotate token</Button>
                      <Button size="sm" variant="secondary" onClick={() => action(i.id, i.provider, 'revoke')}>Revoke</Button>
                    </>
                  ) : null}
                </div>
              </div>
              {events && events.id === i.id ? (
                <div className="mt-2 text-xs">
                  {events.rows.length === 0 ? (
                    <p className="text-muted-foreground">Nothing received yet. Check the gateway address and token, then send a test uplink.</p>
                  ) : (
                    <ul className="space-y-1">
                      {events.rows.map((ev) => (
                        <li key={ev.id} className="flex flex-wrap gap-2">
                          <span>{fmtDateTime(ev.received_at)}</span>
                          <Badge tone={ev.outcome === 'accepted' ? 'good' : ev.outcome === 'partial' ? 'warn' : 'bad'}>{ev.outcome}</Badge>
                          <span className="text-muted-foreground">
                            {ev.accepted_count} accepted · {ev.duplicate_count} duplicate · {ev.rejected_count} rejected
                            {ev.details?.rejected?.[0] ? ` (e.g. ${ev.details.rejected[0].reason}${ev.details.rejected[0].deviceId ? ` for ${ev.details.rejected[0].deviceId}` : ''})` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            Hardware type
            <select className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Name
            <input className={inputClass} value={name} required maxLength={100} placeholder="e.g. Block A gateway" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Connect hardware'}</Button>
          </div>
          <p className={`${noteClass} sm:col-span-3`}>Only organisation managers and principals can connect hardware. Each connection gets its own token; devices are only accepted if you have added them as meters.</p>
        </form>
      ) : null}
    </Panel>
  );
}
