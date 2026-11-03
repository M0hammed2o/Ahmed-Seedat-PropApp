import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from './data';

// Demo meter simulator (2026-11-03). Client demo organisations show Smart Utilities with fictional
// meters whose readings were seeded once; without new readings the daily health sweep marks every
// meter offline and the dashboards stop at the seed date. This step, run first in the daily
// Smart Utility job, continues each simulated meter's own recent pattern up to "now".
//
// It is deliberately narrow:
//   * only organisations listed in SIMULATED_DEMO_ORG_IDS -- adding one is a reviewed code change;
//   * only meters with connectivity 'simulator' and NO integration (never a physical device feed);
//   * the organisation is skipped entirely if it has any meter integration or an enabled municipal
//     submission schedule, so simulated data can never reach a municipality or a real device record;
//   * every row is source 'simulator' (shown as "Simulated (demo)") and carries SIMULATED_READING_NOTE;
//   * it writes only meter_telemetry_readings and the meter's last-reading bookkeeping -- no charges,
//     invoices, messages or submissions.
// Idempotent: readings are keyed (meter_id, read_at) and inserted with ON CONFLICT DO NOTHING.

/** Approved fictional demonstration organisations. NEVER add a real customer. */
export const SIMULATED_DEMO_ORG_IDS: readonly string[] = [
  // Fictional client demo organisation (docs kept outside the repo), approved by the owner 2026-11-03..
  '2b0262c0-6627-4565-b1a0-b7e2a6d0aad4',
];

export const SIMULATED_READING_NOTE =
  'Simulated demonstration reading -- not from a physical meter.';

/** Never backfill more than this in one run (a demo left idle for months restarts at the recent past). */
export const MAX_BACKFILL_DAYS = 14;

const MINUTE = 60_000;
const DAY = 1_440 * MINUTE;

export interface SimReading {
  readAt: Date;
  value: number;
}

/** Deterministic jitter in [0.9, 1.1] from a string key (FNV-1a), so a rerun produces the same values. */
function jitter(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 0.9 + ((h >>> 0) / 0xffffffff) * 0.2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Next cumulative readings for one meter, from just after its latest reading up to `now`.
 * Each step's increase copies the increase over the same slot one week earlier (keeping
 * day-of-week and time-of-day shape), scaled by +/-10% deterministic jitter; when that slot is
 * unknown the median recent increase is used. Readings never decrease.
 */
export function simulateMeterReadings(
  history: SimReading[],
  intervalMinutes: number,
  now: Date,
  seedKey: string,
): SimReading[] {
  if (history.length < 2 || !(intervalMinutes > 0)) return [];
  const step = intervalMinutes * MINUTE;
  const sorted = [...history].sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
  const byTime = new Map(sorted.map((r) => [r.readAt.getTime(), r.value]));

  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]!.readAt.getTime() - sorted[i - 1]!.readAt.getTime();
    const d = sorted[i]!.value - sorted[i - 1]!.value;
    if (gap === step && d >= 0) deltas.push(d);
  }
  deltas.sort((a, b) => a - b);
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)]! : 0;

  const last = sorted[sorted.length - 1]!;
  let t = last.readAt.getTime() + step;
  const earliest = now.getTime() - MAX_BACKFILL_DAYS * DAY;
  if (t < earliest) t += Math.ceil((earliest - t) / step) * step; // stay on the meter's own grid
  let value = last.value;

  const out: SimReading[] = [];
  for (; t <= now.getTime(); t += step) {
    const weekAgo = byTime.get(t - 7 * DAY);
    const weekAgoPrev = byTime.get(t - 7 * DAY - step);
    const base =
      weekAgo !== undefined && weekAgoPrev !== undefined && weekAgo >= weekAgoPrev
        ? weekAgo - weekAgoPrev
        : median;
    value = round2(value + Math.max(0, base * jitter(`${seedKey}:${t}`)));
    out.push({ readAt: new Date(t), value });
    byTime.set(t, value); // later steps (gaps over a week) can reference simulated values
  }
  return out;
}

export interface DemoSimulationResult {
  orgs: number;
  meters: number;
  inserted: number;
  skipped: { orgId: string; reason: string }[];
}

interface SimMeter {
  id: string;
  org_id: string;
  property_id: string;
  expected_interval_minutes: number;
  last_reading_at: string | null;
}

export async function runDemoMeterSimulation(
  serviceClient: SupabaseClient,
  now: Date,
  orgIds: readonly string[] = SIMULATED_DEMO_ORG_IDS,
): Promise<DemoSimulationResult> {
  const result: DemoSimulationResult = { orgs: 0, meters: 0, inserted: 0, skipped: [] };

  for (const orgId of orgIds) {
    const [org, integrations, submissions] = await Promise.all([
      serviceClient
        .from('organizations')
        .select('id, utilities_enabled')
        .eq('id', orgId)
        .maybeSingle(),
      serviceClient
        .from('meter_integrations')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId),
      serviceClient
        .from('municipal_submission_settings')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('enabled', true),
    ]);
    if (org.error || integrations.error || submissions.error) {
      throw new Error(
        `demo simulator guard query failed: ${(org.error ?? integrations.error ?? submissions.error)!.message}`,
      );
    }
    const skip = !org.data
      ? 'organisation not found'
      : !org.data.utilities_enabled
        ? 'Smart Utilities not enabled'
        : (integrations.count ?? 0) > 0
          ? 'has meter integrations (possible physical devices)'
          : (submissions.count ?? 0) > 0
            ? 'has an enabled municipal submission schedule'
            : null;
    if (skip) {
      result.skipped.push({ orgId, reason: skip });
      continue;
    }
    result.orgs += 1;

    const meters = await fetchAll<SimMeter>((f, t) =>
      serviceClient
        .from('utility_meters')
        .select('id, org_id, property_id, expected_interval_minutes, last_reading_at')
        .eq('org_id', orgId)
        .eq('connectivity', 'simulator')
        .is('integration_id', null)
        .eq('active', true)
        .not('expected_interval_minutes', 'is', null)
        .order('id')
        .range(f, t),
    );

    for (const meter of meters) {
      // Enough history for the week-ago pattern plus a full backfill window.
      const since = new Date(now.getTime() - (MAX_BACKFILL_DAYS + 8) * DAY).toISOString();
      const history = await fetchAll<{ read_at: string; value: number | string }>((f, t) =>
        serviceClient
          .from('meter_telemetry_readings')
          .select('read_at, value')
          .eq('meter_id', meter.id)
          .eq('source', 'simulator')
          .eq('status', 'valid')
          .gte('read_at', since)
          .order('read_at')
          .range(f, t),
      );
      const next = simulateMeterReadings(
        history.map((r) => ({ readAt: new Date(r.read_at), value: Number(r.value) })),
        meter.expected_interval_minutes,
        now,
        meter.id,
      );
      // Nothing due yet: still make sure the meter's bookkeeping reflects its latest stored reading
      // (seeded readings never set it, and the health sweep would call the meter offline).
      if (next.length === 0) {
        const last = history[history.length - 1];
        if (
          last &&
          (!meter.last_reading_at || Date.parse(meter.last_reading_at) < Date.parse(last.read_at))
        ) {
          await updateLastReading(serviceClient, orgId, meter.id, last.read_at, Number(last.value));
        }
        continue;
      }
      result.meters += 1;

      const { data: insertedRows, error: insertError } = await serviceClient
        .from('meter_telemetry_readings')
        .upsert(
          next.map((r) => ({
            org_id: meter.org_id,
            property_id: meter.property_id,
            meter_id: meter.id,
            read_at: r.readAt.toISOString(),
            raw_value: r.value,
            multiplier: 1,
            value: r.value,
            source: 'simulator',
            status: 'valid',
            verification_status: 'not_required',
            reading_purpose: 'routine',
            notes: SIMULATED_READING_NOTE,
          })),
          { onConflict: 'meter_id,read_at', ignoreDuplicates: true },
        )
        .select('id');
      if (insertError) throw new Error(`demo simulator insert failed: ${insertError.message}`);
      result.inserted += insertedRows?.length ?? 0;

      const latest = next[next.length - 1]!;
      await updateLastReading(
        serviceClient,
        orgId,
        meter.id,
        latest.readAt.toISOString(),
        latest.value,
      );
    }
  }
  return result;
}

async function updateLastReading(
  serviceClient: SupabaseClient,
  orgId: string,
  meterId: string,
  readAt: string,
  value: number,
) {
  const { error } = await serviceClient
    .from('utility_meters')
    .update({ last_reading_at: readAt, last_reading_value: value })
    .eq('id', meterId)
    .eq('org_id', orgId)
    .eq('connectivity', 'simulator');
  if (error) throw new Error(`demo simulator meter update failed: ${error.message}`);
}
