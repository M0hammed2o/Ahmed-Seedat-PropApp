import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_BACKFILL_DAYS,
  runDemoMeterSimulation,
  SIMULATED_DEMO_ORG_IDS,
  SIMULATED_READING_NOTE,
  simulateMeterReadings,
  type SimReading,
} from '../demoSimulator';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Hourly cumulative history: 3 units/hour at night (00-05), 10/hour by day, for `days` days. */
function hourlyHistory(end: Date, days: number): SimReading[] {
  const out: SimReading[] = [];
  let v = 1000;
  for (let t = end.getTime() - days * DAY; t <= end.getTime(); t += HOUR) {
    v += new Date(t).getUTCHours() < 6 ? 3 : 10;
    out.push({ readAt: new Date(t), value: v });
  }
  return out;
}

describe('simulateMeterReadings', () => {
  const lastAt = new Date('2026-11-03T11:00:00Z');
  const history = hourlyHistory(lastAt, 8);

  it('continues on the meter grid from the last reading up to now, never decreasing', () => {
    const now = new Date('2026-11-04T00:30:00Z');
    const next = simulateMeterReadings(history, 60, now, 'meter-1');
    expect(next[0]!.readAt.toISOString()).toBe('2026-11-03T12:00:00.000Z');
    expect(next.at(-1)!.readAt.toISOString()).toBe('2026-11-04T00:00:00.000Z');
    expect(next).toHaveLength(13);
    let prev = history.at(-1)!.value;
    for (const r of next) {
      expect(r.value).toBeGreaterThanOrEqual(prev);
      prev = r.value;
    }
  });

  it("follows last week's shape for the same hour, within +/-10%", () => {
    const now = new Date('2026-11-03T14:00:00Z');
    const next = simulateMeterReadings(history, 60, now, 'meter-1');
    const steps = next.map(
      (r, i) => r.value - (i === 0 ? history.at(-1)!.value : next[i - 1]!.value),
    );
    for (const d of steps) {
      expect(d).toBeGreaterThanOrEqual(9 - 0.01);
      expect(d).toBeLessThanOrEqual(11 + 0.01);
    }
  });

  it('is deterministic: a rerun produces identical readings', () => {
    const now = new Date('2026-11-04T09:00:00Z');
    expect(simulateMeterReadings(history, 60, now, 'meter-1')).toEqual(
      simulateMeterReadings(history, 60, now, 'meter-1'),
    );
  });

  it('produces nothing when already up to date, or without enough history', () => {
    expect(simulateMeterReadings(history, 60, new Date('2026-11-03T11:30:00Z'), 'm')).toEqual([]);
    expect(
      simulateMeterReadings(history.slice(-1), 60, new Date('2026-11-05T00:00:00Z'), 'm'),
    ).toEqual([]);
  });

  it(`backfills at most ${MAX_BACKFILL_DAYS} days after a long idle period, staying on the grid`, () => {
    const daily: SimReading[] = Array.from({ length: 10 }, (_, i) => ({
      readAt: new Date(Date.UTC(2026, 6, 1 + i, 22)),
      value: 500 + i * 20,
    }));
    const now = new Date('2026-11-03T23:00:00Z');
    const next = simulateMeterReadings(daily, 1440, now, 'daily');
    expect(next.length).toBeLessThanOrEqual(MAX_BACKFILL_DAYS + 1);
    expect(next.every((r) => r.readAt.getUTCHours() === 22)).toBe(true);
    expect(next.at(-1)!.readAt.toISOString()).toBe('2026-11-03T22:00:00.000Z');
    expect(next[0]!.value).toBeGreaterThan(daily.at(-1)!.value);
  });
});

// A tiny recording fake of the Supabase client for the database wrapper.
function fakeDb(state: {
  org?: { id: string; utilities_enabled: boolean } | null;
  integrations?: number;
  submissions?: number;
  meters?: Record<string, unknown>[];
  history?: { read_at: string; value: number }[];
}) {
  const writes: { table: string; op: string; payload: unknown; filters: [string, unknown][] }[] =
    [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let op = 'select';
    let payload: unknown;
    let head = false;
    const resolve = () => {
      if (op !== 'select') {
        writes.push({ table, op, payload, filters: [...filters] });
        return {
          data: op === 'upsert' ? (payload as unknown[]).map((_, i) => ({ id: i })) : null,
          error: null,
        };
      }
      if (table === 'organizations') return { data: state.org ?? null, error: null };
      if (table === 'meter_integrations')
        return { data: null, count: state.integrations ?? 0, error: null };
      if (table === 'municipal_submission_settings')
        return { data: null, count: state.submissions ?? 0, error: null };
      if (table === 'utility_meters') return { data: state.meters ?? [], error: null };
      if (table === 'meter_telemetry_readings') return { data: state.history ?? [], error: null };
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        if (['eq', 'is', 'neq', 'gte', 'not'].includes(name))
          filters.push([String(args[0]), args[1]]);
        if (name === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true;
        return b;
      };
    for (const n of ['select', 'eq', 'is', 'neq', 'gte', 'not', 'order']) b[n] = chain(n);
    b.upsert = (p: unknown) => ((op = 'upsert'), (payload = p), b);
    b.update = (p: unknown) => ((op = 'update'), (payload = p), b);
    b.range = () => Promise.resolve(resolve());
    b.maybeSingle = () => Promise.resolve(resolve());
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(ok, ko);
    void head;
    return b;
  };
  return { client: { from } as unknown as SupabaseClient, writes };
}

describe('runDemoMeterSimulation', () => {
  const now = new Date('2026-11-04T00:00:00Z');
  const history = hourlyHistory(new Date('2026-11-03T11:00:00Z'), 8).map((r) => ({
    read_at: r.readAt.toISOString(),
    value: r.value,
  }));
  const meter = {
    id: 'm1',
    org_id: 'org-demo',
    property_id: 'p1',
    expected_interval_minutes: 60,
  };

  it('only the one approved client demo organisation is on the allow-list', () => {
    expect(SIMULATED_DEMO_ORG_IDS).toEqual(['2b0262c0-6627-4565-b1a0-b7e2a6d0aad4']);
  });

  it('writes labelled simulator readings and the meter last-reading bookkeeping', async () => {
    const { client, writes } = fakeDb({
      org: { id: 'org-demo', utilities_enabled: true },
      meters: [meter],
      history,
    });
    const result = await runDemoMeterSimulation(client, now, ['org-demo']);
    expect(result).toMatchObject({ orgs: 1, meters: 1, inserted: 13, skipped: [] });
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual([
      'meter_telemetry_readings:upsert',
      'utility_meters:update',
    ]);
    const rows = writes[0]!.payload as Record<string, unknown>[];
    expect(rows.every((r) => r.source === 'simulator' && r.notes === SIMULATED_READING_NOTE)).toBe(
      true,
    );
    expect(rows.every((r) => r.org_id === 'org-demo' && r.meter_id === 'm1')).toBe(true);
    expect(writes[1]!.payload).toMatchObject({ last_reading_at: '2026-11-04T00:00:00.000Z' });
    expect(writes[1]!.filters).toEqual(
      expect.arrayContaining([
        ['org_id', 'org-demo'],
        ['connectivity', 'simulator'],
      ]),
    );
  });

  it.each([
    [{ org: null }, 'organisation not found'],
    [{ org: { id: 'org-demo', utilities_enabled: false } }, 'Smart Utilities not enabled'],
    [
      { org: { id: 'org-demo', utilities_enabled: true }, integrations: 1 },
      'has meter integrations (possible physical devices)',
    ],
    [
      { org: { id: 'org-demo', utilities_enabled: true }, submissions: 1 },
      'has an enabled municipal submission schedule',
    ],
  ])(
    'refuses an organisation that fails a guard and writes nothing (%#)',
    async (state, reason) => {
      const { client, writes } = fakeDb({ ...state, meters: [meter], history });
      const result = await runDemoMeterSimulation(client, now, ['org-demo']);
      expect(result.skipped).toEqual([{ orgId: 'org-demo', reason }]);
      expect(writes).toEqual([]);
    },
  );
});
