import { NextResponse, type NextRequest } from 'next/server';
import { meterIntegrationActionSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { requireOrgRole } from '@/lib/portfolio';
import { canWriteUtilities, jsonError, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { issueToken } from '@/lib/smartUtility/tokens';

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
    .select('id, org_id, property_id, status, token_prefix')
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
  if (parsed.data.action === 'revoke') {
    const { error } = await service
      .from('meter_integrations')
      .update({ status: 'revoked', revoked_at: now.toISOString(), previous_token_hash: null, previous_token_prefix: null, previous_token_expires_at: null })
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
