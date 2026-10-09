import { NextResponse, type NextRequest } from 'next/server';
import { meterIntegrationActionSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { requireOrgRole } from '@/lib/portfolio';
import { canWriteUtilities, jsonError, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { issueToken } from '@/lib/smartUtility/tokens';
import { getProvider } from '@/lib/smartUtility/providers';
import { decryptCredentials, encryptCredentials, isCredentialsKeyConfigured } from '@/lib/smartUtility/secrets';
import { loadPollIntegration, syncIntegration } from '@/lib/smartUtility/sync';

type RouteParams = { params: Promise<{ id: string }> };

const ROTATION_GRACE_MS = 24 * 3_600_000;

/** GET /api/v1/meter-integrations/:id -- the last 20 ingestion events ("test connection" evidence). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data: integration } = await auth.supabase
    .from('meter_integrations')
    .select('id, provider, name, token_prefix, status, last_seen_at, rotated_at, revoked_at, previous_token_expires_at')
    .eq('id', id)
    .maybeSingle();
  if (!integration) return notFound('Integration');
  const { data: events, error } = await auth.supabase
    .from('meter_ingest_events')
    .select('id, outcome, accepted_count, duplicate_count, rejected_count, details, received_at')
    .eq('integration_id', id)
    .order('received_at', { ascending: false })
    .limit(20);
  if (error) return serverError('ingest_events_failed', 'Could not load ingestion history.', 'meter_integrations.events', error);
  return NextResponse.json({ integration, events: events ?? [] });
}

/**
 * POST /api/v1/meter-integrations/:id {action: 'rotate' | 'revoke'}. Rotation issues a new token and
 * keeps the previous one valid for 24 h so the gateway can be reconfigured without losing data;
 * revocation disables the integration immediately.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, meterIntegrationActionSchema);
  if ('response' in parsed) return parsed.response;
  const { data: integration } = await auth.supabase
    .from('meter_integrations')
    .select('id, org_id, property_id, provider, status, token_prefix, sync_mode, last_seen_at')
    .eq('id', id)
    .maybeSingle();
  if (!integration) return notFound('Integration');
  const allowed =
    (await requireOrgRole(auth.supabase, integration.org_id, 'manager')) &&
    (await canWriteUtilities(auth.supabase, integration.org_id, integration.property_id));
  if (!allowed) return jsonError(403, 'forbidden', 'Only an organisation manager or principal can manage meter hardware.');
  if (integration.status === 'revoked') return jsonError(409, 'integration_revoked', 'This integration has been revoked.');

  const service = getServiceRoleClient();
  const now = new Date();
  const provider = getProvider(integration.provider);

  if (parsed.data.action === 'verify') {
    if (integration.sync_mode !== 'poll' || !provider?.verifyConnection) {
      // Push connections are verified by data arriving: report the last receipt and recent outcomes.
      const { data: events } = await service
        .from('meter_ingest_events')
        .select('outcome, accepted_count, rejected_count, received_at')
        .eq('integration_id', id)
        .order('received_at', { ascending: false })
        .limit(1);
      const last = events?.[0];
      return NextResponse.json({
        ok: !!last && last.outcome !== 'rejected',
        message: last
          ? `Last data received ${last.received_at} (${last.accepted_count} accepted, ${last.rejected_count} rejected).`
          : 'No data received yet. Configure the device or gateway with the address and token, then send a reading.',
      });
    }
    const row = await loadPollIntegration(service, id);
    if (!row?.credentials_ciphertext) return jsonError(409, 'no_credentials', 'No credentials stored for this connection.');
    if (!isCredentialsKeyConfigured()) return jsonError(503, 'credentials_key_missing', 'Secure credential storage is not configured.');
    const result = await provider.verifyConnection({
      config: row.provider_config ?? {},
      credentials: decryptCredentials(row.credentials_ciphertext, row.id),
      fetchImpl: fetch,
    });
    return NextResponse.json(result);
  }

  if (parsed.data.action === 'sync_now') {
    if (integration.sync_mode !== 'poll') return jsonError(409, 'not_polled', 'This connection pushes data; there is nothing to sync.');
    const row = await loadPollIntegration(service, id);
    if (!row) return notFound('Integration');
    const outcome = await syncIntegration(service, row, { actorUserId: auth.user.id });
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
  }

  if (parsed.data.action === 'update_credentials') {
    if (integration.sync_mode !== 'poll' || !provider) return jsonError(409, 'not_polled', 'This connection has no stored credentials.');
    const allowedKeys = new Set(provider.credentialFields.map((f) => f.key));
    if (Object.keys(parsed.data.credentials).some((k) => !allowedKeys.has(k))) {
      return jsonError(400, 'invalid_credentials', 'Unexpected credential field.');
    }
    if (!isCredentialsKeyConfigured()) return jsonError(503, 'credentials_key_missing', 'Secure credential storage is not configured.');
    const { error } = await service
      .from('meter_integrations')
      .update({
        credentials_ciphertext: encryptCredentials(parsed.data.credentials, id),
        consecutive_failures: 0,
        last_sync_error: null,
        next_sync_at: now.toISOString(),
      })
      .eq('id', id);
    if (error) return serverError('integration_credentials_failed', 'Could not update the credentials.', 'meter_integrations.credentials', error);
    await writeAuditEvent(service, {
      orgId: integration.org_id,
      actorUserId: auth.user.id,
      actorType: 'user',
      action: 'meter_integration.credentials_updated',
      entityType: 'meter_integrations',
      entityId: id,
      // Never the values -- only which fields changed.
      after: { fields: Object.keys(parsed.data.credentials) },
    });
    return NextResponse.json({ updated: true });
  }

  if (parsed.data.action === 'revoke') {
    const { error } = await service
      .from('meter_integrations')
      .update({
        status: 'revoked',
        revoked_at: now.toISOString(),
        previous_token_hash: null,
        previous_token_prefix: null,
        previous_token_expires_at: null,
        // Revoking also destroys stored vendor credentials.
        credentials_ciphertext: null,
      })
      .eq('id', id);
    if (error) return serverError('integration_revoke_failed', 'Could not revoke the integration.', 'meter_integrations.revoke', error);
    await writeAuditEvent(service, {
      orgId: integration.org_id,
      actorUserId: auth.user.id,
      actorType: 'user',
      action: 'meter_integration.revoke',
      entityType: 'meter_integrations',
      entityId: id,
    });
    return NextResponse.json({ status: 'revoked' });
  }

  const { data: current } = await service.from('meter_integrations').select('token_hash').eq('id', id).single();
  const issued = issueToken();
  const { error } = await service
    .from('meter_integrations')
    .update({
      token_prefix: issued.prefix,
      token_hash: issued.hash,
      previous_token_prefix: integration.token_prefix,
      previous_token_hash: current?.token_hash ?? null,
      previous_token_expires_at: new Date(now.getTime() + ROTATION_GRACE_MS).toISOString(),
      rotated_at: now.toISOString(),
    })
    .eq('id', id);
  if (error) return serverError('integration_rotate_failed', 'Could not rotate the token.', 'meter_integrations.rotate', error);
  await writeAuditEvent(service, {
    orgId: integration.org_id,
    actorUserId: auth.user.id,
    actorType: 'user',
    action: 'meter_integration.rotate',
    entityType: 'meter_integrations',
    entityId: id,
    after: { tokenPrefix: issued.prefix, previousValidUntil: new Date(now.getTime() + ROTATION_GRACE_MS).toISOString() },
  });
  return NextResponse.json({ token: issued.token, previousTokenValidUntil: new Date(now.getTime() + ROTATION_GRACE_MS).toISOString() });
}
