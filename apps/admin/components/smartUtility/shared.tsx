'use client';

import type { ReactNode } from 'react';
import type { SmartUtilityOverview } from '@/lib/smartUtility/overview';
import { safeJson } from '@/lib/safeJson';

export type Overview = SmartUtilityOverview & {
  property: { id: string; org_id: string; nickname: string | null; full_address: string | null };
};
export type MeterSummary = Overview['meters'][number];

export const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm dark:border-dark-border';
export const labelClass = 'block text-xs text-muted-foreground';
export const errorClass =
  'rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger';
export const noteClass =
  'rounded-md border border-light-border bg-light-surface px-3 py-2 text-xs text-muted-foreground dark:border-dark-border dark:bg-dark-surface';

/** JSON request helper: returns {ok, data} and never throws. `data` is `any` for the same reason
 * lib/safeJson.ts gives: a drop-in for `await response.json()`. */
export async function api(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  body?: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, data: await safeJson(res) };
  } catch {
    return { ok: false, data: { error: { message: 'Network error. Please try again.' } } };
  }
}

export function errorMessage(data: unknown, fallback = 'Something went wrong.'): string {
  const err = (data as { error?: { message?: string; field_errors?: Record<string, string[]> } } | null)?.error;
  const first = err?.field_errors ? Object.values(err.field_errors).flat()[0] : undefined;
  return first ?? err?.message ?? fallback;
}

export function fmtNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-ZA', { maximumFractionDigits: digits });
}

export function fmtRand(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' });
}

const TONE: Record<string, string> = {
  good: 'border-light-success/40 bg-light-success/10 text-light-success dark:border-dark-success/40 dark:bg-dark-success/10 dark:text-dark-success',
  warn: 'border-light-warning/40 bg-light-warning/10 text-light-warning dark:border-dark-warning/40 dark:bg-dark-warning/10 dark:text-dark-warning',
  bad: 'border-light-danger/40 bg-light-danger/10 text-light-danger dark:border-dark-danger/40 dark:bg-dark-danger/10 dark:text-dark-danger',
  neutral: 'border-light-border text-muted-foreground dark:border-dark-border',
};

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export const HEALTH_TONE: Record<string, keyof typeof TONE> = {
  online: 'good',
  stale: 'warn',
  offline: 'bad',
  error: 'bad',
  unknown: 'neutral',
  manual: 'neutral',
};

export const HEALTH_LABEL: Record<string, string> = {
  online: 'Online',
  stale: 'Late',
  offline: 'Offline',
  error: 'Error',
  unknown: 'Waiting for first reading',
  manual: 'Manual readings',
};

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-light-border p-3 dark:border-dark-border">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function meterLabel(m: MeterSummary, units: Overview['units']): string {
  const unit = m.unitId ? units.find((u) => u.id === m.unitId)?.unit_label : null;
  const who = unit ?? (m.meterRole === 'main' ? 'Main' : m.meterRole === 'check' ? 'Check' : 'Common');
  const id = m.meterNumber ?? m.serialNumber ?? m.externalDeviceId ?? m.id.slice(0, 8);
  const kind = m.measurementKind && m.measurementKind !== 'consumption' ? ` (${KIND_LABEL[m.measurementKind] ?? m.measurementKind})` : '';
  return `${who} · ${m.utilityType === 'water' ? 'Water' : 'Electricity'}${kind} · ${id}`;
}

export const KIND_LABEL: Record<string, string> = {
  consumption: 'consumption',
  grid_import: 'grid import',
  grid_export: 'grid export',
  generation: 'solar generation',
  battery_charge: 'battery charge',
  battery_discharge: 'battery discharge',
  generator_output: 'generator',
  pump_energy: 'pump energy',
  transfer: 'transfer',
  source_supply: 'source supply',
  tank_inflow: 'tank inflow',
  tank_outflow: 'tank outflow',
};

export const SOURCE_LABEL: Record<string, string> = {
  municipal_grid: 'Municipal grid',
  eskom_direct: 'Eskom direct',
  prepaid: 'Prepaid',
  solar_pv: 'Solar PV',
  battery: 'Battery',
  generator: 'Generator',
  municipal: 'Municipal water',
  borehole: 'Borehole',
  rainwater: 'Rainwater',
  storage_tank: 'Storage tank',
  tanker: 'Water tanker',
  other: 'Other',
};

export const BASIS_TONE: Record<string, 'good' | 'warn' | 'neutral' | 'bad'> = { measured: 'good', derived: 'neutral', logged: 'warn', estimated: 'warn', missing: 'bad' };

export function Figure({ label, value, unit, basis, hint }: { label: string; value: number | null; unit: string; basis: string; hint?: string }) {
  return (
    <div className="rounded-md border border-light-border p-3 dark:border-dark-border">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <Badge tone={BASIS_TONE[basis] ?? 'neutral'}>{basis}</Badge>
      </div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value === null ? '—' : `${fmtNumber(value, 2)} ${unit}`}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
