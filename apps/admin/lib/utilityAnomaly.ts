// V1 utilities/rates/levies/budgets pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §4B). The ONE
// definition of "unusual usage" -- used by both the reading-history API route (displays
// isUnusualUsage per period) and the Portfolio Intelligence rules engine (raises a Needs Attention
// insight). Previously duplicated as two copies of the same magic numbers; consolidated here so
// changing the threshold changes both call sites together.
//
// Never "leak detected" -- both callers must use wording like "Unusual water usage" /
// "Possible abnormal consumption", never a diagnosis this data alone cannot support.

export const ANOMALY_PERCENT_THRESHOLD = 20;
export const ANOMALY_MIN_ABSOLUTE_INCREASE: Record<'L' | 'kWh', number> = { L: 200, kWh: 20 };
export const MIN_HISTORY_PERIODS_FOR_ANOMALY = 2;

/** true only when BOTH a >=20% period-over-period increase AND an absolute floor are crossed (a
 * 1 L -> 3 L "reading" is a 200% increase on a meaningless base and must never trigger), and only
 * once enough real history exists to compare against. */
export function isUnusualUsage(params: {
  consumption: number | null;
  previousConsumption: number | null;
  unitOfMeasure: 'L' | 'kWh';
  periodIndex: number; // 0-based index of this reading within the meter's own ordered history
}): boolean {
  const { consumption, previousConsumption, unitOfMeasure, periodIndex } = params;
  if (periodIndex < MIN_HISTORY_PERIODS_FOR_ANOMALY - 1) return false;
  if (consumption === null || previousConsumption === null || previousConsumption <= 0) return false;
  const percentChange = ((consumption - previousConsumption) / previousConsumption) * 100;
  const absoluteIncrease = consumption - previousConsumption;
  return percentChange >= ANOMALY_PERCENT_THRESHOLD && absoluteIncrease >= ANOMALY_MIN_ABSOLUTE_INCREASE[unitOfMeasure];
}

export function percentChange(consumption: number | null, previousConsumption: number | null): number | null {
  if (consumption === null || previousConsumption === null || previousConsumption <= 0) return null;
  return Math.round(((consumption - previousConsumption) / previousConsumption) * 1000) / 10;
}
