'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { api, Badge, errorClass, errorMessage, fmtNumber, fmtRand, inputClass, labelClass, meterLabel, noteClass, type Overview } from './shared';

// Utility recharges v2 (docs/HYBRID_UTILITIES_ARCHITECTURE.md §D–E): tariffs → per-unit billing arrangements →
// draft charges → landlord approval → DRAFT invoices. Nothing is issued, sent or charged automatically.

type Utility = 'water' | 'electricity';
const UNIT: Record<Utility, string> = { water: 'kL', electricity: 'kWh' };

interface Tariff {
  id: string;
  utility_type: Utility;
  name: string;
  tariff_kind: string;
  fixed_charge: number;
  blocks: { upTo: number | null; rate: number }[];
  tou_periods: { name: string; rate: number }[];
  seasons: { name: string; months: number[] }[];
  vat_inclusive: boolean;
  vat_rate: number;
  unit_id: string | null;
  requires_review: boolean;
  review_reason: string | null;
  effective_from: string;
  effective_to: string | null;
  source_reference: string | null;
  units: { unit_label: string } | null;
}

interface Arrangement {
  id: string;
  unit_id: string;
  utility_type: Utility;
  arrangement: string;
  invoice_mode: string;
  allocation_group_id: string | null;
  fixed_amount: number | null;
  allowance_quantity: number | null;
  effective_from: string;
  effective_to: string | null;
  units: { unit_label: string } | null;
  utility_allocation_groups: { name: string } | null;
}

interface Group {
  id: string;
  name: string;
  method: string;
  landlord_share_pct: number;
  active: boolean;
  utility_meters: { utility_type: Utility } | null;
  utility_allocation_members: { unit_id: string; percentage: number | null; occupants: number | null; units: { unit_label: string } | null }[];
}

interface Charge {
  id: string;
  utility_type: Utility;
  charge_type: string;
  period_start: string;
  period_end: string;
  segment_start: string | null;
  segment_end: string | null;
  consumption: number | null;
  consumption_quality: string;
  amount_excl_vat: number | null;
  vat_amount: number | null;
  total_amount: number;
  adjustment_total: number;
  credit_applied: number;
  review_flags: string[];
  dispute_status: 'none' | 'open' | 'resolved';
  dispute_reason: string | null;
  status: 'draft' | 'approved' | 'invoiced' | 'void';
  lease_id: string | null;
  invoice_id: string | null;
  notes: string | null;
  calculation: { lines?: { label: string; inclCents: number }[]; notes?: string[]; method?: string } | null;
  units: { unit_label: string } | null;
}

const ARRANGEMENT_LABEL: Record<string, string> = {
  metered_recharge: 'Metered recharge (own meter × tariff)',
  shared_allocation: 'Shared meter split',
  fixed_allowance: 'Fixed amount (optional allowance)',
  landlord_paid: 'Landlord pays',
  included_in_rent: 'Included in rent',
  tenant_direct: 'Tenant pays supplier directly (e.g. own prepaid)',
};
const KIND_LABEL: Record<string, string> = {
  block: 'Inclining block',
  flat: 'Flat rate',
  tou: 'Time-of-use',
  fixed_only: 'Fixed charge only',
  cost_recovery: 'Landlord cost recovery',
  prepaid_passthrough: 'Prepaid pass-through (no recharge)',
};
const FLAG_LABEL: Record<string, string> = {
  electricity_resale_nersa_review: 'Electricity resale: check NERSA rules',
  water_services_intermediary_review: 'Water resale: check municipal by-law',
  tariff_marked_for_review: 'Tariff needs review',
  shared_meter_allocation_requires_lease_clause: 'Shared split must be in the lease',
  cost_recovery_requires_contract_and_regulatory_review: 'Cost-recovery rate: contract & regulatory review',
  estimated_consumption_true_up_pending: 'Estimated: trued up when readings arrive',
  true_up_of_estimate: 'True-up of an earlier estimate',
  vat_ledger_split_pending: 'VAT posts to rent income: split it manually for your VAT return',
};
const STATUS_TONE = { draft: 'warn', approved: 'neutral', invoiced: 'good', void: 'neutral' } as const;
const STATUS_LABEL = { draft: 'Draft estimate', approved: 'Approved', invoiced: 'On draft invoice', void: 'Void' } as const;

export function BillingSection({ data, canManage }: { data: Overview; canManage: boolean }) {
  const pid = data.property.id;
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [open, setOpen] = useState<'tariff' | 'import' | 'arrangement' | 'group' | null>(null);
  const [period, setPeriod] = useState({ periodStart: data.period.lastComplete.start, periodEnd: nextDay(data.period.lastComplete.end) });
  const [estimateMissing, setEstimateMissing] = useState(false);

  const load = useCallback(async () => {
    const [t, a, g, c] = await Promise.all([
      api(`/api/v1/properties/${pid}/utility-tariffs`, 'GET'),
      api(`/api/v1/properties/${pid}/utility-arrangements`, 'GET'),
      api(`/api/v1/properties/${pid}/utility-allocation-groups`, 'GET'),
      api(`/api/v1/properties/${pid}/utility-charges`, 'GET'),
    ]);
    if (t.ok) setTariffs(t.data.tariffs);
    if (a.ok) setArrangements(a.data.arrangements);
    if (g.ok) setGroups(g.data.groups);
    if (c.ok) setCharges(c.data.charges);
  }, [pid]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, method: 'POST' | 'PATCH', body: unknown, done: string) {
    setError(null);
    setInfo(null);
    const res = await api(url, method, body);
    if (!res.ok) {
      setError(errorMessage(res.data));
      return false;
    }
    const skipped = res.data?.skipped as { label: string; reason: string }[] | undefined;
    setInfo(done + (Array.isArray(skipped) && skipped.length ? ` Not charged: ${skipped.map((s) => `${s.label} — ${s.reason}`).join('; ')}` : ''));
    setSelected(new Set());
    void load();
    return true;
  }
  const chargesUrl = `/api/v1/properties/${pid}/utility-charges`;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const current = arrangements.filter((a) => !a.effective_to);

  return (
    <Panel title="Utility recharges" description="Tariffs, who pays what, charges from metered use, and draft invoices for tenants">
      <div className={`${noteClass} mb-3 space-y-1`}>
        <p>
          Nothing is charged unless the unit has a <strong>billing arrangement</strong>. Charges are <strong>estimates until you approve them</strong>, and approved
          charges only go onto <strong>draft</strong> invoices for you to review and issue.
        </p>
        <p>
          Electricity resale: NERSA expects the municipal tariff to be passed through without profit, and some by-laws require approved submeters. Water resale and
          shared-meter splits must be allowed by the lease. Each charge carries review flags; they are reminders, not legal advice.
        </p>
      </div>
      {error ? <div className={`${errorClass} mb-3`} role="alert">{error}</div> : null}
      {info ? <p className="mb-3 text-xs text-muted-foreground" role="status">{info}</p> : null}

      {/* ---------------- Tariffs */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-foreground">Tariffs</h3>
        {canManage ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setOpen(open === 'tariff' ? null : 'tariff')}>{open === 'tariff' ? 'Close' : 'Add tariff'}</Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(open === 'import' ? null : 'import')}>{open === 'import' ? 'Close' : 'Import CSV'}</Button>
          </>
        ) : null}
      </div>
      {tariffs.length === 0 ? <p className="mb-2 text-sm text-muted-foreground">No tariffs yet. Enter the rates from your municipality’s or supplier’s tariff schedule.</p> : (
        <ul className="mb-3 space-y-1 text-xs">
          {tariffs.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-1">
              <span className="font-medium text-foreground">{t.name}</span>
              <span>· {t.utility_type} · {KIND_LABEL[t.tariff_kind] ?? t.tariff_kind}{t.units ? ` · ${t.units.unit_label} only` : ''}</span>
              <span>· {t.effective_from}{t.effective_to ? ` → ${t.effective_to}` : ' (current)'}</span>
              <span>· fixed {fmtRand(Number(t.fixed_charge))} · VAT {t.vat_inclusive ? 'incl.' : 'excl.'} {Number(t.vat_rate)}%</span>
              {t.blocks.length ? <span>· {t.blocks.map((b, i) => `${b.upTo === null ? `>${i ? t.blocks[i - 1]!.upTo : 0}` : `≤${b.upTo}`} @ R${b.rate}`).join(', ')}</span> : null}
              {t.tou_periods.length ? <span>· {t.tou_periods.map((p) => `${p.name} R${p.rate}`).join(', ')}</span> : null}
              {t.seasons.length ? <span>· seasons: {t.seasons.map((s) => s.name).join(', ')}</span> : null}
              {t.requires_review ? <Badge tone="warn">needs review</Badge> : null}
              {canManage && t.requires_review ? (
                <button className="underline" onClick={() => void post(`/api/v1/properties/${pid}/utility-tariffs`, 'PATCH', { tariffId: t.id, action: 'mark_reviewed' }, 'Tariff marked reviewed.')}>mark reviewed</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && open === 'tariff' ? <TariffForm data={data} onSaved={() => { setOpen(null); void load(); setInfo('Tariff saved.'); }} /> : null}
      {canManage && open === 'import' ? <TariffImport propertyId={pid} onDone={() => { void load(); }} /> : null}

      {/* ---------------- Arrangements */}
      <div className="mb-2 mt-5 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-foreground">Who pays what</h3>
        {canManage ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setOpen(open === 'arrangement' ? null : 'arrangement')}>{open === 'arrangement' ? 'Close' : 'Set arrangement'}</Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(open === 'group' ? null : 'group')}>{open === 'group' ? 'Close' : 'Shared meter'}</Button>
          </>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="mb-2 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">Unit</th>
              <th className="py-1 pr-2 font-medium">Water</th>
              <th className="py-1 pr-2 font-medium">Electricity</th>
            </tr>
          </thead>
          <tbody>
            {data.units.map((u) => (
              <tr key={u.id} className="border-t border-light-border dark:border-dark-border">
                <td className="py-1 pr-2">{u.unit_label}</td>
                {(['water', 'electricity'] as const).map((ut) => {
                  const a = current.find((x) => x.unit_id === u.id && x.utility_type === ut);
                  return (
                    <td key={ut} className="py-1 pr-2">
                      {a ? (
                        <>
                          {ARRANGEMENT_LABEL[a.arrangement]?.split(' (')[0] ?? a.arrangement}
                          {a.utility_allocation_groups ? ` · ${a.utility_allocation_groups.name}` : ''}
                          {a.fixed_amount !== null ? ` · ${fmtRand(Number(a.fixed_amount))}/month` : ''}
                          {a.allowance_quantity !== null ? ` · ${fmtNumber(Number(a.allowance_quantity))} ${UNIT[ut]} included` : ''}
                          <span className="text-muted-foreground"> · from {a.effective_from}{a.invoice_mode === 'with_draft_invoice' ? ' · with rent draft' : ''}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">not set — never charged</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {groups.length ? (
        <ul className="mb-2 space-y-1 text-xs">
          {groups.filter((g) => g.active).map((g) => (
            <li key={g.id}>
              <span className="font-medium text-foreground">{g.name}</span> · {g.utility_meters?.utility_type} · split by {g.method.replace('_', ' ')} · landlord keeps {Number(g.landlord_share_pct)}% ·{' '}
              {g.utility_allocation_members.map((m) => `${m.units?.unit_label ?? 'unit'}${m.percentage !== null ? ` ${Number(m.percentage)}%` : ''}${m.occupants !== null ? ` (${m.occupants} people)` : ''}`).join(', ')}
            </li>
          ))}
        </ul>
      ) : null}
      {canManage && open === 'arrangement' ? (
        <ArrangementForm data={data} groups={groups.filter((g) => g.active)} onSubmit={async (body) => { if (await post(`/api/v1/properties/${pid}/utility-arrangements`, 'POST', body, 'Arrangement saved.')) setOpen(null); }} />
      ) : null}
      {canManage && open === 'group' ? (
        <GroupForm data={data} onSubmit={async (body) => { if (await post(`/api/v1/properties/${pid}/utility-allocation-groups`, 'POST', body, 'Shared meter group saved. Now set each member unit to “Shared meter split”.')) setOpen(null); }} />
      ) : null}

      {/* ---------------- Charges */}
      <div className="mb-2 mt-5 flex flex-wrap items-end gap-2">
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
            <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Units without usable readings are estimated from their recent actual use, flagged, and trued up once readings arrive.">
              <input type="checkbox" checked={estimateMissing} onChange={(e) => setEstimateMissing(e.target.checked)} /> Estimate where readings are missing
            </label>
            <Button size="sm" onClick={() => void post(chargesUrl, 'POST', { ...period, estimateMissing }, 'Draft charges calculated.')}>Calculate charges</Button>
          </>
        ) : null}
      </div>
      {charges.length === 0 ? <p className="text-sm text-muted-foreground">No charges yet. Add a tariff and set each unit’s arrangement, then calculate charges for a period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {canManage ? <th /> : null}
                <th className="py-1 pr-2 font-medium">Unit</th>
                <th className="py-1 pr-2 font-medium">Covers</th>
                <th className="py-1 pr-2 font-medium">Use</th>
                <th className="py-1 pr-2 font-medium">Excl. VAT</th>
                <th className="py-1 pr-2 font-medium">VAT</th>
                <th className="py-1 pr-2 font-medium">Total</th>
                <th className="py-1 pr-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <ChargeRow key={c.id} c={c} canManage={canManage} selected={selected.has(c.id)} onToggle={() => toggle(c.id)} onAction={(body, done) => void post(chargesUrl, 'POST', body, done)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void post(chargesUrl, 'POST', { action: 'approve', chargeIds: [...selected] }, 'Approved.')}>Approve selected</Button>
          <Button size="sm" variant="secondary" onClick={() => void post(chargesUrl, 'POST', { action: 'invoice', chargeIds: [...selected] }, 'Added to draft invoice(s) — review and issue them from Accounting → Invoices.')}>Add approved to draft invoices</Button>
          <Button size="sm" variant="secondary" onClick={() => void post(chargesUrl, 'POST', { action: 'void', chargeIds: [...selected] }, 'Voided.')}>Void selected</Button>
        </div>
      ) : null}
    </Panel>
  );
}

function ChargeRow({ c, canManage, selected, onToggle, onAction }: { c: Charge; canManage: boolean; selected: boolean; onToggle: () => void; onAction: (body: unknown, done: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'adjust' | 'dispute' | 'resolve' | 'credit' | null>(null);
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const kind = c.charge_type === 'allocation' ? 'shared split' : c.charge_type === 'allowance_fee' ? 'fixed amount' : c.charge_type === 'excess' ? 'above allowance' : 'metered';
  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'adjust') onAction({ action: 'adjust', chargeId: c.id, amount: Number(amount), reason: text }, 'Adjustment recorded.');
    if (mode === 'credit') onAction({ action: 'credit', chargeId: c.id, amount: Number(amount), reason: text }, 'Credit recorded — it reduces this lease’s next utility charge.');
    if (mode === 'dispute') onAction({ op: 'dispute', action: 'open', chargeId: c.id, text }, 'Marked as disputed. It cannot be approved or invoiced until resolved.');
    if (mode === 'resolve') onAction({ op: 'dispute', action: 'resolve', chargeId: c.id, text }, 'Dispute resolved.');
    setMode(null);
  }
  return (
    <>
      <tr className="border-t border-light-border align-top dark:border-dark-border">
        {canManage ? (
          <td className="py-1 pr-2">
            {c.status === 'draft' || c.status === 'approved' ? <input type="checkbox" aria-label={`Select ${c.units?.unit_label ?? 'charge'}`} checked={selected} onChange={onToggle} /> : null}
          </td>
        ) : null}
        <td className="py-1 pr-2">
          {c.units?.unit_label ?? '—'} · {c.utility_type} · {kind}
          {!c.lease_id ? <div className="text-[11px] text-muted-foreground">no lease in period</div> : null}
        </td>
        <td className="py-1 pr-2">{c.segment_start ?? c.period_start} → {c.segment_end ?? c.period_end}</td>
        <td className="py-1 pr-2">
          {c.consumption === null ? '—' : `${fmtNumber(Number(c.consumption), 3)} ${UNIT[c.utility_type]}`}
          {c.consumption_quality !== 'complete' ? <div className="text-[11px] text-light-warning dark:text-dark-warning">{c.consumption_quality} — estimated</div> : null}
          {c.notes ? <div className="text-[11px] text-muted-foreground">{c.notes}</div> : null}
        </td>
        <td className="py-1 pr-2">{fmtRand(c.amount_excl_vat === null ? null : Number(c.amount_excl_vat))}</td>
        <td className="py-1 pr-2">{fmtRand(c.vat_amount === null ? null : Number(c.vat_amount))}</td>
        <td className="py-1 pr-2 font-medium">
          {fmtRand(Number(c.total_amount))}
          {Number(c.adjustment_total) ? <div className="text-[11px] text-muted-foreground">adj. {fmtRand(Number(c.adjustment_total))}</div> : null}
          {Number(c.credit_applied) ? <div className="text-[11px] text-muted-foreground">credit −{fmtRand(Number(c.credit_applied))}</div> : null}
        </td>
        <td className="py-1 pr-2">
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
            {c.dispute_status === 'open' ? <Badge tone="bad">disputed</Badge> : null}
            {c.invoice_id ? <a className="underline" href={`/accounting/invoices/${c.invoice_id}`}>invoice</a> : null}
            <button className="underline" onClick={() => setExpanded((v) => !v)}>{expanded ? 'hide' : 'details'}</button>
          </div>
          {canManage && c.status !== 'void' ? (
            <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
              {c.status === 'draft' ? <button className="underline" onClick={() => setMode('adjust')}>adjust</button> : null}
              {c.dispute_status !== 'open' ? <button className="underline" onClick={() => setMode('dispute')}>dispute</button> : <button className="underline" onClick={() => setMode('resolve')}>resolve</button>}
              {c.status === 'invoiced' ? <button className="underline" onClick={() => setMode('credit')}>credit</button> : null}
            </div>
          ) : null}
        </td>
      </tr>
      {expanded || mode ? (
        <tr>
          <td colSpan={canManage ? 8 : 7} className="pb-2 text-[11px] text-muted-foreground">
            {expanded ? (
              <div className="space-y-0.5">
                {(c.calculation?.lines ?? []).map((l, i) => <div key={i}>{l.label}: {fmtRand(l.inclCents / 100)}</div>)}
                {(c.calculation?.notes ?? []).map((n, i) => <div key={`n${i}`}>{n}</div>)}
                {c.review_flags.length ? <div>Review: {c.review_flags.map((f) => FLAG_LABEL[f] ?? f).join(' · ')}</div> : null}
                {c.dispute_reason ? <div>Dispute: {c.dispute_reason}</div> : null}
              </div>
            ) : null}
            {mode ? (
              <form onSubmit={submit} className="mt-1 flex flex-wrap items-end gap-2">
                {mode === 'adjust' || mode === 'credit' ? (
                  <label className={labelClass}>
                    {mode === 'adjust' ? 'Amount (R, negative reduces)' : 'Credit (R)'}
                    <input className={inputClass} type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </label>
                ) : null}
                <label className={`${labelClass} min-w-[16rem] flex-1`}>
                  {mode === 'resolve' ? 'Resolution' : 'Reason'}
                  <input className={inputClass} required minLength={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
                </label>
                <Button type="submit" size="sm">Save</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
              </form>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TariffForm({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const [form, setForm] = useState({
    utilityType: 'water' as Utility,
    name: '',
    tariffKind: 'block',
    fixedCharge: '0',
    vatInclusive: true,
    vatRate: '15',
    unitId: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    sourceReference: '',
    blocks: [{ upTo: '', rate: '' }],
    advanced: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewQty, setPreviewQty] = useState('');
  const needsBlocks = ['block', 'flat', 'cost_recovery'].includes(form.tariffKind);

  function body() {
    let advanced: { touPeriods?: unknown; seasons?: unknown } = {};
    if (form.advanced.trim()) advanced = JSON.parse(form.advanced);
    const blocks = needsBlocks
      ? (form.tariffKind === 'flat' ? form.blocks.slice(0, 1) : form.blocks).map((b, i, all) => ({ upTo: i === all.length - 1 || b.upTo === '' ? null : Number(b.upTo), rate: Number(b.rate) }))
      : [];
    return {
      utilityType: form.utilityType,
      name: form.name,
      tariffKind: form.tariffKind,
      fixedCharge: Number(form.fixedCharge) || 0,
      vatInclusive: form.vatInclusive,
      vatRate: Number(form.vatRate),
      unitId: form.unitId || null,
      effectiveFrom: form.effectiveFrom,
      sourceReference: form.sourceReference || null,
      blocks,
      touPeriods: advanced.touPeriods ?? [],
      seasons: advanced.seasons ?? [],
    };
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let b;
    try {
      b = body();
    } catch {
      return setError('Time-of-use / seasons must be valid JSON.');
    }
    const res = await api(`/api/v1/properties/${data.property.id}/utility-tariffs`, 'POST', b);
    if (!res.ok) return setError(errorMessage(res.data));
    onSaved();
  }
  async function runPreview() {
    setError(null);
    let b;
    try {
      b = body();
    } catch {
      return setError('Time-of-use / seasons must be valid JSON.');
    }
    const start = `${form.effectiveFrom.slice(0, 7)}-01`;
    const d = new Date(`${start}T00:00:00Z`);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    const res = await api(`/api/v1/properties/${data.property.id}/utility-tariffs/preview`, 'POST', { tariff: b, consumption: Number(previewQty), periodStart: start, periodEnd: end });
    if (!res.ok) return setError(errorMessage(res.data));
    const r = res.data.result as { ok: boolean; refusal?: string; lines: { label: string; inclCents: number }[]; totals: { exclCents: number; vatCents: number; inclCents: number } };
    setPreview(r.ok ? `${r.lines.map((l) => `${l.label}: ${fmtRand(l.inclCents / 100)}`).join(' · ')} → total ${fmtRand(r.totals.inclCents / 100)} (excl. ${fmtRand(r.totals.exclCents / 100)}, VAT ${fmtRand(r.totals.vatCents / 100)})` : r.refusal ?? 'Cannot calculate.');
  }

  return (
    <form onSubmit={save} className="mb-4 space-y-2 rounded-md border border-light-border p-3 dark:border-dark-border">
      {error ? <div className={errorClass} role="alert">{error}</div> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={labelClass}>
          Utility
          <select className={inputClass} value={form.utilityType} onChange={(e) => setForm({ ...form, utilityType: e.target.value as Utility })}>
            <option value="water">Water</option>
            <option value="electricity">Electricity</option>
          </select>
        </label>
        <label className={labelClass}>
          Type
          <select className={inputClass} value={form.tariffKind} onChange={(e) => setForm({ ...form, tariffKind: e.target.value })}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Name
          <input className={inputClass} required maxLength={100} placeholder="e.g. City of Tshwane 2026/27 domestic" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className={labelClass}>
          Applies to
          <select className={inputClass} value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
            <option value="">Whole property</option>
            {data.units.map((u) => <option key={u.id} value={u.id}>{u.unit_label} only</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Fixed charge per month (R)
          <input className={inputClass} type="number" min="0" step="any" value={form.fixedCharge} onChange={(e) => setForm({ ...form, fixedCharge: e.target.value })} />
        </label>
        <label className={labelClass}>
          VAT
          <div className="flex gap-1">
            <select className={inputClass} value={form.vatInclusive ? 'incl' : 'excl'} onChange={(e) => setForm({ ...form, vatInclusive: e.target.value === 'incl' })}>
              <option value="incl">Rates include VAT</option>
              <option value="excl">Rates exclude VAT</option>
            </select>
            <input className={inputClass} type="number" min="0" max="100" step="any" aria-label="VAT rate %" value={form.vatRate} onChange={(e) => setForm({ ...form, vatRate: e.target.value })} />
          </div>
        </label>
        <label className={labelClass}>
          Effective from
          <input className={inputClass} type="date" required value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
        </label>
        <label className={labelClass}>
          Source (tariff book, page)
          <input className={inputClass} maxLength={300} value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} />
        </label>
      </div>
      {needsBlocks
        ? (form.tariffKind === 'flat' ? form.blocks.slice(0, 1) : form.blocks).map((b, i, all) => (
            <div key={i} className="grid grid-cols-3 gap-2 text-xs">
              <label className={labelClass}>
                {form.tariffKind === 'flat' ? 'Rate applies to all use' : `Block ${i + 1}: up to (${UNIT[form.utilityType]})${i === all.length - 1 ? ' — last block has no limit' : ''}`}
                <input className={inputClass} type="number" min="0" step="any" disabled={i === all.length - 1} value={i === all.length - 1 ? '' : b.upTo} onChange={(e) => setForm({ ...form, blocks: form.blocks.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)) })} />
              </label>
              <label className={labelClass}>
                Rate (R per {UNIT[form.utilityType]})
                <input className={inputClass} type="number" min="0" step="any" required value={b.rate} onChange={(e) => setForm({ ...form, blocks: form.blocks.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} />
              </label>
            </div>
          ))
        : null}
      {form.tariffKind === 'block' || form.tariffKind === 'cost_recovery' ? (
        <Button type="button" size="sm" variant="secondary" disabled={form.blocks.length >= 10} onClick={() => setForm({ ...form, blocks: [...form.blocks, { upTo: '', rate: '' }] })}>Add block</Button>
      ) : null}
      {form.tariffKind === 'tou' || form.tariffKind === 'block' ? (
        <label className={labelClass}>
          {form.tariffKind === 'tou' ? 'Time-of-use periods and seasons (JSON)' : 'Seasonal blocks (optional JSON)'}
          <textarea
            className={`${inputClass} font-mono text-[11px]`}
            rows={4}
            placeholder={form.tariffKind === 'tou'
              ? '{"touPeriods":[{"name":"Peak","rate":5.2,"windows":[{"days":"weekday","from":"07:00","to":"10:00"},{"days":"weekday","from":"18:00","to":"20:00"}]},{"name":"Off-peak","rate":1.9,"windows":[...]}]}'
              : '{"seasons":[{"name":"High demand","months":[6,7,8],"blocks":[{"upTo":null,"rate":4.1}]}]}'}
            value={form.advanced}
            onChange={(e) => setForm({ ...form, advanced: e.target.value })}
          />
        </label>
      ) : null}
      {form.tariffKind === 'cost_recovery' ? <p className={noteClass}>Cost-recovery tariffs are marked for review: confirm the lease clause and the regulatory position before charging.</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelClass}>
          Preview for use of ({UNIT[form.utilityType]})
          <input className={inputClass} type="number" min="0" step="any" value={previewQty} onChange={(e) => setPreviewQty(e.target.value)} />
        </label>
        <Button type="button" size="sm" variant="secondary" disabled={previewQty === '' || form.tariffKind === 'tou'} onClick={() => void runPreview()}>Preview</Button>
        <Button type="submit" size="sm">Save tariff</Button>
      </div>
      {preview ? <p className="text-xs text-muted-foreground" role="status">{preview}</p> : null}
    </form>
  );
}

function TariffImport({ propertyId, onDone }: { propertyId: string; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<{ valid: number; invalid: number; rows: { line: number; ok: boolean; errors: string[]; name: string | null }[]; dryRun: boolean; created?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(dryRun: boolean) {
    setError(null);
    const res = await api(`/api/v1/properties/${propertyId}/utility-tariffs/import`, 'POST', { csv, dryRun });
    if (!res.ok && !res.data?.rows) return setError(errorMessage(res.data));
    setResult(res.data);
    if (!dryRun && res.ok) onDone();
  }
  return (
    <div className="mb-4 space-y-2 rounded-md border border-light-border p-3 dark:border-dark-border">
      <p className="text-xs text-muted-foreground">
        One tariff per row. Columns: utility_type, name, tariff_kind, effective_from, fixed_charge, blocks, vat_inclusive, vat_rate, unit_label, municipality_code, customer_class,
        source_reference. Blocks look like <code>6:25.10;15:32.50;*:45.00</code>. Time-of-use tariffs are entered in the form.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        className="text-xs"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setCsv(await f.text());
        }}
      />
      <textarea className={`${inputClass} font-mono text-[11px]`} rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="utility_type,name,tariff_kind,effective_from,fixed_charge,blocks,vat_inclusive,vat_rate" />
      {error ? <div className={errorClass} role="alert">{error}</div> : null}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={!csv.trim()} onClick={() => void run(true)}>Check</Button>
        <Button size="sm" disabled={!result || !result.dryRun || result.invalid > 0} onClick={() => void run(false)}>Import {result?.valid ?? ''}</Button>
      </div>
      {result ? (
        <ul className="text-xs">
          {result.created !== undefined ? <li>{result.created} tariff(s) imported.</li> : null}
          {result.rows.map((r) => (
            <li key={r.line} className={r.ok ? 'text-muted-foreground' : 'text-light-danger dark:text-dark-danger'}>
              Line {r.line}: {r.ok ? `OK — ${r.name}` : r.errors.join('; ')}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ArrangementForm({ data, groups, onSubmit }: { data: Overview; groups: Group[]; onSubmit: (body: unknown) => Promise<void> }) {
  const [form, setForm] = useState({ unitId: data.units[0]?.id ?? '', utilityType: 'electricity' as Utility, arrangement: 'metered_recharge', invoiceMode: 'separate_invoice', allocationGroupId: '', fixedAmount: '', allowanceQuantity: '', effectiveFrom: `${new Date().toISOString().slice(0, 7)}-01`, contractReference: '' });
  const groupOptions = groups.filter((g) => g.utility_meters?.utility_type === form.utilityType && g.utility_allocation_members.some((m) => m.unit_id === form.unitId));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          unitId: form.unitId,
          utilityType: form.utilityType,
          arrangement: form.arrangement,
          invoiceMode: form.invoiceMode,
          allocationGroupId: form.arrangement === 'shared_allocation' ? form.allocationGroupId || null : null,
          fixedAmount: form.arrangement === 'fixed_allowance' ? Number(form.fixedAmount) : null,
          allowanceQuantity: form.arrangement === 'fixed_allowance' && form.allowanceQuantity !== '' ? Number(form.allowanceQuantity) : null,
          effectiveFrom: form.effectiveFrom,
          contractReference: form.contractReference || null,
        });
      }}
      className="mb-4 space-y-2 rounded-md border border-light-border p-3 dark:border-dark-border"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={labelClass}>
          Unit
          <select className={inputClass} value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
            {data.units.map((u) => <option key={u.id} value={u.id}>{u.unit_label}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Utility
          <select className={inputClass} value={form.utilityType} onChange={(e) => setForm({ ...form, utilityType: e.target.value as Utility })}>
            <option value="electricity">Electricity</option>
            <option value="water">Water</option>
          </select>
        </label>
        <label className={labelClass}>
          Arrangement
          <select className={inputClass} value={form.arrangement} onChange={(e) => setForm({ ...form, arrangement: e.target.value })}>
            {Object.entries(ARRANGEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          From
          <input className={inputClass} type="date" required value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
        </label>
        {['metered_recharge', 'shared_allocation', 'fixed_allowance'].includes(form.arrangement) ? (
          <label className={labelClass}>
            Invoice
            <select className={inputClass} value={form.invoiceMode} onChange={(e) => setForm({ ...form, invoiceMode: e.target.value })}>
              <option value="separate_invoice">Separate draft invoice</option>
              <option value="with_draft_invoice">Add to this month’s draft invoice if there is one</option>
            </select>
          </label>
        ) : null}
        {form.arrangement === 'shared_allocation' ? (
          <label className={labelClass}>
            Shared meter group
            <select className={inputClass} required value={form.allocationGroupId} onChange={(e) => setForm({ ...form, allocationGroupId: e.target.value })}>
              <option value="">{groupOptions.length ? 'Choose' : 'Create a shared meter group first'}</option>
              {groupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        ) : null}
        {form.arrangement === 'fixed_allowance' ? (
          <>
            <label className={labelClass}>
              Fixed amount per month (R)
              <input className={inputClass} type="number" min="0" step="0.01" required value={form.fixedAmount} onChange={(e) => setForm({ ...form, fixedAmount: e.target.value })} />
            </label>
            <label className={labelClass}>
              Included use ({UNIT[form.utilityType]}, optional)
              <input className={inputClass} type="number" min="0" step="any" value={form.allowanceQuantity} onChange={(e) => setForm({ ...form, allowanceQuantity: e.target.value })} />
            </label>
          </>
        ) : null}
        <label className={labelClass}>
          Lease clause / reference
          <input className={inputClass} maxLength={200} value={form.contractReference} onChange={(e) => setForm({ ...form, contractReference: e.target.value })} />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">The previous arrangement ends the day before. Charges already calculated keep the arrangement that applied to them.</p>
      <Button type="submit" size="sm">Save arrangement</Button>
    </form>
  );
}

function GroupForm({ data, onSubmit }: { data: Overview; onSubmit: (body: unknown) => Promise<void> }) {
  const meters = data.meters.filter((m) => m.active && m.measurementKind === 'consumption' && m.meterRole !== 'submeter');
  const [form, setForm] = useState({ meterId: meters[0]?.id ?? '', name: '', method: 'equal', landlordSharePct: '0' });
  const [members, setMembers] = useState<Record<string, { on: boolean; percentage: string; occupants: string }>>({});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          meterId: form.meterId,
          name: form.name,
          method: form.method,
          landlordSharePct: Number(form.landlordSharePct),
          members: Object.entries(members)
            .filter(([, m]) => m.on)
            .map(([unitId, m]) => ({ unitId, percentage: form.method === 'percentage' ? Number(m.percentage) : null, occupants: form.method === 'occupancy' ? Number(m.occupants) : null })),
        });
      }}
      className="mb-4 space-y-2 rounded-md border border-light-border p-3 dark:border-dark-border"
    >
      {meters.length === 0 ? <p className="text-xs text-muted-foreground">Add a main or shared (check) consumption meter first.</p> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={labelClass}>
          Shared meter
          <select className={inputClass} value={form.meterId} onChange={(e) => setForm({ ...form, meterId: e.target.value })}>
            {meters.map((m) => <option key={m.id} value={m.id}>{meterLabel(m, data.units)}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Name
          <input className={inputClass} required maxLength={100} placeholder="e.g. Block B shared water" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className={labelClass}>
          Split by
          <select className={inputClass} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            <option value="equal">Equal shares</option>
            <option value="floor_area">Floor area (m²)</option>
            <option value="occupancy">Number of occupants</option>
            <option value="percentage">Fixed percentages</option>
          </select>
        </label>
        <label className={labelClass}>
          Landlord keeps (%) — common areas
          <input className={inputClass} type="number" min="0" max="100" step="any" value={form.landlordSharePct} onChange={(e) => setForm({ ...form, landlordSharePct: e.target.value })} />
        </label>
      </div>
      <div className="grid gap-1 text-xs sm:grid-cols-2">
        {data.units.map((u) => {
          const m = members[u.id] ?? { on: false, percentage: '', occupants: '' };
          const set = (patch: Partial<typeof m>) => setMembers({ ...members, [u.id]: { ...m, ...patch } });
          return (
            <div key={u.id} className="flex items-center gap-2">
              <label className="flex items-center gap-1"><input type="checkbox" checked={m.on} onChange={(e) => set({ on: e.target.checked })} /> {u.unit_label}</label>
              {m.on && form.method === 'percentage' ? <input className="w-20 rounded border border-light-border bg-transparent px-1 dark:border-dark-border" type="number" min="0" max="100" step="any" placeholder="%" aria-label={`${u.unit_label} %`} value={m.percentage} onChange={(e) => set({ percentage: e.target.value })} /> : null}
              {m.on && form.method === 'occupancy' ? <input className="w-20 rounded border border-light-border bg-transparent px-1 dark:border-dark-border" type="number" min="0" step="1" placeholder="people" aria-label={`${u.unit_label} occupants`} value={m.occupants} onChange={(e) => set({ occupants: e.target.value })} /> : null}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">Vacant units’ shares stay with the landlord. Percentages plus the landlord share must total 100.</p>
      <Button type="submit" size="sm" disabled={!form.meterId}>Save shared meter</Button>
    </form>
  );
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
