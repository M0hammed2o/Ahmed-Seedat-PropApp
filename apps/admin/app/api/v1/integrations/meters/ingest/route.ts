import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';
import { authenticateIntegration, ingestPayload } from '@/lib/smartUtility/ingest';
import { bearerFrom, parseTokenPrefix } from '@/lib/smartUtility/tokens';

const MAX_BODY_BYTES = 256 * 1024;

/**
 * POST /api/v1/integrations/meters/ingest -- the single, vendor-neutral push endpoint for meter
 * gateways (docs/SMART_UTILITY_ARCHITECTURE.md §3).
 *
 * Auth: `Authorization: Bearer pmi_<prefix>_<secret>` issued per integration. The token -- never the
 * payload -- decides the org and property; device ids are only matched against meters bound to THAT
 * integration. Rate-limited per source IP and per token prefix. Responds 200 with per-reading
 * outcomes even when some readings are rejected, so a gateway never retries a whole batch because of
 * one unknown device; duplicates (replays/retries) are counted, never double-stored.
 */
export async function POST(request: NextRequest) {
  const service = getServiceRoleClient();
  const ip = resolveTrustedClientIp(request);
  const ipLimited = await rateLimitOrRespond(service, `meter-ingest-ip:${ip}`, 600, 60);
  if (ipLimited) return ipLimited;

  const token = bearerFrom(request.headers.get('authorization'));
  const prefix = token ? parseTokenPrefix(token) : null;
  if (prefix) {
    const tokenLimited = await rateLimitOrRespond(service, `meter-ingest-token:${prefix}`, 300, 60);
    if (tokenLimited) return tokenLimited;
  }

  const auth = await authenticateIntegration(service, token);
  if (!auth.ok && auth.reason === 'utilities_disabled') {
    return NextResponse.json({ error: { code: 'utilities_disabled', message: 'Smart Utilities is not enabled for this organisation.' } }, { status: 403 });
  }
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.reason === 'revoked' ? 'integration_revoked' : 'unauthorized', message: 'Invalid or revoked integration token.' } },
      { status: auth.reason === 'revoked' ? 403 : 401 },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: 'payload_too_large', message: 'Payload exceeds 256 KB.' } }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: 'invalid_json', message: 'Body must be JSON.' } }, { status: 400 });
  }

  try {
    const result = await ingestPayload(service, {
      integration: auth.integration,
      body,
      sourceIp: ip,
      query: request.nextUrl.searchParams,
    });
    const status = result.rejected.some((r) => r.reason === 'payload_invalid') ? 422 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    console.error('[meter-ingest] failed', err instanceof Error ? err.message : err);
    // 503 so well-behaved gateways retry later; idempotency keys make the retry safe.
    return NextResponse.json({ error: { code: 'ingest_failed', message: 'Temporary failure, retry later.' } }, { status: 503 });
  }
}
