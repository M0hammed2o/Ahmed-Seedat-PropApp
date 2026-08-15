import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';
import { RATE_LIMITS } from '@propvault/config';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { getMetaWhatsAppConfig } from '@/lib/providers/whatsapp';
import { processWhatsAppWebhookEvent, WhatsAppWebhookSignatureError } from '@/lib/whatsappDispatch';
import { writeAuditEvent } from '@/lib/audit';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';

/**
 * GET /api/v1/webhooks/whatsapp -- Meta's one-time webhook verification handshake, performed when
 * the callback URL is registered in the Meta App Dashboard (developers.facebook.com/docs/graph-api/
 * webhooks/getting-started#verification-requests). Echoes back `hub.challenge` only if
 * `hub.verify_token` matches WHATSAPP_WEBHOOK_VERIFY_TOKEN -- a separate secret from the one used
 * to sign POST payloads (see providers/whatsapp.ts's MetaWhatsAppConfig comment).
 */
export async function GET(request: NextRequest) {
  const config = getMetaWhatsAppConfig();
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');

  if (
    !config?.webhookVerifyToken ||
    mode !== 'subscribe' ||
    !challenge ||
    token !== config.webhookVerifyToken
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return new NextResponse(challenge, { status: 200 });
}

/**
 * POST /api/v1/webhooks/whatsapp -- Meta's own inbound webhook endpoint (WHATSAPP.md §4), the
 * inbound half of TECHNICAL_DEBT_REGISTER.md TD-38. Same posture as billing/webhook and
 * webhooks/resend: deliberately unauthenticated by session (a BSP is not a signed-in user), trust
 * comes entirely from MetaWhatsAppProvider.verifyWebhookSignature() (X-Hub-Signature-256 HMAC over
 * the raw body). Idempotent by provider-assigned message/event id
 * (processWhatsAppWebhookEvent's own whatsapp_webhook_events unique-constraint guard) -- returning
 * anything but 2xx to Meta for an already-processed event would make it keep retrying forever.
 */
export async function POST(request: NextRequest) {
  const serviceClient = getServiceRoleClient();

  // Same IP-bucketed rate limit as the billing/Resend webhooks (TD-10) -- an unauthenticated
  // endpoint has no user_id to key on; Meta's own retries come from a small, stable set of IPs and
  // won't trip this, a flood/replay attempt will.
  const limited = await rateLimitOrRespond(
    serviceClient,
    `whatsapp-webhook:${resolveTrustedClientIp(request)}`,
    RATE_LIMITS.webhookRequestsPerMinute,
    60,
  );
  if (limited) return limited;

  // Raw text, not request.json() -- signature verification is computed over the exact bytes Meta
  // sent; parsing and re-serializing first would produce a different byte sequence and make every
  // signature check fail.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-hub-signature-256') ?? '';

  try {
    const result = await processWhatsAppWebhookEvent(serviceClient, { rawBody, signatureHeader });
    return NextResponse.json({ ok: true, alreadyProcessed: result.alreadyProcessed });
  } catch (err) {
    if (err instanceof WhatsAppWebhookSignatureError) {
      // WHATSAPP.md §4 point 2: a missing/mismatched signature is rejected with 401, logged as a
      // security event to audit_events, and -- critically -- nothing else runs: no
      // whatsapp_messages row, no whatsapp_webhook_events row, no resolution attempt. entityId is
      // a fresh random uuid (audit_events.entity_id is uuid not null; there is no real entity to
      // reference for a rejected, unparsed request).
      await writeAuditEvent(serviceClient, {
        orgId: null,
        actorUserId: null,
        actorType: 'system',
        action: 'webhook_signature_rejected',
        entityType: 'whatsapp_webhook',
        entityId: crypto.randomUUID(),
      });
      return NextResponse.json(
        { error: { code: 'invalid_signature', message: 'Invalid webhook signature.' } },
        { status: 401 },
      );
    }
    // Parse failures beyond signature (malformed JSON, an unresolvable RPC error, etc.) are
    // ordinary 400s -- Meta should not retry these the way it would a genuine 5xx.
    return NextResponse.json(
      {
        error: {
          code: 'whatsapp_webhook_failed',
          message: err instanceof Error ? err.message : 'Webhook processing failed.',
        },
      },
      { status: 400 },
    );
  }
}
