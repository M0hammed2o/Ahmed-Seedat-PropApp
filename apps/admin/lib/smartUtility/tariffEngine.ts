// Tariff engine v2 (docs/HYBRID_UTILITIES_ARCHITECTURE.md §D). Pure and decimal-safe (money.ts).
// Never contains a built-in municipal tariff: every rate comes from a tariff the owner entered.

import { centsToNumber, lineCents, scaledToNumber, toScaled, vatSplit, randToCents, divRound } from './money';
import { SAST_OFFSET_HOURS } from './consumption';

export type TariffKind = 'block' | 'tou' | 'flat' | 'fixed_only' | 'cost_recovery' | 'prepaid_passthrough';
export type DayType = 'weekday' | 'saturday' | 'sunday' | 'all';

export interface Block {
  upTo: number | null;
  rate: number;
}

export interface TouPeriod {
  name: string;
  rate: number;
  windows: { days: DayType; from: string; to: string }[];
}

export interface Season {
  name: string;
  months: number[];
  blocks?: Block[];
  touPeriods?: TouPeriod[];
}

export interface TariffV2 {
  id?: string;
  name: string;
  kind: TariffKind;
  utilityType: 'water' | 'electricity';
  fixedCharge: number | string;
  blocks: Block[];
  touPeriods: TouPeriod[];
  seasons: Season[];
  vatInclusive: boolean;
  vatRate: number | string;
  prorateBlocks: boolean;
}

export interface ChargeInput {
  /** Segment consumption in display units (kL / kWh); null = unknown. */
  consumption: number | null;
  segmentStart: Date;
  segmentEnd: Date;
  /** Billing-period days, for proration. */
  periodDays: number;
  /** Optional daily consumption (display units) for season splitting. */
  daily?: { date: string; value: number | null }[];
  /** Hourly consumption (display units), required for TOU. */
  hourly?: { start: Date; value: number | null }[];
  /** Units included free (fixed-allowance arrangements), before proration. */
  allowanceQuantity?: number | null;
}

export interface ChargeLine {
  kind: 'usage' | 'fixed' | 'allowance';
  label: string;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  exclCents: number;
  vatCents: number;
  inclCents: number;
}

export interface ChargeResult {
  ok: boolean;
  refusal?: string;
  lines: ChargeLine[];
  totals: { exclCents: number; vatCents: number; inclCents: number };
  prorationFactor: number;
  notes: string[];
  flags: string[];
}

const DAY_MS = 86_400_000;

function sastDate(d: Date) {
  const s = new Date(d.getTime() + SAST_OFFSET_HOURS * 3_600_000);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, day: s.getUTCDate(), hour: s.getUTCHours(), minute: s.getUTCMinutes(), dow: s.getUTCDay() };
}

function seasonFor(t: TariffV2, month: number): Season | null {
  return t.seasons.find((s) => s.months.includes(month)) ?? null;
}

function unitFor(t: TariffV2) {
  return t.utilityType === 'water' ? 'kL' : 'kWh';
}

function dayType(dow: number): Exclude<DayType, 'all'> {
  return dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday';
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + (m ?? 0);
}

function matchesWindow(w: TouPeriod['windows'][number], dt: Exclude<DayType, 'all'>, minuteOfDay: number): boolean {
  if (w.days !== 'all' && w.days !== dt) return false;
  const from = minutes(w.from);
  const to = minutes(w.to) === 0 ? 1440 : minutes(w.to);
  return from <= to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to;
}

export function validateTariff(t: TariffV2): string | null {
  const checkBlocks = (blocks: Block[], label: string) => {
    if (blocks.length === 0) return `${label}: at least one block is required.`;
    let prev = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (!(b.rate >= 0)) return `${label} block ${i + 1}: rate must be zero or more.`;
      if (i === blocks.length - 1) {
        if (b.upTo !== null) return `${label}: the last block must be open-ended.`;
      } else if (b.upTo === null || !(b.upTo > prev)) {
        return `${label} block ${i + 1}: upper limit must be greater than ${prev}.`;
      } else prev = b.upTo;
    }
    return null;
  };
  const checkTou = (periods: TouPeriod[], label: string) => {
    if (periods.length === 0) return `${label}: at least one time-of-use period is required.`;
    for (const p of periods) {
      if (!(p.rate >= 0)) return `${label} ${p.name}: rate must be zero or more.`;
      for (const w of p.windows) {
        if (!/^\d{2}:\d{2}$/.test(w.from) || !/^\d{2}:\d{2}$/.test(w.to)) return `${label} ${p.name}: times must be HH:MM.`;
      }
    }
    // Every hour of every day type must be covered exactly once.
    for (const dt of ['weekday', 'saturday', 'sunday'] as const) {
      for (let m = 0; m < 1440; m += 30) {
        const hits = periods.filter((p) => p.windows.some((w) => matchesWindow(w, dt, m))).length;
        if (hits !== 1) return `${label}: ${dt} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} is covered by ${hits} periods (must be exactly 1).`;
      }
    }
    return null;
  };
  const months = t.seasons.flatMap((s) => s.months);
  if (new Set(months).size !== months.length) return 'A month belongs to more than one season.';
  if (months.some((m) => m < 1 || m > 12)) return 'Season months must be 1–12.';
  if (t.kind === 'block' || t.kind === 'flat' || t.kind === 'cost_recovery') {
    if (t.seasons.length) {
      for (const s of t.seasons) {
        const e = checkBlocks(s.blocks ?? t.blocks, `Season ${s.name}`);
        if (e) return e;
      }
      if (t.seasons.length && new Set(months).size < 12 && t.blocks.length === 0) return 'Months outside every season need default blocks.';
    } else {
      const e = checkBlocks(t.blocks, 'Tariff');
      if (e) return e;
    }
    if ((t.kind === 'flat' || t.kind === 'cost_recovery') && t.blocks.length > 1) return 'A flat tariff has one rate (one open block).';
  }
  if (t.kind === 'tou') {
    if (t.seasons.length) {
      for (const s of t.seasons) {
        const e = checkTou(s.touPeriods ?? t.touPeriods, `Season ${s.name}`);
        if (e) return e;
      }
    } else {
      const e = checkTou(t.touPeriods, 'Tariff');
      if (e) return e;
    }
  }
  return null;
}

function priced(t: TariffV2, label: string, kind: ChargeLine['kind'], qtyScaled: bigint, rate: number): ChargeLine {
  const cents = lineCents(qtyScaled, toScaled(rate));
  const v = vatSplit(cents, t.vatInclusive, t.vatRate);
  return {
    kind,
    label,
    quantity: scaledToNumber(qtyScaled),
    unit: unitFor(t),
    rate,
    exclCents: Number(v.excl),
    vatCents: Number(v.vat),
    inclCents: Number(v.incl),
  };
}

/** Exact rational scale (num/den) — proration and season shares never pass through floating point. */
interface Ratio {
  num: bigint;
  den: bigint;
}

function applyBlocks(t: TariffV2, blocks: Block[], qty: bigint, thresholdScale: Ratio, label: string): ChargeLine[] {
  // thresholdScale is applied to each block upper limit (proration / season share).
  const lines: ChargeLine[] = [];
  let remaining = qty;
  let from = 0n;
  for (let i = 0; i < blocks.length && remaining > 0n; i++) {
    const b = blocks[i]!;
    const upTo = b.upTo === null ? null : divRound(toScaled(b.upTo) * thresholdScale.num, thresholdScale.den);
    const cap = upTo === null ? remaining : upTo - from;
    const take = cap < remaining ? (cap > 0n ? cap : 0n) : remaining;
    if (take > 0n) {
      const range = b.upTo === null ? `above ${scaledToNumber(from)}` : `${scaledToNumber(from)}–${scaledToNumber(upTo!)}`;
      lines.push(priced(t, `${label}${blocks.length > 1 ? ` block ${i + 1} (${range} ${unitFor(t)})` : ''}`, 'usage', take, b.rate));
    }
    remaining -= take;
    if (upTo !== null) from = upTo;
  }
  return lines;
}

export function computeTariffCharge(t: TariffV2, input: ChargeInput): ChargeResult {
  const notes: string[] = [];
  const flags: string[] = [];
  const segmentDays = Math.max(1, Math.round((input.segmentEnd.getTime() - input.segmentStart.getTime()) / DAY_MS));
  const periodDays = Math.max(segmentDays, input.periodDays > 0 ? input.periodDays : segmentDays);
  const proration = segmentDays / periodDays;
  const prorationRatio: Ratio = { num: BigInt(segmentDays), den: BigInt(periodDays) };
  const ONE: Ratio = { num: 1n, den: 1n };
  const empty = (refusal: string): ChargeResult => ({
    ok: false,
    refusal,
    lines: [],
    totals: { exclCents: 0, vatCents: 0, inclCents: 0 },
    prorationFactor: proration,
    notes,
    flags,
  });

  const invalid = validateTariff(t);
  if (invalid) return empty(`Tariff "${t.name}" is invalid: ${invalid}`);
  if (t.kind === 'cost_recovery') flags.push('cost_recovery_requires_contract_and_regulatory_review');
  if (t.kind === 'prepaid_passthrough') {
    notes.push('Prepaid supply: the tenant buys tokens directly, so there is nothing to charge.');
    return { ok: true, lines: [], totals: { exclCents: 0, vatCents: 0, inclCents: 0 }, prorationFactor: proration, notes, flags };
  }

  const lines: ChargeLine[] = [];
  const fixedRandScaled = toScaled(t.fixedCharge);
  if (fixedRandScaled > 0n) {
    // A fixed charge is always prorated to the days actually occupied.
    const proratedRand = divRound(fixedRandScaled * prorationRatio.num, prorationRatio.den);
    const v = vatSplit(randToCents(proratedRand), t.vatInclusive, t.vatRate);
    lines.push({
      kind: 'fixed',
      label: proration < 1 ? `Fixed charge (${segmentDays} of ${periodDays} days)` : 'Fixed charge',
      quantity: null,
      unit: null,
      rate: null,
      exclCents: Number(v.excl),
      vatCents: Number(v.vat),
      inclCents: Number(v.incl),
    });
  }

  if (t.kind !== 'fixed_only') {
    if (input.consumption === null) return empty('Consumption for this period could not be calculated (missing readings or a meter reset).');
    let qty = toScaled(input.consumption);
    if (qty < 0n) return empty('Consumption is negative.');
    if (input.allowanceQuantity) {
      const allowance = divRound(toScaled(input.allowanceQuantity) * prorationRatio.num, prorationRatio.den);
      const used = allowance < qty ? allowance : qty;
      lines.push({ kind: 'allowance', label: `Included allowance (${scaledToNumber(allowance)} ${unitFor(t)})`, quantity: scaledToNumber(used), unit: unitFor(t), rate: 0, exclCents: 0, vatCents: 0, inclCents: 0 });
      qty -= used;
    }

    if (t.kind === 'tou') {
      const hourly = input.hourly ?? [];
      if (hourly.length === 0 || hourly.some((h) => h.value === null)) {
        return empty('Time-of-use billing needs complete hourly readings for the period; they are missing.');
      }
      if (input.allowanceQuantity) notes.push('Allowance is not applied to time-of-use tariffs.');
      const buckets = new Map<string, { season: string; period: TouPeriod; qty: bigint }>();
      for (const h of hourly) {
        const p = sastDate(h.start);
        const season = seasonFor(t, p.m);
        const periods = season?.touPeriods ?? t.touPeriods;
        const minuteOfDay = p.hour * 60 + p.minute;
        const match = periods.find((tp) => tp.windows.some((w) => matchesWindow(w, dayType(p.dow), minuteOfDay)));
        if (!match) return empty(`No time-of-use period covers ${p.y}-${p.m}-${p.day} ${p.hour}:00.`);
        const key = `${season?.name ?? ''}|${match.name}`;
        const cur = buckets.get(key) ?? { season: season?.name ?? '', period: match, qty: 0n };
        cur.qty += toScaled(h.value!);
        buckets.set(key, cur);
      }
      for (const b of buckets.values()) {
        if (b.qty === 0n) continue;
        lines.push(priced(t, `${b.season ? `${b.season} ` : ''}${b.period.name}`, 'usage', b.qty, b.period.rate));
      }
      notes.push('Public holidays are priced by their day of the week.');
    } else if (t.seasons.length === 0) {
      lines.push(...applyBlocks(t, t.blocks, qty, t.prorateBlocks ? prorationRatio : ONE, t.kind === 'cost_recovery' ? 'Cost recovery' : 'Usage'));
    } else {
      // Split consumption across seasons by daily consumption share (or by days when daily data is missing).
      const days: { month: number; weight: bigint }[] = [];
      for (let d = input.segmentStart.getTime(); d < input.segmentEnd.getTime(); d += DAY_MS) {
        const p = sastDate(new Date(d));
        const key = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
        const v = input.daily?.find((x) => x.date === key)?.value;
        days.push({ month: p.m, weight: v === undefined || v === null ? -1n : toScaled(v) });
      }
      const haveDaily = days.length > 0 && days.every((d) => d.weight >= 0n) && days.some((d) => d.weight > 0n);
      if (!haveDaily) notes.push('Seasonal split by days (daily readings incomplete).');
      const groups = new Map<string, { season: Season | null; weight: bigint; dayCount: number }>();
      for (const d of days) {
        const s = seasonFor(t, d.month);
        const key = s?.name ?? '__default';
        const g = groups.get(key) ?? { season: s, weight: 0n, dayCount: 0 };
        g.weight += haveDaily ? d.weight : 1n;
        g.dayCount += 1;
        groups.set(key, g);
      }
      const totalWeight = [...groups.values()].reduce((a, g) => a + g.weight, 0n);
      let allocated = 0n;
      const entries = [...groups.values()];
      entries.forEach((g, idx) => {
        const share = idx === entries.length - 1 ? qty - allocated : divRound(qty * g.weight, totalWeight);
        allocated += share;
        // limits × (season days / segment days) × (segment days / period days when prorating)
        const scale: Ratio = t.prorateBlocks
          ? { num: BigInt(g.dayCount), den: BigInt(periodDays) }
          : { num: BigInt(g.dayCount), den: BigInt(segmentDays) };
        lines.push(...applyBlocks(t, g.season?.blocks ?? t.blocks, share, scale, g.season ? `${g.season.name} season` : 'Usage'));
      });
    }
  }

  const totals = lines.reduce(
    (a, l) => ({ exclCents: a.exclCents + l.exclCents, vatCents: a.vatCents + l.vatCents, inclCents: a.inclCents + l.inclCents }),
    { exclCents: 0, vatCents: 0, inclCents: 0 },
  );
  if (proration < 1) notes.push(`Prorated: ${segmentDays} of ${periodDays} days${t.prorateBlocks ? ' (fixed charge and block limits)' : ' (fixed charge)'}.`);
  return { ok: true, lines, totals, prorationFactor: proration, notes, flags };
}

export function randOf(cents: number): number {
  return centsToNumber(BigInt(cents));
}
