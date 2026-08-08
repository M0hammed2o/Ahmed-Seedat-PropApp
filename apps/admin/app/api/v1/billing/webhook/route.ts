import { NextResponse, type NextRequest } from 'next/server';
import { RATE_LIMITS } from '@propvault/config';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { processBillingWebhookEvent } from '@/lib/billing';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';

/**
 * POST /api/v1/billing/webhook -- the real gateway's own inbound webhook endpoint. Deliberately
 * unauthenticated (no cookie/Bearer session -- a payment gateway is not a signed-in user); trust
 * comes entirely from BillingGatewayProvider.verifyWebhookSignature(), matching the same pattern
 * DOCUMENT_INTELLIGENCE_WEBHOOK_SECRET/REVENUECAT_WEBHOOK_SECRET already establish for other
 * external-service webhooks in this codebase. Idempotent: a retried delivery for an
 * already-processed event returns 200 without reprocessing (processBillingWebhookEvent's own
 * billing_events unique-constraint guard) -- returning anything but 2xx to a real gateway would
 * cause it to keep retrying forever.
 */
export async function POST(request: NextRequest) {
  const serviceClient = getServiceRoleClient();

  // PWA_V1_COMPLETION_PLAN.md #19, TD-10: an unauthenticated endpoint has no user_id to key on,
  // so this buckets by source IP -- a real gateway's retries come from a small, stable set of IPs
  // and won't trip this; a flood/replay attempt will.
  const limited = await rateLimitOrRespond(
    serviceClient,
    `billing-webhook:${resolveTrustedClientIp(request)}`,
    RATE_LIMITS.webhookRequestsPerMinute,
    60,
  );
  if (limited) return limited;

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-billing-signature');

  try {
    const result = await processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader });
    return NextResponse.json({ ok: true, alreadyProcessed: result.alreadyProcessed });
  } catch (err) {
    // Signature/parse failures are the caller's fault (400), not a server error -- a gateway
    // should not retry these the way it would a 5xx.
    return NextResponse.json(
      {
        error: {
          code: 'billing_webhook_failed',
          message: err instanceof Error ? err.message : 'Webhook processing failed.',
        },
      },
      { status: 400 },
    );
  }
}
