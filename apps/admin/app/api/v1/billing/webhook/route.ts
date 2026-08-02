import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { processBillingWebhookEvent } from '@/lib/billing';

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
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-billing-signature');

  const serviceClient = getServiceRoleClient();

  try {
    const result = await processBillingWebhookEvent(serviceClient, { rawBody, signatureHeader });
    return NextResponse.json({ ok: true, alreadyProcessed: result.alreadyProcessed });
  } catch (err) {
    // Signature/parse failures are the caller's fault (400), not a server error -- a gateway
    // should not retry these the way it would a 5xx.
    return NextResponse.json(
      { error: { code: 'billing_webhook_failed', message: err instanceof Error ? err.message : 'Webhook processing failed.' } },
      { status: 400 },
    );
  }
}
