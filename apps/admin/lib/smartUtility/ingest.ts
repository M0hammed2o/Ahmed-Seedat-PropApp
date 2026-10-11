import 'server-only';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AdapterError, type NormalisedReading } from './adapters';
import { parsePush, type ProviderId } from './providers';
import { classifyDecrease } from './consumption';
import { parseTokenPrefix, tokenMatchesHash } from './tokens';

// Token-authenticated meter ingestion (docs/SMART_UTILITY_ARCHITECTURE.md §3). Always called with the
// service-role client: the bearer token -- not a user session -- is the credential, and it resolves
// the org/property. Nothing in the payload is trusted to name an org, property or meter.

export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
export const MAX_AGE_MS = 400 * 24 * 3_600_000;

export interface IntegrationRow {
  id: string;
  org_id: string;
  property_id: string;
  provider: ProviderId;
  status: 'active' | 'revoked';
  token_hash: string;
  previous_token_hash: string | null;
  previous_token_expires_at: string | null;
}

export type IntegrationAuthResult =
  | { ok: true; integration: IntegrationRow }
  | { ok: false; reason: 'missing_token' | 'invalid_token' | 'revoked' | 'utilities_disabled' };

/** Organisations with Smart Utilities switched off (migration 179). Absent column / error → treated as enabled. */
export async function disabledUtilityOrgs(serviceClient: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await serviceClient.from('organizations').select('id').eq('utilities_enabled', false).limit(10_000);
  if (error) return new Set();
  return new Set((data ?? []).map((o) => o.id as string));
}

async function orgUtilitiesEnabled(serviceClient: SupabaseClient, orgId: string): Promise<boolean> {
  const { data } = await serviceClient.from('organizations').select('utilities_enabled').eq('id', orgId).maybeSingle();
  return (data as { utilities_enabled?: boolean } | null)?.utilities_enabled !== false;
}

export async function authenticateIntegration(
  serviceClient: SupabaseClient,
  token: string | null,
  now: Date = new Date(),
): Promise<IntegrationAuthResult> {
  if (!token) return { ok: false, reason: 'missing_token' };
  const prefix = parseTokenPrefix(token);
  if (!prefix) return { ok: false, reason: 'invalid_token' };

  const columns =
    'id, org_id, property_id, provider, status, token_hash, previous_token_hash, previous_token_expires_at';
  const { data: current } = await serviceClient
    .from('meter_integrations')
    .select(columns)
    .eq('token_prefix', prefix)
    .maybeSingle();
  if (current && tokenMatchesHash(token, current.token_hash)) {
    if (current.status !== 'active') return { ok: false, reason: 'revoked' };
    if (!(await orgUtilitiesEnabled(serviceClient, current.org_id))) return { ok: false, reason: 'utilities_disabled' };
    return { ok: true, integration: current as IntegrationRow };
  }

  // Rotation grace: the previous token keeps working until previous_token_expires_at.
  const { data: previous } = await serviceClient
    .from('meter_integrations')
    .select(columns)
    .eq('previous_token_prefix', prefix)
    .maybeSingle();
  if (
    previous &&
    previous.previous_token_expires_at &&
    new Date(previous.previous_token_expires_at).getTime() > now.getTime() &&
    tokenMatchesHash(token, previous.previous_token_hash)
  ) {
    if (previous.status !== 'active') return { ok: false, reason: 'revoked' };
    if (!(await orgUtilitiesEnabled(serviceClient, previous.org_id))) return { ok: false, reason: 'utilities_disabled' };
    return { ok: true, integration: previous as IntegrationRow };
  }
  return { ok: false, reason: 'invalid_token' };
}

interface MeterRow {
  id: string;
  org_id: string;
  property_id: string;
  utility_type: 'water' | 'electricity';
  external_device_id: string;
  external_channel: string;
  multiplier: number;
  value_offset: number;
  register_digits: number | null;
  last_reading_at: string | null;
}

interface SourceSensorRow {
  id: string;
  org_id: string;
  property_id: string;
  external_device_id: string;
  external_channel: string;
  level_metric: string;
}

export interface IngestRejection {
  deviceId: string;
  channel: string;
  readAt: string | null;
  reason:
    | 'unknown_device'
    | 'future_timestamp'
    | 'too_old'
    | 'invalid_value'
    | 'payload_invalid';
  detail?: string;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  suspect: number;
  /** Readings for a bound device on a channel no meter uses (e.g. a codec's battery field). */
  ignored: number;
  rejected: IngestRejection[];
}

export interface IngestInput {
  integration: IntegrationRow;
  body: unknown;
  sourceIp?: string | null;
  now?: Date;
  /** URL query parameters of the push (ChirpStack sends ?event=up). */
  query?: URLSearchParams;
}

export async function ingestPayload(
  serviceClient: SupabaseClient,
  input: IngestInput,
): Promise<IngestResult> {
  const now = input.now ?? new Date();
  const { integration } = input;
  const result: IngestResult = { accepted: 0, duplicates: 0, suspect: 0, ignored: 0, rejected: [] };

  let readings: NormalisedReading[];
  try {
    readings = parsePush(integration.provider, input.body, now, input.query);
  } catch (err) {
    const detail = err instanceof AdapterError ? err.message : 'Unparseable payload';
    result.rejected.push({ deviceId: '', channel: '', readAt: null, reason: 'payload_invalid', detail });
    await logIngestEvent(serviceClient, integration, result, input.sourceIp);
    return result;
  }
  return storeReadings(serviceClient, integration, readings, { now, sourceIp: input.sourceIp });
}

/**
 * The one validate-and-store path for normalised readings, shared by push ingestion (above) and
 * scheduled polling (sync.ts): device binding, timestamp window, monotonicity/rollover/reset,
 * idempotent insert, meter + integration bookkeeping, and the ingest log row.
 */
export async function storeReadings(
  serviceClient: SupabaseClient,
  integration: IntegrationRow,
  readings: NormalisedReading[],
  opts: { now?: Date; sourceIp?: string | null; source?: 'device' | 'simulator' } = {},
): Promise<IngestResult> {
  const now = opts.now ?? new Date();
  const result: IngestResult = { accepted: 0, duplicates: 0, suspect: 0, ignored: 0, rejected: [] };

  // Resolve meters for every device/channel in ONE query, scoped to this integration only -- a
  // device id belonging to another org/integration can never match.
  const deviceIds = [...new Set(readings.map((r) => r.externalDeviceId))];
  const { data: meterRows, error: meterError } = await serviceClient
    .from('utility_meters')
    .select(
      'id, org_id, property_id, utility_type, external_device_id, external_channel, multiplier, value_offset, register_digits, last_reading_at',
    )
    .eq('integration_id', integration.id)
    .eq('org_id', integration.org_id)
    .eq('property_id', integration.property_id)
    .eq('active', true)
    .in('external_device_id', deviceIds.length ? deviceIds : ['__none__']);
  if (meterError) throw new Error(`meter lookup failed: ${meterError.message}`);

  const meterByKey = new Map<string, MeterRow>();
  const boundDevices = new Set<string>();
  for (const m of (meterRows ?? []) as MeterRow[]) {
    meterByKey.set(`${m.external_device_id}\u0000${m.external_channel}`, m);
    boundDevices.add(m.external_device_id);
  }

  // Level sensors (tank level, battery SoC, fuel level) bound to supply sources on the same integration.
  const sourceByKey = new Map<string, SourceSensorRow>();
  if (readings.some((r) => !meterByKey.has(`${r.externalDeviceId}\u0000${r.channel}`))) {
    const { data: sourceRows, error: sourceError } = await serviceClient
      .from('utility_supply_sources')
      .select('id, org_id, property_id, external_device_id, external_channel, level_metric')
      .eq('integration_id', integration.id)
      .eq('org_id', integration.org_id)
      .eq('property_id', integration.property_id)
      .eq('active', true)
      .not('level_metric', 'is', null)
      .in('external_device_id', deviceIds.length ? deviceIds : ['__none__']);
    if (sourceError) throw new Error(`source lookup failed: ${sourceError.message}`);
    for (const s of (sourceRows ?? []) as SourceSensorRow[]) {
      sourceByKey.set(`${s.external_device_id}\u0000${s.external_channel}`, s);
      boundDevices.add(s.external_device_id);
    }
  }

  // Validate and group per meter.
  const perMeter = new Map<string, { meter: MeterRow; items: NormalisedReading[] }>();
  const levelRows: Record<string, unknown>[] = [];
  for (const r of readings) {
    const meter = meterByKey.get(`${r.externalDeviceId}\u0000${r.channel}`);
    const base = { deviceId: r.externalDeviceId, channel: r.channel, readAt: r.readAt.toISOString() };
    const sensor = meter ? undefined : sourceByKey.get(`${r.externalDeviceId}\u0000${r.channel}`);
    if (!meter && !sensor) {
      // A known device reporting an unbound field (battery, temperature …) is normal, not an attack.
      if (boundDevices.has(r.externalDeviceId)) result.ignored += 1;
      else result.rejected.push({ ...base, reason: 'unknown_device' });
      continue;
    }
    if (r.readAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
      result.rejected.push({ ...base, reason: 'future_timestamp' });
      continue;
    }
    if (r.readAt.getTime() < now.getTime() - MAX_AGE_MS) {
      result.rejected.push({ ...base, reason: 'too_old' });
      continue;
    }
    if (!Number.isFinite(r.rawValue) || r.rawValue < 0 || r.rawValue > 1e13) {
      result.rejected.push({ ...base, reason: 'invalid_value' });
      continue;
    }
    if (sensor) {
      // Instant level, not a cumulative register: no monotonicity rules; percentages are capped at 100.
      if (sensor.level_metric.endsWith('_pct') && r.rawValue > 100) {
        result.rejected.push({ ...base, reason: 'invalid_value', detail: 'percentage above 100' });
        continue;
      }
      levelRows.push({
        org_id: sensor.org_id,
        property_id: sensor.property_id,
        source_id: sensor.id,
        metric: sensor.level_metric,
        read_at: r.readAt.toISOString(),
        value: Math.round(r.rawValue * 1000) / 1000,
        source: opts.source ?? (integration.provider === 'simulator' ? 'simulator' : 'device'),
        integration_id: integration.id,
        external_event_id: r.eventId,
      });
      continue;
    }
    if (!meter) continue;
    const group = perMeter.get(meter.id) ?? { meter, items: [] };
    group.items.push(r);
    perMeter.set(meter.id, group);
  }

  for (const { meter, items } of perMeter.values()) {
    items.sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
    const multiplier = Number(meter.multiplier);
    const offset = Number(meter.value_offset ?? 0);
    const toValue = (raw: number) => Math.round((raw * multiplier + offset) * 10_000) / 10_000;

    // Previous stored reading before the earliest incoming one: the monotonicity baseline.
    const { data: prevRow } = await serviceClient
      .from('meter_telemetry_readings')
      .select('raw_value, read_at')
      .eq('meter_id', meter.id)
      .eq('status', 'valid')
      .lt('read_at', items[0]!.readAt.toISOString())
      .order('read_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    let prevRaw: number | null = prevRow ? Number(prevRow.raw_value) : null;
    let latestAccepted: { at: Date; value: number } | null = null;

    for (const r of items) {
      let status: 'valid' | 'suspect' = 'valid';
      let statusReason: string | null = null;
      if (prevRaw !== null && r.rawValue < prevRaw) {
        const decision = classifyDecrease(prevRaw, r.rawValue, { registerDigits: meter.register_digits });
        if (decision.kind === 'reset') {
          status = 'suspect';
          statusReason = `reset_suspected: register fell from ${prevRaw} to ${r.rawValue}`;
        } else {
          statusReason = 'register_rollover';
        }
      }

      const { error } = await serviceClient.from('meter_telemetry_readings').insert({
        org_id: meter.org_id,
        property_id: meter.property_id,
        meter_id: meter.id,
        read_at: r.readAt.toISOString(),
        raw_value: r.rawValue,
        multiplier,
        value: toValue(r.rawValue),
        source: opts.source ?? (integration.provider === 'simulator' ? 'simulator' : 'device'),
        integration_id: integration.id,
        external_event_id: r.eventId,
        status,
        status_reason: statusReason,
      });
      if (error) {
        if (error.code === '23505') {
          result.duplicates += 1;
          continue;
        }
        throw new Error(`telemetry insert failed: ${error.message}`);
      }

      if (status === 'suspect') {
        result.suspect += 1;
        await raiseResetAlert(serviceClient, meter, r, prevRaw);
        // A reset re-baselines the series: later readings compare against the new value.
      } else {
        result.accepted += 1;
      }
      prevRaw = r.rawValue;
      if (!latestAccepted || r.readAt > latestAccepted.at) {
        latestAccepted = { at: r.readAt, value: toValue(r.rawValue) };
      }
    }

    if (latestAccepted) {
      const update: Record<string, unknown> = {
        last_sync_at: now.toISOString(),
        health_status: 'online',
      };
      if (!meter.last_reading_at || latestAccepted.at.getTime() > new Date(meter.last_reading_at).getTime()) {
        update.last_reading_at = latestAccepted.at.toISOString();
        update.last_reading_value = Math.round(latestAccepted.value * 10_000) / 10_000;
      }
      await serviceClient.from('utility_meters').update(update).eq('id', meter.id);
    }
  }

  for (const row of levelRows) {
    const { error } = await serviceClient.from('utility_source_readings').insert(row);
    if (error) {
      if (error.code === '23505') {
        result.duplicates += 1;
        continue;
      }
      throw new Error(`source reading insert failed: ${error.message}`);
    }
    result.accepted += 1;
  }

  await serviceClient
    .from('meter_integrations')
    .update({ last_seen_at: now.toISOString() })
    .eq('id', integration.id);
  await logIngestEvent(serviceClient, integration, result, opts.sourceIp);
  return result;
}

async function raiseResetAlert(
  serviceClient: SupabaseClient,
  meter: MeterRow,
  reading: NormalisedReading,
  prevRaw: number | null,
) {
  const day = reading.readAt.toISOString().slice(0, 10);
  await serviceClient.from('utility_alerts').upsert(
    {
      org_id: meter.org_id,
      property_id: meter.property_id,
      meter_id: meter.id,
      utility_type: meter.utility_type,
      rule: 'meter_reset_detected',
      severity: 'warning',
      title: 'Meter register went backwards',
      message:
        `A reading of ${reading.rawValue} arrived after ${prevRaw ?? 'an earlier, higher reading'}. ` +
        'This usually means the meter or pulse counter was reset or replaced. Consumption across the reset is shown as unknown until you confirm what happened (record a meter replacement if the meter was swapped).',
      period_start: reading.readAt.toISOString(),
      details: { previousRaw: prevRaw, newRaw: reading.rawValue },
      dedupe_key: `reset:${meter.id}:${day}`,
    },
    { onConflict: 'dedupe_key', ignoreDuplicates: true },
  );
}

async function logIngestEvent(
  serviceClient: SupabaseClient,
  integration: IntegrationRow,
  result: IngestResult,
  sourceIp?: string | null,
) {
  const total = result.accepted + result.suspect + result.duplicates;
  const outcome = result.rejected.length === 0 ? 'accepted' : total > 0 ? 'partial' : 'rejected';
  await serviceClient.from('meter_ingest_events').insert({
    org_id: integration.org_id,
    property_id: integration.property_id,
    integration_id: integration.id,
    outcome,
    accepted_count: result.accepted + result.suspect,
    duplicate_count: result.duplicates,
    rejected_count: result.rejected.length,
    details: { rejected: result.rejected.slice(0, 50), suspect: result.suspect },
    // Hashed, never stored raw (POPIA data minimisation); enough to spot a rogue sender.
    source_ip_hash: sourceIp ? crypto.createHash('sha256').update(sourceIp).digest('hex').slice(0, 32) : null,
  });
}
