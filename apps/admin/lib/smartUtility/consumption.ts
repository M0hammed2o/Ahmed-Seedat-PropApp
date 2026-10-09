// Smart Utility consumption engine (docs/SMART_UTILITY_ARCHITECTURE.md §5). Pure functions only --
// no DB access -- so rollover/reset/replacement/interpolation behaviour is unit-tested exhaustively
// (lib/smartUtility/__tests__/engines.test.ts).
//
// Inputs are CUMULATIVE register readings. `value` is already in the meter's base unit (L for water,
// kWh for electricity) using the multiplier in force when the reading was ingested; `rawValue` is the
// device register itself, needed to recognise a register rollover.

export interface MeterReadingPoint {
  readAt: string | Date;
  rawValue: number;
  value: number;
  /** base units per raw unit at ingestion time (value / rawValue when rawValue > 0) */
  multiplier: number;
  status?: 'valid' | 'suspect' | 'rejected';
}

export interface RegisterConfig {
  /** Number of register digits; the raw register wraps to 0 after 10^digits - 1. Null = unknown. */
  registerDigits?: number | null;
}

export type IntervalKind = 'normal' | 'rollover' | 'reset';

export interface ConsumptionInterval {
  start: Date;
  end: Date;
  /** null when the interval spans a meter reset: the true consumption is unknown, never guessed. */
  consumption: number | null;
  kind: IntervalKind;
}

export type ConsumptionQuality = 'complete' | 'partial' | 'insufficient';

export interface PeriodConsumption {
  consumption: number | null;
  quality: ConsumptionQuality;
  /** True when a reset inside the period means the figure excludes some unknown consumption. */
  resetInPeriod: boolean;
  startValue: number | null;
  endValue: number | null;
  startAt: Date | null;
  endAt: Date | null;
}

/** Max share of the register span that a wrapped delta may represent before we call it a reset. */
const MAX_ROLLOVER_SHARE = 0.5;

export const SAST_OFFSET_HOURS = 2; // Africa/Johannesburg: UTC+2, no daylight saving.

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Valid (non-rejected, non-suspect) points, sorted ascending, de-duplicated by timestamp. */
export function usablePoints(points: MeterReadingPoint[]): (MeterReadingPoint & { at: Date })[] {
  const seen = new Set<number>();
  return points
    .filter((p) => (p.status ?? 'valid') === 'valid' && Number.isFinite(p.value) && p.value >= 0)
    .map((p) => ({ ...p, at: toDate(p.readAt) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter((p) => {
      const t = p.at.getTime();
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

/**
 * Classifies a decrease between two consecutive raw register values.
 * Rollover: the register wrapped past its maximum (requires registerDigits) and the wrapped delta
 * is plausible (<= 50 % of the register span). Anything else is a reset/replacement/tamper and the
 * interval's consumption is unknown.
 */
export function classifyDecrease(
  prevRaw: number,
  currRaw: number,
  config: RegisterConfig,
): { kind: 'rollover'; rawDelta: number } | { kind: 'reset' } {
  if (config.registerDigits) {
    const span = 10 ** config.registerDigits;
    if (prevRaw < span && currRaw < span) {
      const wrapped = span - prevRaw + currRaw;
      if (wrapped > 0 && wrapped <= span * MAX_ROLLOVER_SHARE) {
        return { kind: 'rollover', rawDelta: wrapped };
      }
    }
  }
  return { kind: 'reset' };
}

export function computeIntervals(
  points: MeterReadingPoint[],
  config: RegisterConfig = {},
): ConsumptionInterval[] {
  const pts = usablePoints(points);
  const out: ConsumptionInterval[] = [];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const curr = pts[i]!;
    if (curr.rawValue >= prev.rawValue) {
      // value already carries each point's own multiplier, so a multiplier change between two
      // readings is handled by differencing values, not raw registers.
      const delta = curr.value - prev.value;
      if (delta >= 0) {
        out.push({ start: prev.at, end: curr.at, consumption: round4(delta), kind: 'normal' });
      } else {
        // raw went up but value went down: multiplier was reduced without a register change --
        // cannot be trusted either way.
        out.push({ start: prev.at, end: curr.at, consumption: null, kind: 'reset' });
      }
      continue;
    }
    const decision = classifyDecrease(prev.rawValue, curr.rawValue, config);
    if (decision.kind === 'rollover') {
      out.push({
        start: prev.at,
        end: curr.at,
        consumption: round4(decision.rawDelta * curr.multiplier),
        kind: 'rollover',
      });
    } else {
      out.push({ start: prev.at, end: curr.at, consumption: null, kind: 'reset' });
    }
  }
  return out;
}

/**
 * Builds a continuous cumulative-consumption curve C(t) from the intervals: C(first) = 0, each
 * interval adds its consumption; a reset interval adds 0 and is flagged (its true consumption is
 * unknown). C is evaluated by linear interpolation inside an interval no longer than maxGapHours.
 */
function cumulativeCurve(points: MeterReadingPoint[], config: RegisterConfig) {
  const pts = usablePoints(points);
  const intervals = computeIntervals(pts, config);
  const times = pts.map((p) => p.at.getTime());
  const cum: number[] = [0];
  for (const iv of intervals) cum.push(cum[cum.length - 1]! + (iv.consumption ?? 0));
  return { pts, intervals, times, cum };
}

function evaluate(
  curve: ReturnType<typeof cumulativeCurve>,
  t: number,
  maxGapMs: number,
): number | null {
  const { times, cum, intervals } = curve;
  if (times.length === 0 || t < times[0]! || t > times[times.length - 1]!) return null;
  // binary search for the last index with times[i] <= t
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  if (times[lo] === t) return cum[lo]!;
  const iv = intervals[lo]!;
  const span = times[lo + 1]! - times[lo]!;
  if (span > maxGapMs) return null;
  if (iv.kind === 'reset') return null; // unknown inside a reset interval
  return cum[lo]! + ((cum[lo + 1]! - cum[lo]!) * (t - times[lo]!)) / span;
}

export interface PeriodOptions extends RegisterConfig {
  /** Max distance between two readings to interpolate a boundary value. Default 48 h. */
  maxGapHours?: number;
}

/**
 * Consumption between two instants. Boundaries are interpolated between the readings either side
 * when they are close enough ('complete'); otherwise the nearest readings INSIDE the period are used
 * and the result is 'partial'. Fewer than two usable readings in range = 'insufficient'.
 */
export function consumptionForPeriod(
  points: MeterReadingPoint[],
  start: Date,
  end: Date,
  options: PeriodOptions = {},
): PeriodConsumption {
  const maxGapMs = (options.maxGapHours ?? 48) * 3_600_000;
  const curve = cumulativeCurve(points, options);
  const s = start.getTime();
  const e = end.getTime();
  const empty: PeriodConsumption = {
    consumption: null,
    quality: 'insufficient',
    resetInPeriod: false,
    startValue: null,
    endValue: null,
    startAt: null,
    endAt: null,
  };
  if (curve.pts.length < 2 || e <= s) return empty;

  let quality: ConsumptionQuality = 'complete';
  let startC = evaluate(curve, s, maxGapMs);
  let startAt: Date | null = start;
  if (startC === null) {
    const idx = curve.times.findIndex((t) => t >= s && t <= e);
    if (idx === -1) return empty;
    startC = curve.cum[idx]!;
    startAt = curve.pts[idx]!.at;
    quality = 'partial';
  }
  let endC = evaluate(curve, e, maxGapMs);
  let endAt: Date | null = end;
  if (endC === null) {
    let idx = -1;
    for (let i = curve.times.length - 1; i >= 0; i--) {
      if (curve.times[i]! <= e && curve.times[i]! >= s) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return empty;
    endC = curve.cum[idx]!;
    endAt = curve.pts[idx]!.at;
    quality = 'partial';
  }
  if (startC === null || endC === null || !startAt || !endAt || endAt.getTime() <= startAt.getTime()) return empty;

  const resetInPeriod = curve.intervals.some(
    (iv) => iv.kind === 'reset' && iv.end.getTime() > startAt!.getTime() && iv.start.getTime() < endAt!.getTime(),
  );

  // Report the actual register values nearest each boundary (for the municipal pack's
  // previous/current reading columns).
  const startPoint = nearestPoint(curve.pts, startAt);
  const endPoint = nearestPoint(curve.pts, endAt);

  return {
    consumption: round4(endC - startC),
    quality: resetInPeriod && quality === 'complete' ? 'partial' : quality,
    resetInPeriod,
    startValue: startPoint?.value ?? null,
    endValue: endPoint?.value ?? null,
    startAt,
    endAt,
  };
}

function nearestPoint<T extends { at: Date }>(pts: T[], at: Date): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const p of pts) {
    const d = Math.abs(p.at.getTime() - at.getTime());
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Consumption across a replacement chain (old meter → new meter). Each physical meter is computed
 * separately so the old meter's final reading and the new meter's first reading never produce a
 * bogus delta; results are summed. Quality is the worst of the parts that have data.
 */
export function consumptionForChain(
  chain: { points: MeterReadingPoint[]; config: RegisterConfig }[],
  start: Date,
  end: Date,
  options: Omit<PeriodOptions, 'registerDigits'> = {},
): PeriodConsumption {
  const parts = chain
    .map((m) => consumptionForPeriod(m.points, start, end, { ...options, ...m.config }))
    .filter((p) => p.consumption !== null);
  if (parts.length === 0) {
    return {
      consumption: null,
      quality: 'insufficient',
      resetInPeriod: false,
      startValue: null,
      endValue: null,
      startAt: null,
      endAt: null,
    };
  }
  const rank: Record<ConsumptionQuality, number> = { complete: 0, partial: 1, insufficient: 2 };
  const worst = parts.reduce((w, p) => (rank[p.quality] > rank[w] ? p.quality : w), 'complete' as ConsumptionQuality);
  return {
    consumption: round4(parts.reduce((s, p) => s + (p.consumption ?? 0), 0)),
    // A multi-meter chain inside one period is never "complete": the swap itself loses whatever
    // flowed between the old meter's last and the new meter's first reading.
    quality: parts.length > 1 && worst === 'complete' ? 'partial' : worst,
    resetInPeriod: parts.some((p) => p.resetInPeriod),
    startValue: parts[0]!.startValue,
    endValue: parts[parts.length - 1]!.endValue,
    startAt: parts[0]!.startAt,
    endAt: parts[parts.length - 1]!.endAt,
  };
}

/** Consumption per fixed bucket (e.g. hourly), null where the bucket cannot be determined. */
export function bucketConsumption(
  points: MeterReadingPoint[],
  from: Date,
  to: Date,
  bucketMinutes: number,
  config: RegisterConfig = {},
  maxGapHours = 6,
): { start: Date; consumption: number | null }[] {
  const curve = cumulativeCurve(points, config);
  const maxGapMs = maxGapHours * 3_600_000;
  const step = bucketMinutes * 60_000;
  const out: { start: Date; consumption: number | null }[] = [];
  for (let t = from.getTime(); t + step <= to.getTime(); t += step) {
    const a = evaluate(curve, t, maxGapMs);
    const b = evaluate(curve, t + step, maxGapMs);
    out.push({ start: new Date(t), consumption: a === null || b === null ? null : round4(b - a) });
  }
  return out;
}

// ---------------------------------------------------------------- SAST calendar helpers

/** A wall-clock instant in Africa/Johannesburg as a UTC Date. month is 1-12. */
export function sastInstant(year: number, month: number, day: number, hour = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - SAST_OFFSET_HOURS));
}

/** SAST calendar parts of an instant. */
export function sastParts(d: Date): { year: number; month: number; day: number; hour: number } {
  const shifted = new Date(d.getTime() + SAST_OFFSET_HOURS * 3_600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

/**
 * The billing period containing `at`, for a municipal billing day (1-28): from billingDay 00:00 SAST
 * of one month to billingDay 00:00 SAST of the next. Never assumes calendar month end.
 */
export function billingPeriodContaining(at: Date, billingDay: number): { start: Date; end: Date } {
  const p = sastParts(at);
  let year = p.year;
  let month = p.month;
  if (p.day < billingDay) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  const start = sastInstant(year, month, billingDay);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return { start, end: sastInstant(nextYear, nextMonth, billingDay) };
}

/** The most recent billing period that has fully ended at `now`. */
export function lastCompleteBillingPeriod(now: Date, billingDay: number): { start: Date; end: Date } {
  const current = billingPeriodContaining(now, billingDay);
  return billingPeriodContaining(new Date(current.start.getTime() - 1), billingDay);
}

/** Calendar date (YYYY-MM-DD) of an instant in SAST. */
export function sastDateString(d: Date): string {
  const p = sastParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
