import { NextResponse, type NextRequest } from 'next/server';
import { meterIntegrationCreateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { requireOrgRole } from '@/lib/portfolio';
import { getAppUrl } from '@/lib/appUrl';
import {
  canWriteUtilities,
  jsonError,
  loadReadableProperty,
  notFound,
  parseJson,
  requireUser,
  serverError,
} from '@/lib/smartUtility/http';
import { issueToken } from '@/lib/smartUtility/tokens';

type RouteParams = { params: Promise<{ id: string }> };

const INGEST_PATH = '/api/v1/integrations/meters/ingest';

/**
 * POST /api/v1/properties/:id/meter-integrations -- create a push integration (a LoRaWAN gateway, a
 * Shelly fleet, a Modbus gateway, or the simulator) and return its bearer token ONCE. Only the
 * SHA-256 hash is stored. Issuing a credential is restricted to org managers/principals who can
 * also manage this property's utilities.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, meterIntegrationCreateSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  const allowed =
    (await requireOrgRole(auth.supabase, property.org_id, 'manager')) &&
    (await canWriteUtilities(auth.supabase, property.org_id, property.id));
  if (!allowed) {
    return jsonError(403, 'forbidden', 'Only an organisation manager or principal can connect meter hardware.');
  }

  const issued = issueToken();
  const service = getServiceRoleClient();
  const { data, error } = await service
    .from('meter_integrations')
    .insert({
      org_id: property.org_id,
      property_id: property.id,
      provider: parsed.data.provider,
      name: parsed.data.name,
      token_prefix: issued.prefix,
      token_hash: issued.hash,
      created_by: auth.user.id,
    })
    .select('id, provider, name, token_prefix, status, created_at')
    .single();
  if (error) return serverError('integration_create_failed', 'Could not create the integration.', 'meter_integrations.insert', error);

  await writeAuditEvent(service, {
    orgId: property.org_id,
    actorUserId: auth.user.id,
    actorType: 'user',
    action: 'meter_integration.create',
    entityType: 'meter_integrations',
    entityId: data.id,
    after: { provider: data.provider, name: data.name, tokenPrefix: data.token_prefix },
  });
  return NextResponse.json(
    {
      integration: data,
      // Shown once. Never logged, never stored in plaintext.
      token: issued.token,
      ingestUrl: `${getAppUrl()}${INGEST_PATH}`,
    },
    { status: 201 },
  );
}
