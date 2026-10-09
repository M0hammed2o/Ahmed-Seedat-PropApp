// Main-meter vs submeter reconciliation (docs/SMART_UTILITY_ARCHITECTURE.md §6). Pure.
//
// The difference between a main meter and the sum of its submeters is reported as UNALLOCATED
// consumption. It is never classified as theft or leakage: it may be common-area use, timing
// differences between reads, measurement error, or a leak -- the UI says exactly that.

import type { ConsumptionQuality } from './consumption';

export interface ReconciliationInput {
  main: { meterId: string; consumption: number | null; quality: ConsumptionQuality } | null;
  submeters: {
    meterId: string;
    label: string;
    consumption: number | null;
    quality: ConsumptionQuality;
  }[];
  thresholdPct: number;
}

export type ReconciliationStatus =
  | 'within_threshold'
  | 'above_threshold'
  | 'submeters_exceed_main'
  | 'insufficient_data';

export interface ReconciliationResult {
  main: number | null;
  submeterTotal: number;
  unallocated: number | null;
  unallocatedPct: number | null;
  status: ReconciliationStatus;
  /** Submeters with no usable figure for the period (excluded from the total, listed for the UI). */
  missing: string[];
  /** Any input that is only 'partial' -- the comparison is indicative, not exact. */
  approximate: boolean;
  submeters: { meterId: string; label: string; consumption: number | null; sharePct: number | null }[];
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function reconcile(input: ReconciliationInput): ReconciliationResult {
  const missing = input.submeters.filter((s) => s.consumption === null).map((s) => s.label);
  const known = input.submeters.filter((s) => s.consumption !== null);
  const submeterTotal = round(known.reduce((sum, s) => sum + (s.consumption ?? 0), 0), 4);
  const main = input.main?.consumption ?? null;
  const approximate =
    input.main?.quality === 'partial' || input.submeters.some((s) => s.quality === 'partial');

  const submeters = input.submeters.map((s) => ({
    meterId: s.meterId,
    label: s.label,
    consumption: s.consumption,
    sharePct: s.consumption !== null && main && main > 0 ? round((s.consumption / main) * 100) : null,
  }));

  if (main === null || main <= 0 || input.submeters.length === 0 || missing.length > 0) {
    return {
      main,
      submeterTotal,
      unallocated: main !== null && missing.length === 0 ? round(main - submeterTotal, 4) : null,
      unallocatedPct: null,
      status: 'insufficient_data',
      missing,
      approximate,
      submeters,
    };
  }

  const unallocated = round(main - submeterTotal, 4);
  const unallocatedPct = round((unallocated / main) * 100);
  let status: ReconciliationStatus;
  if (unallocated < 0) status = 'submeters_exceed_main';
  else if (unallocatedPct > input.thresholdPct) status = 'above_threshold';
  else status = 'within_threshold';

  return { main, submeterTotal, unallocated, unallocatedPct, status, missing, approximate, submeters };
}
