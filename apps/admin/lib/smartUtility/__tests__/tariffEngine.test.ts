import { describe, expect, it } from 'vitest';
import { allocateCents, divRound, lineCents, toScaled, vatSplit } from '../money';
import { computeTariffCharge, validateTariff, type TariffV2 } from '../tariffEngine';
import { sastInstant } from '../consumption';

// All rates below are ILLUSTRATIVE (shaped like SA municipal/Eskom structures), never real tariffs.

const base: TariffV2 = {
  name: 'Illustrative water 2026/27',
  kind: 'block',
  utilityType: 'water',
  fixedCharge: 0,
  blocks: [
    { upTo: 6, rate: 25.12 },
    { upTo: 10.5, rate: 36.48 },
    { upTo: 35, rate: 51.77 },
    { upTo: null, rate: 78.31 },
  ],
  touPeriods: [],
  seasons: [],
  vatInclusive: false,
  vatRate: 15,
  prorateBlocks: true,
};
const OCT = { segmentStart: sastInstant(2026, 9, 25), segmentEnd: sastInstant(2026, 10, 25), periodDays: 30 };

describe('money (decimal-safe)', () => {
  it('parses decimals exactly and rounds half-up', () => {
    expect(toScaled('0.1') + toScaled('0.2')).toBe(toScaled('0.3')); // no 0.30000000000000004
    expect(toScaled(1.0000005)).toBe(1_000_001n);
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    // 12.345 kL × R 36.48 = R 450.3456 → 45 035 cents
    expect(lineCents(toScaled('12.345'), toScaled('36.48'))).toBe(45_035n);
  });

  it('splits VAT both ways and the parts always add up', () => {
    expect(vatSplit(11_500n, true, 15)).toEqual({ excl: 10_000n, vat: 1_500n, incl: 11_500n });
    expect(vatSplit(10_000n, false, 15)).toEqual({ excl: 10_000n, vat: 1_500n, incl: 11_500n });
    const odd = vatSplit(1_001n, true, 15); // R10.01 incl
    expect(odd.excl + odd.vat).toBe(1_001n);
    expect(odd.excl).toBe(870n);
  });

  it('allocates cents exactly by weight (largest remainder)', () => {
    expect(allocateCents(10_000n, [1n, 1n, 1n])).toEqual([3_334n, 3_333n, 3_333n]);
    const parts = allocateCents(123_457n, [45n, 30n, 25n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(123_457n);
    expect(allocateCents(500n, [0n, 0n])).toEqual([0n, 0n]);
  });
});

describe('block tariffs', () => {
  it('charges stepped blocks with VAT added (exclusive rates)', () => {
    // 12 kL: 6×25.12=150.72, 4.5×36.48=164.16, 1.5×51.77=77.655→77.66  = 392.54 excl
    const r = computeTariffCharge(base, { ...OCT, consumption: 12 });
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.exclCents)).toEqual([15_072, 16_416, 7_766]);
    expect(r.totals.exclCents).toBe(39_254);
    expect(r.totals.vatCents).toBe(Math.round(15_072 * 0.15) + Math.round(16_416 * 0.15) + Math.round(7_766 * 0.15));
    expect(r.totals.inclCents).toBe(r.totals.exclCents + r.totals.vatCents);
  });

  it('treats VAT-inclusive rates as gross and backs VAT out', () => {
    const r = computeTariffCharge({ ...base, vatInclusive: true, blocks: [{ upTo: null, rate: 28.75 }] }, { ...OCT, consumption: 10 });
    expect(r.totals).toEqual({ exclCents: 25_000, vatCents: 3_750, inclCents: 28_750 });
  });

  it('prorates fixed charge and block limits for a move-in part-way through the period', () => {
    const t = { ...base, fixedCharge: 90 };
    // 10 of 30 days: fixed R30; first block becomes 2 kL, second up to 3.5 kL
    const r = computeTariffCharge(t, { segmentStart: sastInstant(2026, 10, 15), segmentEnd: sastInstant(2026, 10, 25), periodDays: 30, consumption: 4 });
    expect(r.prorationFactor).toBeCloseTo(1 / 3, 6);
    const fixed = r.lines.find((l) => l.kind === 'fixed')!;
    expect(fixed.exclCents).toBe(3_000);
    const usage = r.lines.filter((l) => l.kind === 'usage');
    expect(usage.map((l) => l.quantity)).toEqual([2, 1.5, 0.5]);
  });

  it('applies an included allowance before the blocks', () => {
    const r = computeTariffCharge({ ...base, blocks: [{ upTo: null, rate: 30 }] }, { ...OCT, consumption: 8, allowanceQuantity: 6 });
    expect(r.lines.find((l) => l.kind === 'allowance')!.quantity).toBe(6);
    expect(r.totals.exclCents).toBe(6_000); // 2 kL × R30
  });

  it('refuses to price unknown consumption instead of guessing', () => {
    const r = computeTariffCharge(base, { ...OCT, consumption: null });
    expect(r.ok).toBe(false);
    expect(r.refusal).toMatch(/could not be calculated/);
  });

  it('splits seasons by daily consumption share and prorates block limits per season', () => {
    const seasonal: TariffV2 = {
      ...base,
      blocks: [{ upTo: null, rate: 10 }],
      seasons: [{ name: 'Winter', months: [6, 7, 8], blocks: [{ upTo: null, rate: 20 }] }],
    };
    // 31 Jul – 2 Aug SAST... use 1–3 Sep vs 30–31 Aug: two days in winter (Aug 30, 31) and one in summer (Sep 1)
    const start = sastInstant(2026, 8, 30);
    const end = sastInstant(2026, 9, 2);
    const r = computeTariffCharge(seasonal, {
      segmentStart: start,
      segmentEnd: end,
      periodDays: 3,
      consumption: 6,
      daily: [
        { date: '2026-08-30', value: 1 },
        { date: '2026-08-31', value: 2 },
        { date: '2026-09-01', value: 3 },
      ],
    });
    const byLabel = Object.fromEntries(r.lines.map((l) => [l.label, l.exclCents]));
    expect(byLabel['Winter season']).toBe(6_000); // 3 kL × R20
    expect(byLabel['Usage']).toBe(3_000); // 3 kL × R10
  });

  it('flags cost recovery for contractual and regulatory review', () => {
    const r = computeTariffCharge({ ...base, kind: 'cost_recovery', utilityType: 'electricity', blocks: [{ upTo: null, rate: 2.1 }] }, { ...OCT, consumption: 100 });
    expect(r.flags).toContain('cost_recovery_requires_contract_and_regulatory_review');
    expect(r.totals.exclCents).toBe(21_000);
  });

  it('charges nothing for prepaid pass-through and only the fixed part for fixed-only', () => {
    expect(computeTariffCharge({ ...base, kind: 'prepaid_passthrough' }, { ...OCT, consumption: 99 }).totals.inclCents).toBe(0);
    const f = computeTariffCharge({ ...base, kind: 'fixed_only', fixedCharge: 115, vatInclusive: true }, { ...OCT, consumption: null });
    expect(f.ok).toBe(true);
    expect(f.totals.inclCents).toBe(11_500);
  });
});

describe('time-of-use tariffs', () => {
  const tou: TariffV2 = {
    ...base,
    name: 'Illustrative TOU',
    kind: 'tou',
    utilityType: 'electricity',
    blocks: [],
    touPeriods: [
      { name: 'Peak', rate: 5, windows: [{ days: 'weekday', from: '07:00', to: '10:00' }, { days: 'weekday', from: '18:00', to: '20:00' }] },
      { name: 'Standard', rate: 3, windows: [{ days: 'weekday', from: '06:00', to: '07:00' }, { days: 'weekday', from: '10:00', to: '18:00' }, { days: 'weekday', from: '20:00', to: '22:00' }, { days: 'saturday', from: '07:00', to: '12:00' }, { days: 'saturday', from: '18:00', to: '20:00' }] },
      { name: 'Off-peak', rate: 1, windows: [{ days: 'weekday', from: '22:00', to: '06:00' }, { days: 'saturday', from: '00:00', to: '07:00' }, { days: 'saturday', from: '12:00', to: '18:00' }, { days: 'saturday', from: '20:00', to: '00:00' }, { days: 'sunday', from: '00:00', to: '00:00' }] },
    ],
  };

  it('validates that every half-hour of every day type is covered exactly once', () => {
    expect(validateTariff(tou)).toBeNull();
    const gap = { ...tou, touPeriods: tou.touPeriods.slice(0, 2) };
    expect(validateTariff(gap)).toMatch(/covered by 0 periods/);
  });

  it('prices hourly consumption by SAST weekday/weekend windows', () => {
    // Monday 2026-10-12 SAST: 1 kWh at 08:00 (peak), 1 kWh at 12:00 (standard), 1 kWh at 23:00 (off-peak); Sunday 1 kWh at 08:00 (off-peak)
    const h = (y: number, m: number, d: number, hour: number) => ({ start: sastInstant(y, m, d, hour), value: 1 });
    const r = computeTariffCharge(tou, {
      segmentStart: sastInstant(2026, 10, 11),
      segmentEnd: sastInstant(2026, 10, 13),
      periodDays: 2,
      consumption: 4,
      hourly: [h(2026, 10, 12, 8), h(2026, 10, 12, 12), h(2026, 10, 12, 23), h(2026, 10, 11, 8)],
    });
    expect(Object.fromEntries(r.lines.map((l) => [l.label, l.quantity]))).toEqual({ Peak: 1, Standard: 1, 'Off-peak': 2 });
    expect(r.totals.exclCents).toBe(500 + 300 + 200);
  });

  it('refuses TOU billing without complete hourly data', () => {
    const r = computeTariffCharge(tou, { ...OCT, consumption: 100, hourly: [] });
    expect(r.ok).toBe(false);
    expect(r.refusal).toMatch(/hourly readings/);
  });

  it('applies seasonal TOU rates (high-demand winter months)', () => {
    const seasonal: TariffV2 = {
      ...tou,
      seasons: [{ name: 'High-demand', months: [6, 7, 8], touPeriods: tou.touPeriods.map((p) => ({ ...p, rate: p.rate * 3 })) }],
    };
    const r = computeTariffCharge(seasonal, {
      segmentStart: sastInstant(2026, 7, 13),
      segmentEnd: sastInstant(2026, 7, 14),
      periodDays: 1,
      consumption: 1,
      hourly: [{ start: sastInstant(2026, 7, 13, 8), value: 1 }],
    });
    expect(r.lines[0]).toMatchObject({ label: 'High-demand Peak', exclCents: 1_500 });
  });
});
