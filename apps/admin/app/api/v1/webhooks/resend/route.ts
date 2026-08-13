import { NextResponse, type NextRequest } from 'next/server';
import { RATE_LIMITS } from '@propvault/config';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { processResendWebhookEvent } from '@/lib/emailDispatch';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';

/**
 * POST /api/v1/webhooks/resend -- Resend's own inbound webhook endpoint, mirroring
 * /api/v1/billing/webhook's exact posture: deliberately unauthenticated (no cookie/Bearer
 * session -- an email provider is not a signed-in user), trust comes entirely from
 * ResendEmailProvider.verifyWebhookSignature() (Svix HMAC over the raw body + svix-id/
 * svix-timestamp headers). Idempotent: a retried delivery for an already-processed event returns
 * 200 without reprocessing (processResendWebhookEvent's own email_webhook_events unique-
 * constraint guard) -- returning anything but 2xx would make Resend/Svix keep retrying forever.
 */
export async function POST(request: NextRequest) {
  const serviceClient = getServiceRoleClient();

  // Same IP-bucketed rate limit as the billing webhook (TD-10) -- an unauthenticated endpoint has
  // no user_id to key on; Resend's own retries come from a small, stable set of IPs and won't
  // trip this, a flood/replay attempt will.
  const limited = await rateLimitOrRespond(
    serviceClient,
    `resend-webhook:${resolveTrustedClientIp(request)}`,
    RATE_LIMITS.webhookRequestsPerMinute,
    60,
  );
  if (limited) return limited;

  // Raw text, not request.json() -- signature verification is computed over the exact bytes
  // Resend sent; parsing and re-serializing first would produce a different byte sequence and
  // make every signature check fail.
  const rawBody = await request.text();
  const headers = {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  };

  try {
    const result = await processResendWebhookEvent(serviceClient, { rawBody, headers });
    return NextResponse.json({ ok: true, alreadyProcessed: result.alreadyProcessed });
  } catch (err) {
    // Signature/parse failures are the caller's fault (400), not a server error -- Resend should
    // not retry these the way it would a genuine 5xx.
    return NextResponse.json(
      {
        error: {
          code: 'resend_webhook_failed',
          message: err instanceof Error ? err.message : 'Webhook processing failed.',
        },
      },
      { status: 400 },
    );
  }
}
