import { describe, expect, it } from 'vitest';
import {
  billingPeriodContaining,
  bucketConsumption,
  classifyDecrease,
  computeIntervals,
  consumptionForChain,
  consumptionForPeriod,
  lastCompleteBillingPeriod,
  sastDateString,
  sastInstant,
  type MeterReadingPoint,
} from '../consumption';
import { reconcile } from '../reconciliation';
import { analyseDay, DEFAULT_THRESHOLDS, estimateCost } from '../anomalies';
import { decodeEm300Di, parseGenericJson, parseMilesight, parseShelly, AdapterError } from '../adapters';
import { bearerFrom, hashToken, issueToken, parseTokenPrefix, tokenMatchesHash } from '../tokens';

// Pure-engine tests for Smart Utility Monitoring (docs/SMART_UTILITY_ARCHITECTURE.md §3, §5–§7).

function pt(iso: string, raw: number, multiplier = 1, status: MeterReadingPoint['status'] = 'valid'): MeterReadingPoint {
  return { readAt: iso, rawValue: raw, value: raw * multiplier, multiplier, status };
}

describe('consumption engine', () => {
  it('computes consumption from validated cumulative differences', () => {
    const iv = computeIntervals([pt('2026-10-01T00:00Z', 100), pt('2026-10-01T01:00Z', 130), pt('2026-10-01T02:00Z', 130)]);
    expect(iv.map((i) => i.consumption)).toEqual([30, 0]);
    expect(iv.every((i) => i.kind === 'normal')).toBe(true);
  });

  it('ignores suspect/rejected readings and duplicate timestamps', () => {
    const iv = computeIntervals([
      pt('2026-10-01T00:00Z', 100),
      pt('2026-10-01T00:00Z', 100),
      pt('2026-10-01T01:00Z', 5, 1, 'suspect'),
      pt('2026-10-01T02:00Z', 150),
    ]);
    expect(iv).toHaveLength(1);
    expect(iv[0]!.consumption).toBe(50);
  });

  it('treats a plausible wrap of a 5-digit register as a rollover, not negative consumption', () => {
    // 99,990 → 00,015 on a 5-digit register = 25 units
    expect(classifyDecrease(99990, 15, { registerDigits: 5 })).toEqual({ kind: 'rollover', rawDelta: 25 });
    const iv = computeIntervals([pt('2026-10-01T00:00Z', 99990, 0.5), pt('2026-10-01T01:00Z', 15, 0.5)], { registerDigits: 5 });
    expect(iv[0]).toMatchObject({ kind: 'rollover', consumption: 12.5 });
  });

  it('treats a drop without a plausible rollover as a reset with UNKNOWN consumption (never negative)', () => {
    const iv = computeIntervals([pt('2026-10-01T00:00Z', 5000), pt('2026-10-01T01:00Z', 3)], { registerDigits: null });
    expect(iv[0]).toMatchObject({ kind: 'reset', consumption: null });
    // a huge "wrap" (>50 % of span) is also a reset
    expect(classifyDecrease(10, 9, { registerDigits: 5 }).kind).toBe('reset');
  });

  it('re-baselines after a reset: later intervals count from the new value', () => {
    const iv = computeIntervals([pt('2026-10-01T00:00Z', 5000), pt('2026-10-01T01:00Z', 3), pt('2026-10-01T02:00Z', 10)]);
    expect(iv.map((i) => i.consumption)).toEqual([null, 7]);
  });

  it('handles a multiplier change without reinterpreting history', () => {
    // pulses at 1 L/pulse, then reconfigured to 0.5 L/pulse with the counter continuing
    const iv = computeIntervals([pt('2026-10-01T00:00Z', 100, 1), pt('2026-10-01T01:00Z', 120, 1), pt('2026-10-01T02:00Z', 140, 0.5)]);
    expect(iv[0]!.consumption).toBe(20);
    // value 120 → 70 while raw rose: ambiguous, flagged rather than negative
    expect(iv[1]).toMatchObject({ kind: 'reset', consumption: null });
  });

  it('interpolates period boundaries between readings (complete quality)', () => {
    const r = consumptionForPeriod(
      [pt('2026-09-30T22:00Z', 1000), pt('2026-10-01T02:00Z', 1040), pt('2026-10-31T20:00Z', 4040), pt('2026-11-01T00:00Z', 4080)],
      new Date('2026-10-01T00:00Z'),
      new Date('2026-10-31T22:00Z'),
    );
    // start C = 20 (halfway 1000→1040), end C = 3060 (halfway 4040→4080) → 3040
    expect(r.consumption).toBe(3040);
    expect(r.quality).toBe('complete');
  });

  it('falls back to readings inside the period when a boundary gap is too long (partial)', () => {
    const r = consumptionForPeriod(
      [pt('2026-08-01T00:00Z', 0), pt('2026-10-05T00:00Z', 100), pt('2026-10-20T00:00Z', 400)],
      new Date('2026-10-01T00:00Z'),
      new Date('2026-11-01T00:00Z'),
    );
    expect(r).toMatchObject({ consumption: 300, quality: 'partial' });
  });

  it('reports insufficient data instead of guessing', () => {
    expect(consumptionForPeriod([pt('2026-10-05T00:00Z', 1)], new Date('2026-10-01'), new Date('2026-11-01')).quality).toBe(
      'insufficient',
    );
  });

  it('flags a reset inside the period as partial', () => {
    const r = consumptionForPeriod(
      [pt('2026-10-01T00:00Z', 500), pt('2026-10-10T00:00Z', 900), pt('2026-10-11T00:00Z', 2), pt('2026-10-31T00:00Z', 102)],
      new Date('2026-10-01T00:00Z'),
      new Date('2026-10-31T00:00Z'),
    );
    expect(r.resetInPeriod).toBe(true);
    expect(r.quality).toBe('partial');
    expect(r.consumption).toBe(500); // 400 before the reset + 100 after; the reset interval itself is unknown
  });

  it('sums a meter replacement chain without a bogus delta across the swap', () => {
    const oldMeter = [pt('2026-10-01T00:00Z', 9000), pt('2026-10-15T00:00Z', 9500)];
    const newMeter = [pt('2026-10-15T02:00Z', 0), pt('2026-10-31T00:00Z', 300)];
    const r = consumptionForChain(
      [
        { points: oldMeter, config: {} },
        { points: newMeter, config: {} },
      ],
      new Date('2026-10-01T00:00Z'),
      new Date('2026-10-31T00:00Z'),
    );
    expect(r.consumption).toBe(800);
    expect(r.quality).toBe('partial');
  });

  it('buckets hourly consumption and leaves unknown buckets null', () => {
    const pts = [pt('2026-10-01T00:00Z', 0), pt('2026-10-01T01:00Z', 10), pt('2026-10-01T02:00Z', 30)];
    const b = bucketConsumption(pts, new Date('2026-10-01T00:00Z'), new Date('2026-10-01T03:00Z'), 60);
    expect(b.map((x) => x.consumption)).toEqual([10, 20, null]);
  });
});

describe('billing periods (SAST, configurable billing day)', () => {
  it('uses the billing day, not the calendar month end', () => {
    const p = billingPeriodContaining(new Date('2026-10-08T10:00Z'), 25);
    expect(p.start.toISOString()).toBe(sastInstant(2026, 9, 25).toISOString());
    expect(p.end.toISOString()).toBe(sastInstant(2026, 10, 25).toISOString());
    expect(sastInstant(2026, 10, 25).toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });

  it('rolls across the year boundary', () => {
    const p = lastCompleteBillingPeriod(new Date('2027-01-10T10:00Z'), 15);
    expect(sastDateString(p.start)).toBe('2026-11-15');
    expect(sastDateString(p.end)).toBe('2026-12-15');
  });

  it('treats 23:30 UTC as the next SAST day', () => {
    expect(sastDateString(new Date('2026-10-24T23:30Z'))).toBe('2026-10-25');
  });
});

describe('main vs submeter reconciliation', () => {
  it('reproduces the brief: 100 kL main, 90 kL of units → 10 kL (10 %) unallocated', () => {
    const r = reconcile({
      main: { meterId: 'main', consumption: 100_000, quality: 'complete' },
      submeters: [
        { meterId: 'a', label: 'Unit A', consumption: 20_000, quality: 'complete' },
        { meterId: 'b', label: 'Unit B', consumption: 25_000, quality: 'complete' },
        { meterId: 'c', label: 'Unit C', consumption: 30_000, quality: 'complete' },
        { meterId: 'd', label: 'Unit D', consumption: 15_000, quality: 'complete' },
      ],
      thresholdPct: 15,
    });
    expect(r.submeterTotal).toBe(90_000);
    expect(r.unallocated).toBe(10_000);
    expect(r.unallocatedPct).toBe(10);
    expect(r.status).toBe('within_threshold');
  });

  it('is above threshold when unallocated exceeds the configured percentage', () => {
    const r = reconcile({
      main: { meterId: 'm', consumption: 100, quality: 'complete' },
      submeters: [{ meterId: 'a', label: 'A', consumption: 80, quality: 'complete' }],
      thresholdPct: 15,
    });
    expect(r.status).toBe('above_threshold');
  });

  it('reports submeters exceeding the main as a data-quality status, not an alert about tenants', () => {
    const r = reconcile({
      main: { meterId: 'm', consumption: 100, quality: 'complete' },
      submeters: [{ meterId: 'a', label: 'A', consumption: 120, quality: 'complete' }],
      thresholdPct: 15,
    });
    expect(r.status).toBe('submeters_exceed_main');
  });

  it('refuses to compare when a submeter has no figure', () => {
    const r = reconcile({
      main: { meterId: 'm', consumption: 100, quality: 'complete' },
      submeters: [
        { meterId: 'a', label: 'Unit A', consumption: 50, quality: 'complete' },
        { meterId: 'b', label: 'Unit B', consumption: null, quality: 'insufficient' },
      ],
      thresholdPct: 15,
    });
    expect(r.status).toBe('insufficient_data');
    expect(r.missing).toEqual(['Unit B']);
  });
});

describe('rule-based anomalies', () => {
  const base = {
    meterLabel: 'Unit A water meter',
    history: [100, 110, 90, 105, 95, 100, 102],
    unitVacant: false,
    thresholds: DEFAULT_THRESHOLDS,
  };

  it('flags continuous overnight water flow as a POSSIBLE leak with the numbers attached', () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h < 5 ? 12 : 20));
    const alerts = analyseDay({ ...base, utilityType: 'water', hourly, dayTotal: 400 });
    const leak = alerts.find((a) => a.rule === 'water_continuous_night_flow');
    expect(leak).toBeDefined();
    expect(leak!.title).toMatch(/Possible leak/);
    expect(leak!.details.minHour).toBe(12);
  });

  it('does not flag night flow when any night hour is zero', () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 3 ? 0 : 12));
    expect(analyseDay({ ...base, utilityType: 'water', hourly, dayTotal: 100 }).some((a) => a.rule === 'water_continuous_night_flow')).toBe(false);
  });

  it('flags a spike against the trailing median with an absolute floor', () => {
    expect(analyseDay({ ...base, utilityType: 'water', hourly: [], dayTotal: 1000 }).map((a) => a.rule)).toContain('consumption_spike');
    // 3.5× but under the 200 L floor
    expect(analyseDay({ ...base, history: [10, 10, 10, 10, 10], utilityType: 'water', hourly: [], dayTotal: 35 })).toHaveLength(0);
  });

  it('flags consumption in a vacant unit', () => {
    expect(
      analyseDay({ ...base, unitVacant: true, utilityType: 'electricity', hourly: [], dayTotal: 6, history: [] }).map((a) => a.rule),
    ).toEqual(['vacant_unit_consumption']);
  });

  it('flags a high overnight electricity base load', () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h < 5 ? 1.0 : 1.2));
    expect(analyseDay({ ...base, utilityType: 'electricity', hourly, dayTotal: 27, history: [] }).map((a) => a.rule)).toContain(
      'electricity_night_base_load',
    );
  });

  it('estimates cost from the tariff (water tariff per kL)', () => {
    expect(estimateCost('water', 2500, 40)).toBe(100);
    expect(estimateCost('electricity', 10, 3.5)).toBe(35);
    expect(estimateCost('water', 2500, null)).toBeNull();
  });
});

describe('provider adapters', () => {
  // 01 75 5C (battery 92) | 05 C8 10 27 00 00 (pulse 10000)
  const em300Bytes = Uint8Array.from([0x01, 0x75, 0x5c, 0x05, 0xc8, 0x10, 0x27, 0x00, 0x00]);

  it('decodes an EM300-DI pulse frame per the vendor decoder layout', () => {
    expect(decodeEm300Di(em300Bytes)).toMatchObject({ battery: 92, pulse: 10000 });
  });

  it('decodes EM300-DI history records (0x20 0xCE, mode 2)', () => {
    const ts = 1_790_000_000;
    const rec = [0x20, 0xce, ts & 0xff, (ts >> 8) & 0xff, (ts >> 16) & 0xff, (ts >>> 24) & 0xff, 0, 0, 0, 2, 0, 0x64, 0, 0, 0];
    expect(decodeEm300Di(Uint8Array.from(rec)).history).toEqual([{ timestamp: ts, pulse: 100 }]);
  });

  it('parses a Milesight network-server uplink with raw base64 data', () => {
    const readings = parseMilesight(
      { devEUI: '24e124136b000001', fCnt: 7, time: '2026-10-08T10:00:00Z', data: Buffer.from(em300Bytes).toString('base64') },
      new Date(),
    );
    expect(readings).toEqual([
      expect.objectContaining({ externalDeviceId: '24E124136B000001', rawValue: 10000, channel: '' }),
    ]);
    expect(readings[0]!.eventId).toContain(':fcnt:7:');
  });

  it('prefers a gateway-decoded object', () => {
    const r = parseMilesight({ devEUI: '24E124136B000001', object: { pulse: 42 } }, new Date('2026-10-08T00:00Z'));
    expect(r[0]!.rawValue).toBe(42);
  });

  it('rejects a Milesight uplink without devEUI or counter', () => {
    expect(() => parseMilesight({ data: 'AA==' }, new Date())).toThrow(AdapterError);
    expect(() => parseMilesight({ devEUI: '24E124136B000001', object: { temperature: 20 } }, new Date())).toThrow(AdapterError);
  });

  it('parses Shelly EMData / EM1Data / Input counters (direct or NotifyStatus shape)', () => {
    const r = parseShelly(
      { src: 'shellypro3em-abc123', params: { ts: 1_790_000_000, 'emdata:0': { total_act: 12345.6, a_total_act_energy: 4000 }, 'em1data:1': { total_act_energy: 77 } } },
      new Date(),
    );
    expect(r.map((x) => [x.channel, x.rawValue])).toEqual([
      ['total', 12345.6],
      ['a', 4000],
      ['em1:1', 77],
    ]);
    expect(parseShelly({ src: 'shellyplusuni-1', 'input:0': { counts: { total: 9 } } }, new Date())[0]!.channel).toBe('input:0');
  });

  it('validates generic JSON readings', () => {
    expect(parseGenericJson({ readings: [{ deviceId: 'sdm-1', channel: 'kwh', value: 10.5, readAt: '2026-10-08T08:00:00+02:00' }] }, new Date())[0]).toMatchObject({
      externalDeviceId: 'sdm-1',
      rawValue: 10.5,
    });
    expect(() => parseGenericJson({ readings: [{ deviceId: 'x', value: -1 }] }, new Date())).toThrow(/non-negative/);
    expect(() => parseGenericJson({ readings: [{ deviceId: 'x', value: 1, readAt: 'not a date' }] }, new Date())).toThrow(/timestamp/);
    expect(() => parseGenericJson({}, new Date())).toThrow(AdapterError);
  });
});

describe('integration tokens', () => {
  it('issues tokens whose hash matches and whose prefix parses', () => {
    const t = issueToken();
    expect(parseTokenPrefix(t.token)).toBe(t.prefix);
    expect(tokenMatchesHash(t.token, t.hash)).toBe(true);
    expect(hashToken(t.token)).toBe(t.hash);
  });

  it('rejects tampered or malformed tokens', () => {
    const t = issueToken();
    expect(tokenMatchesHash(`${t.token}x`, t.hash)).toBe(false);
    expect(tokenMatchesHash(t.token, null)).toBe(false);
    expect(parseTokenPrefix('pmi_short_abc')).toBeNull();
    expect(bearerFrom('Bearer abc')).toBe('abc');
    expect(bearerFrom('Basic abc')).toBeNull();
  });
});
