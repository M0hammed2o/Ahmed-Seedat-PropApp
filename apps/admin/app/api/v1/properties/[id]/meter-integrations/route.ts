import { NextResponse, type NextRequest } from 'next/server';
import { meterIntegrationCreateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { requireOrgRole } from '@/lib/portfolio';
import { getAppUrl } from '@/lib/appUrl';
import { canWriteUtilities, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import { issueToken } from '@/lib/smartUtility/tokens';
import { AdapterError } from '@/lib/smartUtility/adapters';
import { getProvider, validateBaseUrl } from '@/lib/smartUtility/providers';
import { encryptCredentials, isCredentialsKeyConfigured } from '@/lib/smartUtility/secrets';

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
  if (!property.utilities_enabled) return utilitiesDisabled();
  const allowed =
    (await requireOrgRole(auth.supabase, property.org_id, 'manager')) &&
    (await canWriteUtilities(auth.supabase, property.org_id, property.id));
  if (!allowed) {
    return jsonError(403, 'forbidden', 'Only an organisation manager or principal can connect meter hardware.');
  }

  const provider = getProvider(parsed.data.provider)!;
  const integrationId = crypto.randomUUID();
  let credentialsCiphertext: string | null = null;
  if (provider.mode === 'poll') {
    // Poll providers hold server-side credentials: validate config, require the encryption key
    // (fail closed), and bind the ciphertext to this row's id.
    try {
      validateBaseUrl(parsed.data.config.baseUrl, process.env.NODE_ENV !== 'production');
    } catch (err) {
      return jsonError(400, 'invalid_config', err instanceof AdapterError ? err.message : 'Invalid server address.');
    }
    const creds = parsed.data.credentials ?? {};
    const allowed = new Set(provider.credentialFields.map((f) => f.key));
    if (Object.keys(creds).some((k) => !allowed.has(k)) || Object.values(creds).every((v) => !v)) {
      return jsonError(400, 'invalid_credentials', 'Provide the credentials this provider needs.');
    }
    if (!isCredentialsKeyConfigured()) {
      return jsonError(
        503,
        'credentials_key_missing',
        'Secure credential storage is not configured on this server, so polled connections cannot be created yet.',
      );
    }
    credentialsCiphertext = encryptCredentials(creds, integrationId);
  }

  const issued = issueToken();
  const service = getServiceRoleClient();
  const { data, error } = await service
    .from('meter_integrations')
    .insert({
      id: integrationId,
      org_id: property.org_id,
      property_id: property.id,
      provider: parsed.data.provider,
      name: parsed.data.name,
      token_prefix: issued.prefix,
      token_hash: issued.hash,
      created_by: auth.user.id,
      sync_mode: provider.mode,
      provider_config: provider.mode === 'poll' ? parsed.data.config : {},
      credentials_ciphertext: credentialsCiphertext,
      sync_interval_minutes: provider.mode === 'poll' ? (parsed.data.syncIntervalMinutes ?? 60) : null,
      next_sync_at: provider.mode === 'poll' ? new Date().toISOString() : null,
    })
    .select('id, provider, name, token_prefix, status, sync_mode, created_at')
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
      // Push providers: shown once, never logged or stored in plaintext. Poll providers need no
      // inbound token (Proplyst calls them), so none is returned.
      token: provider.mode === 'push' ? issued.token : null,
      ingestUrl: provider.mode === 'push' ? `${getAppUrl()}${INGEST_PATH}` : null,
    },
    { status: 201 },
  );
}
