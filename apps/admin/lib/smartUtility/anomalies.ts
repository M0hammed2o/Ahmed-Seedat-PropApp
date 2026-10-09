// Rule-based utility analytics (docs/SMART_UTILITY_ARCHITECTURE.md §7). Pure: takes already-bucketed
// consumption and returns candidate alerts. Every alert carries the numbers that triggered it and
// is worded as "possible" -- nothing here asserts a confirmed leak, theft or fault. No LLM calls.

export interface AlertThresholds {
  spikeMultiple: number;
  nightFlowLitresPerHour: number;
  nightBaseLoadRatio: number;
  vacantWaterLitresPerDay: number;
  vacantElectricityKwhPerDay: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  spikeMultiple: 3,
  nightFlowLitresPerHour: 5,
  nightBaseLoadRatio: 0.6,
  vacantWaterLitresPerDay: 50,
  vacantElectricityKwhPerDay: 2,
};

/** Absolute floors so tiny absolute changes on tiny baselines never alert. */
const SPIKE_FLOOR = { water: 200, electricity: 5 } as const; // L/day, kWh/day
const BASE_LOAD_FLOOR_KWH_PER_HOUR = 0.3;
/** Night window, SAST hours [start, end). */
export const NIGHT_HOURS = { start: 0, end: 5 } as const;

export type UtilityType = 'water' | 'electricity';

export type AlertRule =
  | 'water_continuous_night_flow'
  | 'consumption_spike'
  | 'vacant_unit_consumption'
  | 'electricity_night_base_load'
  | 'main_submeter_discrepancy'
  | 'meter_offline'
  | 'meter_reset_detected';

export interface AlertCandidate {
  rule: AlertRule;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  /** Excess consumption in base units (L or kWh) used for the cost estimate, when meaningful. */
  excessConsumption: number | null;
  details: Record<string, unknown>;
}

export interface DayAnalysisInput {
  utilityType: UtilityType;
  meterLabel: string;
  /** 24 hourly buckets for the day (SAST hour 0..23); null = unknown. Empty when resolution is daily. */
  hourly: (number | null)[];
  /** The day's total consumption in base units, null if unknown. */
  dayTotal: number | null;
  /** Previous days' totals (most recent last), nulls allowed. */
  history: (number | null)[];
  unitVacant: boolean;
  thresholds: AlertThresholds;
}

function fmt(n: number, utilityType: UtilityType): string {
  return utilityType === 'water'
    ? n >= 1000
      ? `${(n / 1000).toFixed(2)} kL`
      : `${Math.round(n)} L`
    : `${n.toFixed(2)} kWh`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function analyseDay(input: DayAnalysisInput): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const { utilityType, thresholds, meterLabel } = input;

  // --- Night flow (water) / night base load (electricity): needs hourly resolution.
  const night = input.hourly.slice(NIGHT_HOURS.start, NIGHT_HOURS.end);
  const nightKnown = night.length === NIGHT_HOURS.end - NIGHT_HOURS.start && night.every((v) => v !== null);
  if (nightKnown) {
    const nightValues = night as number[];
    if (utilityType === 'water') {
      const minHour = Math.min(...nightValues);
      if (minHour > thresholds.nightFlowLitresPerHour) {
        const nightTotal = nightValues.reduce((a, b) => a + b, 0);
        out.push({
          rule: 'water_continuous_night_flow',
          severity: minHour > thresholds.nightFlowLitresPerHour * 4 ? 'critical' : 'warning',
          title: `Possible leak: continuous overnight flow on ${meterLabel}`,
          message:
            `Water flowed in every hour between 00:00 and 05:00 (lowest hour ${fmt(minHour, 'water')}). ` +
            'Continuous overnight flow often indicates a leak or a running toilet/geyser overflow, but can also be legitimate use. Please check on site.',
          // Flow that never stopped overnight, extrapolated to 24 h, is the plausible daily loss.
          excessConsumption: minHour * 24,
          details: { nightHourly: nightValues, minHour, nightTotal, thresholdPerHour: thresholds.nightFlowLitresPerHour },
        });
      }
    } else {
      const day = input.hourly.slice(7, 19).filter((v): v is number => v !== null);
      const nightMean = nightValues.reduce((a, b) => a + b, 0) / nightValues.length;
      const dayMean = day.length ? day.reduce((a, b) => a + b, 0) / day.length : null;
      if (
        dayMean !== null &&
        dayMean > 0 &&
        nightMean > BASE_LOAD_FLOOR_KWH_PER_HOUR &&
        nightMean > thresholds.nightBaseLoadRatio * dayMean
      ) {
        out.push({
          rule: 'electricity_night_base_load',
          severity: 'warning',
          title: `High overnight base load on ${meterLabel}`,
          message:
            `Average use between 00:00 and 05:00 was ${fmt(nightMean, 'electricity')} per hour, ` +
            `${Math.round((nightMean / dayMean) * 100)}% of the daytime average. ` +
            'This can indicate equipment left on (geyser, pool pump, heaters) or a fault. Please check on site.',
          excessConsumption: (nightMean - BASE_LOAD_FLOOR_KWH_PER_HOUR) * (NIGHT_HOURS.end - NIGHT_HOURS.start),
          details: { nightMeanKwhPerHour: nightMean, dayMeanKwhPerHour: dayMean, ratio: thresholds.nightBaseLoadRatio },
        });
      }
    }
  }

  // --- Spike vs the trailing median.
  const hist = input.history.filter((v): v is number => v !== null);
  const med = median(hist.slice(-14));
  if (
    input.dayTotal !== null &&
    med !== null &&
    hist.length >= 5 &&
    input.dayTotal > thresholds.spikeMultiple * Math.max(med, 0) &&
    input.dayTotal - med > SPIKE_FLOOR[utilityType]
  ) {
    out.push({
      rule: 'consumption_spike',
      severity: input.dayTotal > thresholds.spikeMultiple * 2 * med ? 'critical' : 'warning',
      title: `Unusual ${utilityType} use on ${meterLabel}`,
      message:
        `Yesterday's use was ${fmt(input.dayTotal, utilityType)}, against a typical ${fmt(med, utilityType)} per day ` +
        `(median of the previous ${Math.min(hist.length, 14)} days).`,
      excessConsumption: input.dayTotal - med,
      details: { dayTotal: input.dayTotal, trailingMedian: med, spikeMultiple: thresholds.spikeMultiple },
    });
  }

  // --- Vacant unit consumption.
  const vacantFloor =
    utilityType === 'water' ? thresholds.vacantWaterLitresPerDay : thresholds.vacantElectricityKwhPerDay;
  if (input.unitVacant && input.dayTotal !== null && input.dayTotal > vacantFloor) {
    out.push({
      rule: 'vacant_unit_consumption',
      severity: 'warning',
      title: `${utilityType === 'water' ? 'Water' : 'Electricity'} used in a vacant unit (${meterLabel})`,
      message:
        `The unit is marked vacant but used ${fmt(input.dayTotal, utilityType)} yesterday. ` +
        'This may be contractors, a viewing, a leak or an appliance left on.',
      excessConsumption: input.dayTotal,
      details: { dayTotal: input.dayTotal, vacantFloor },
    });
  }

  return out;
}

/** Estimated financial impact of an alert, in Rand. `tariffPerUnit` is per kL (water) or per kWh. */
export function estimateCost(
  utilityType: UtilityType,
  excessConsumption: number | null,
  tariffPerUnit: number | null,
): number | null {
  if (excessConsumption === null || tariffPerUnit === null || excessConsumption <= 0) return null;
  const units = utilityType === 'water' ? excessConsumption / 1000 : excessConsumption;
  return Math.round(units * tariffPerUnit * 100) / 100;
}
