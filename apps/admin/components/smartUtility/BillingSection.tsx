'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { api, Badge, errorClass, errorMessage, fmtNumber, fmtRand, inputClass, labelClass, noteClass, type Overview } from './shared';

// Utility recharges (docs/SMART_UTILITIES_DECISIONS.md #8): tariffs → draft charges from actual
// consumption → landlord approval → DRAFT invoices. Nothing is issued or charged here.

interface Tariff {
  id: string;
  utility_type: 'water' | 'electricity';
  name: string;
  fixed_charge: number;
  blocks: { upTo: number | null; rate: number }[];
  vat_inclusive: boolean;
  effective_from: string;
  effective_to: string | null;
}

interface Charge {
  id: string;
  utility_type: 'water' | 'electricity';
  period_start: string;
  period_end: string;
  consumption: number | null;
  consumption_quality: string;
  fixed_amount: number;
  usage_amount: number;
  total_amount: number;
  status: 'draft' | 'approved' | 'invoiced' | 'void';
  lease_id: string | null;
  invoice_id: string | null;
  notes: string | null;
  units: { unit_label: string } | null;
}

const STATUS_TONE = { draft: 'warn', approved: 'neutral', invoiced: 'good', void: 'neutral' } as const;
const STATUS_LABEL = { draft: 'Draft estimate', approved: 'Approved', invoiced: 'On draft invoice', void: 'Void' } as const;

export function BillingSection({ data, canManage }: { data: Overview; canManage: boolean }) {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [period, setPeriod] = useState({ periodStart: data.period.lastComplete.start, periodEnd: nextDay(data.period.lastComplete.end) });
  const [tariffForm, setTariffForm] = useState({ utilityType: 'water' as 'water' | 'electricity', name: '', fixedCharge: '0', effectiveFrom: new Date().toISOString().slice(0, 10), blocks: [{ upTo: '', rate: '' }] });

  const load = useCallback(async () => {
    const [t, c] = await Promise.all([
      api(`/api/v1/properties/${data.property.id}/utility-tariffs`, 'GET'),
      api(`/api/v1/properties/${data.property.id}/utility-charges`, 'GET'),
    ]);
    if (t.ok) setTariffs(t.data.tariffs);
    if (c.ok) setCharges(c.data.charges);
  }, [data.property.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTariff(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const blocks = tariffForm.blocks.map((b, i) => ({
      upTo: i === tariffForm.blocks.length - 1 || b.upTo === '' ? null : Number(b.upTo),
      rate: Number(b.rate),
    }));
    const res = await api(`/api/v1/properties/${data.property.id}/utility-tariffs`, 'POST', {
      utilityType: tariffForm.utilityType,
      name: tariffForm.name,
      fixedCharge: Number(tariffForm.fixedCharge) || 0,
      blocks,
      effectiveFrom: tariffForm.effectiveFrom,
    });
    if (!res.ok) return setError(errorMessage(res.data));
    setInfo('Tariff saved.');
    void load();
  }

  async function run(body: unknown, done: string) {
    setError(null);
    setInfo(null);
    const res = await api(`/api/v1/properties/${data.property.id}/utility-charges`, 'POST', body);
    if (!res.ok) return setError(errorMessage(res.data));
    setInfo(done + (res.data.skipped?.length ? ` Skipped: ${res.data.skipped.map((s: { label: string; reason: string }) => `${s.label} — ${s.reason}`).join('; ')}` : ''));
    setSelected(new Set());
    void load();
  }

  const unit = (u: 'water' | 'electricity') => (u === 'water' ? 'kL' : 'kWh');
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <Panel title="Utility recharges" description="Tariffs, charges from metered use, and draft invoices for tenants">
      <div className={`${noteClass} mb-3 space-y-1`}>
        <p>Charges are <strong>estimates until you approve them</strong>, and approved charges only ever go onto <strong>draft</strong> invoices for you to review and issue.</p>
        <p>Electricity resale: NERSA's guidelines require the municipal tariff to be passed through unchanged and do not allow recovering meter-reading or billing costs from tenants; some by-laws require SABS-approved submeters. Check before recharging.</p>
      </div>
      {error ? <div className={`${errorClass} mb-3`} role="alert">{error}</div> : null}
      {info ? <p className="mb-3 text-xs text-muted-foreground" role="status">{info}</p> : null}

      <h3 className="mb-2 text-sm font-semibold text-foreground">Tariffs</h3>
      {tariffs.length === 0 ? <p className="mb-2 text-sm text-muted-foreground">No tariffs yet.</p> : (
        <ul className="mb-3 space-y-1 text-xs">
          {tariffs.map((t) => (
            <li key={t.id}>
              <span className="font-medium text-foreground">{t.name}</span> · {t.utility_type} · from {t.effective_from}{t.effective_to ? ` to ${t.effective_to}` : ' (current)'} · fixed {fmtRand(Number(t.fixed_charge))} ·{' '}
              {t.blocks.map((b, i) => `${b.upTo === null ? `above ${i ? t.blocks[i - 1]!.upTo : 0}` : `to ${b.upTo}`} ${unit(t.utility_type)} @ R${b.rate}`).join(', ')}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form onSubmit={addTariff} className="mb-5 space-y-2 rounded-md border border-light-border p-3 dark:border-dark-border">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={labelClass}>
              Utility
              <select className={inputClass} value={tariffForm.utilityType} onChange={(e) => setTariffForm({ ...tariffForm, utilityType: e.target.value as 'water' | 'electricity' })}>
                <option value="water">Water</option>
                <option value="electricity">Electricity</option>
              </select>
            </label>
            <label className={labelClass}>
              Name
              <input className={inputClass} required maxLength={100} placeholder="e.g. eThekwini 2026/27" value={tariffForm.name} onChange={(e) => setTariffForm({ ...tariffForm, name: e.target.value })} />
            </label>
            <label className={labelClass}>
              Fixed charge per period (R)
              <input className={inputClass} type="number" min="0" step="any" value={tariffForm.fixedCharge} onChange={(e) => setTariffForm({ ...tariffForm, fixedCharge: e.target.value })} />
            </label>
            <label className={labelClass}>
              Effective from
              <input className={inputClass} type="date" required value={tariffForm.effectiveFrom} onChange={(e) => setTariffForm({ ...tariffForm, effectiveFrom: e.target.value })} />
            </label>
          </div>
          {tariffForm.blocks.map((b, i) => (
            <div key={i} className="grid grid-cols-3 gap-2 text-xs">
              <label className={labelClass}>
                Block {i + 1}: up to ({unit(tariffForm.utilityType)}){i === tariffForm.blocks.length - 1 ? ' — last block has no limit' : ''}
                <input className={inputClass} type="number" min="0" step="any" disabled={i === tariffForm.blocks.length - 1} value={i === tariffForm.blocks.length - 1 ? '' : b.upTo} onChange={(e) => setTariffForm({ ...tariffForm, blocks: tariffForm.blocks.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)) })} />
              </label>
              <label className={labelClass}>
                Rate (R per {unit(tariffForm.utilityType)})
                <input className={inputClass} type="number" min="0" step="any" required value={b.rate} onChange={(e) => setTariffForm({ ...tariffForm, blocks: tariffForm.blocks.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} />
              </label>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={tariffForm.blocks.length >= 10} onClick={() => setTariffForm({ ...tariffForm, blocks: [...tariffForm.blocks, { upTo: '', rate: '' }] })}>Add block</Button>
            <Button type="submit" size="sm">Save tariff</Button>
          </div>
        </form>
      ) : null}

      <div className="mb-2 flex flex-wrap items-end gap-2">
        <h3 className="mr-auto text-sm font-semibold text-foreground">Charges</h3>
        {canManage ? (
          <>
            <label className={labelClass}>
              From
              <input className={inputClass} type="date" value={period.periodStart} onChange={(e) => setPeriod({ ...period, periodStart: e.target.value })} />
            </label>
            <label className={labelClass}>
              To (exclusive)
              <input className={inputClass} type="date" value={period.periodEnd} onChange={(e) => setPeriod({ ...period, periodEnd: e.target.value })} />
            </label>
            <Button size="sm" onClick={() => void run(period, 'Draft charges calculated.')}>Calculate charges</Button>
          </>
        ) : null}
      </div>
      {charges.length === 0 ? <p className="text-sm text-muted-foreground">No charges yet. Add a tariff, then calculate charges for a period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {canManage ? <th /> : null}
                <th className="py-1 pr-2 font-medium">Unit</th>
                <th className="py-1 pr-2 font-medium">Period</th>
                <th className="py-1 pr-2 font-medium">Use</th>
                <th className="py-1 pr-2 font-medium">Usage</th>
                <th className="py-1 pr-2 font-medium">Fixed</th>
                <th className="py-1 pr-2 font-medium">Total</th>
                <th className="py-1 pr-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id} className="border-t border-light-border align-top dark:border-dark-border">
                  {canManage ? (
                    <td className="py-1 pr-2">
                      {c.status === 'draft' || c.status === 'approved' ? (
                        <input type="checkbox" aria-label={`Select ${c.units?.unit_label ?? 'charge'}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                      ) : null}
                    </td>
                  ) : null}
                  <td className="py-1 pr-2">{c.units?.unit_label ?? '—'} · {c.utility_type}{!c.lease_id ? <div className="text-[11px] text-muted-foreground">no lease in period</div> : null}</td>
                  <td className="py-1 pr-2">{c.period_start} → {c.period_end}</td>
                  <td className="py-1 pr-2">
                    {c.consumption === null ? '—' : `${fmtNumber(Number(c.consumption), 3)} ${unit(c.utility_type)}`}
                    {c.consumption_quality !== 'complete' ? <div className="text-[11px] text-light-warning dark:text-dark-warning">{c.consumption_quality}</div> : null}
                    {c.notes ? <div className="text-[11px] text-muted-foreground">{c.notes}</div> : null}
                  </td>
                  <td className="py-1 pr-2">{fmtRand(Number(c.usage_amount))}</td>
                  <td className="py-1 pr-2">{fmtRand(Number(c.fixed_amount))}</td>
                  <td className="py-1 pr-2 font-medium">{fmtRand(Number(c.total_amount))}</td>
                  <td className="py-1 pr-2">
                    <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    {c.invoice_id ? <a className="ml-1 underline" href={`/accounting/invoices/${c.invoice_id}`}>invoice</a> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void run({ action: 'approve', chargeIds: [...selected] }, 'Approved.')}>Approve selected</Button>
          <Button size="sm" variant="secondary" onClick={() => void run({ action: 'invoice', chargeIds: [...selected] }, 'Draft invoice(s) created — review and issue them from Accounting → Invoices.')}>Add approved to draft invoices</Button>
          <Button size="sm" variant="secondary" onClick={() => void run({ action: 'void', chargeIds: [...selected] }, 'Voided.')}>Void selected</Button>
        </div>
      ) : null}
    </Panel>
  );
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
