import 'server-only';
import { pinnedFetch } from './pinnedFetch';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyPropertyStaff } from '../notify';
import { writeAuditEvent } from '../audit';
import { storeReadings, type IngestResult, type IntegrationRow } from './ingest';
import { getProvider, type PollContext } from './providers';
import { decryptCredentials } from './secrets';

// Scheduled synchronisation for poll providers (docs/SMART_UTILITIES_PROGRESS.md §3, §9).
// Idempotent: every polled reading carries a provider event id, so a retried or overlapping sync
// stores nothing twice (meter_telemetry_readings unique keys).

export const MAX_BACKFILL_MS = 7 * 86_400_000;
export const DEFAULT_LOOKBACK_MS = 86_400_000;
export const FAILURES_BEFORE_ALERT = 3;

/** Next attempt after `failures` consecutive failures: interval × 2^failures, capped at 24 h. */
export function backoffMinutes(intervalMinutes: number, failures: number): number {
  return Math.min(intervalMinutes * 2 ** Math.max(0, failures), 1440);
}

interface PollIntegrationRow extends IntegrationRow {
  name: string;
  credentials_ciphertext: string | null;
  provider_config: Record<string, unknown>;
  sync_interval_minutes: number | null;
  last_sync_at: string | null;
  consecutive_failures: number;
}

export interface SyncOutcome {
  integrationId: string;
  ok: boolean;
  message: string;
  result?: IngestResult;
}

export async function syncIntegration(
  serviceClient: SupabaseClient,
  integration: PollIntegrationRow,
  opts: { now?: Date; fetchImpl?: typeof fetch; actorUserId?: string | null; lookupImpl?: (hostname: string) => Promise<string[]> } = {},
): Promise<SyncOutcome> {
  const now = opts.now ?? new Date();
  const interval = integration.sync_interval_minutes ?? 60;
  const provider = getProvider(integration.provider);
  try {
    if (!provider?.poll) throw new Error(`${integration.provider} is not a polling provider`);
    if (!integration.credentials_ciphertext) throw new Error('No credentials stored for this connection.');
    const ctx: PollContext = {
      config: integration.provider_config ?? {},
      credentials: decryptCredentials(integration.credentials_ciphertext, integration.id),
      // Pinned-address client by default (TD-66): the connection goes to the address that passed the check.
      fetchImpl: opts.fetchImpl ?? pinnedFetch(),
      lookupImpl: opts.lookupImpl,
    };
    const { data: meters, error } = await serviceClient
      .from('utility_meters')
      .select('external_device_id, external_channel')
      .eq('integration_id', integration.id)
      .eq('active', true);
    if (error) throw new Error(error.message);
    const devices = (meters ?? [])
      .filter((m) => m.external_device_id)
      .map((m) => ({ deviceId: m.external_device_id as string, channel: m.external_channel as string }));

    const since = new Date(
      Math.max(
        now.getTime() - MAX_BACKFILL_MS,
        integration.last_sync_at ? new Date(integration.last_sync_at).getTime() - 15 * 60_000 : now.getTime() - DEFAULT_LOOKBACK_MS,
      ),
    );
    const readings = devices.length ? await provider.poll(ctx, devices, since, now) : [];
    const result = await storeReadings(serviceClient, integration, readings, { now });

    await serviceClient
      .from('meter_integrations')
      .update({
        last_sync_at: now.toISOString(),
        last_sync_status: 'ok',
        last_sync_error: null,
        consecutive_failures: 0,
        next_sync_at: new Date(now.getTime() + interval * 60_000).toISOString(),
      })
      .eq('id', integration.id);
    if (integration.consecutive_failures >= FAILURES_BEFORE_ALERT) {
      await writeAuditEvent(serviceClient, {
        orgId: integration.org_id,
        actorUserId: opts.actorUserId ?? null,
        actorType: opts.actorUserId ? 'user' : 'system',
        action: 'meter_integration.reconnected',
        entityType: 'meter_integrations',
        entityId: integration.id,
      });
    }
    return { integrationId: integration.id, ok: true, message: `Synced ${readings.length} reading(s).`, result };
  } catch (err) {
    const message = (err instanceof Error ? err.message : 'Sync failed').slice(0, 500);
    const failures = integration.consecutive_failures + 1;
    await serviceClient
      .from('meter_integrations')
      .update({
        last_sync_status: 'error',
        last_sync_error: message,
        consecutive_failures: failures,
        next_sync_at: new Date(now.getTime() + backoffMinutes(interval, failures) * 60_000).toISOString(),
      })
      .eq('id', integration.id);
    if (failures === FAILURES_BEFORE_ALERT) {
      await serviceClient
        .from('utility_meters')
        .update({ health_status: 'error' })
        .eq('integration_id', integration.id)
        .eq('active', true);
      await notifyPropertyStaff(serviceClient, {
        orgId: integration.org_id,
        propertyId: integration.property_id,
        type: 'meter_integration_failing',
        title: `Meter connection "${integration.name}" is failing`,
        body: `${FAILURES_BEFORE_ALERT} sync attempts in a row failed: ${message}`,
        relatedEntityType: 'meter_integrations',
        relatedEntityId: integration.id,
        minRole: 'accountant',
      });
    }
    return { integrationId: integration.id, ok: false, message };
  }
}

const POLL_COLUMNS =
  'id, org_id, property_id, provider, name, status, token_hash, previous_token_hash, previous_token_expires_at, credentials_ciphertext, provider_config, sync_interval_minutes, last_sync_at, consecutive_failures';

export async function loadPollIntegration(serviceClient: SupabaseClient, id: string) {
  const { data } = await serviceClient.from('meter_integrations').select(POLL_COLUMNS).eq('id', id).maybeSingle();
  return (data as PollIntegrationRow | null) ?? null;
}

export async function runPollSync(
  serviceClient: SupabaseClient,
  opts: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const now = opts.now ?? new Date();
  const { data, error } = await serviceClient
    .from('meter_integrations')
    .select(POLL_COLUMNS)
    .eq('sync_mode', 'poll')
    .eq('status', 'active')
    .or(`next_sync_at.is.null,next_sync_at.lte.${now.toISOString()}`)
    .limit(100);
  if (error) throw new Error(error.message);
  let succeeded = 0;
  let failed = 0;
  for (const row of (data ?? []) as PollIntegrationRow[]) {
    const out = await syncIntegration(serviceClient, row, { now, fetchImpl: opts.fetchImpl });
    if (out.ok) succeeded += 1;
    else failed += 1;
  }
  return { attempted: (data ?? []).length, succeeded, failed };
}
