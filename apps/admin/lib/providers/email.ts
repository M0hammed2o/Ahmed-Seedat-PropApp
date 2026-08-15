import 'server-only';
import crypto from 'node:crypto';
import { Resend } from 'resend';
import type {
  EmailProvider,
  EmailWebhookEvent,
  EmailWebhookHeaders,
  SendEmailInput,
  SendEmailResult,
} from '@propvault/types';

// Mock-first EmailProvider (EMAIL.md §2) -- no real vendor account exists (external-service
// blocker). Logs the constructed message and returns 'queued' -- never 'sent'/'delivered'.
// This is a hard rule, not a simplification to relax later in mock mode: EMAIL.md §2 is explicit
// that email_messages.status is read by invoice/statement detail views as delivery *proof*, so a
// mock that fabricated progression would make the audit trail lie. Contrast with
// MockWhatsAppProvider (WHATSAPP.md §5), which is documented as simulating a queued->sent->
// delivered lifecycle -- the two mocks are deliberately NOT symmetric, matching their source
// documents' different rules, not an oversight.
export class MockEmailProvider implements EmailProvider {
  readonly providerName = 'mock';

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.warn('[MockEmailProvider] would send', {
      orgId: input.orgId,
      toAddress: input.toAddress,
      templateName: input.templateName,
      attachmentCount: input.attachments?.length ?? 0,
      hasHtml: Boolean(input.bodyHtml),
    });
    return { providerMessageId: `mock-email-${crypto.randomUUID()}`, status: 'queued' };
  }

  // No real signature scheme in mock mode -- accepts any non-empty signature, matching the "mock
  // never pretends to a stronger guarantee than it has" rule MockBillingGatewayProvider's own
  // verifyWebhookSignature already documents. A mock send never produces a real webhook anyway;
  // this only exists so tests exercising the webhook route end-to-end don't need a real provider.
  verifyWebhookSignature(_rawBody: string, headers: EmailWebhookHeaders): boolean {
    return Boolean(headers.signature);
  }

  parseWebhookEvent(rawBody: string): EmailWebhookEvent {
    const parsed = JSON.parse(rawBody) as Partial<EmailWebhookEvent> & Record<string, unknown>;
    if (!parsed.providerEventId || !parsed.type || !parsed.providerMessageId) {
      throw new Error('Malformed mock email webhook payload');
    }
    return {
      providerEventId: parsed.providerEventId,
      type: parsed.type,
      providerMessageId: parsed.providerMessageId,
      occurredAt: parsed.occurredAt ?? new Date().toISOString(),
      bounceType: parsed.bounceType ?? null,
      raw: parsed,
    };
  }
}

export interface ResendConfig {
  apiKey: string;
  fromAddress: string;
}

export function getResendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS;
  if (!apiKey || !fromAddress) return null;
  return { apiKey, fromAddress };
}

/** Separate from ResendConfig -- the webhook secret is issued independently, per webhook
 * endpoint, from Resend's dashboard (not the account API key), and this codebase's own
 * <PROVIDER>_WEBHOOK_SECRET naming convention already exists for exactly this: see
 * REVENUECAT_WEBHOOK_SECRET/DOCUMENT_INTELLIGENCE_WEBHOOK_SECRET in lib/supabase/server.ts. Kept
 * optional (not folded into getResendConfig()'s all-or-nothing shape) so sending real email can
 * work before the webhook is configured -- the two are genuinely independent capabilities. */
export function getResendWebhookSecret(): string | null {
  return process.env.RESEND_WEBHOOK_SECRET || null;
}

// Resend delivers webhooks signed via Svix (https://docs.svix.com/receiving/verifying-payloads/how)
// -- this is Resend's own documented verification scheme, not a guess: the secret has a `whsec_`
// prefix followed by a base64-encoded key; the signed content is `{id}.{timestamp}.{body}`; the
// signature header carries one or more space-separated `v1,<base64-hmac>` tokens (multiple only
// when a secret is being rotated) and the payload is accepted if ANY token matches. A timestamp
// tolerance rejects a captured-and-replayed old payload even if the signature itself is valid.
const SVIX_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function verifySvixSignature(
  rawBody: string,
  headers: EmailWebhookHeaders,
  secret: string,
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;

  const timestampSeconds = Number(headers.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > SVIX_TIMESTAMP_TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  const expectedBuffer = Buffer.from(expected);

  // svix-signature: "v1,<sig1> v1,<sig2> ..." -- accept if any candidate matches.
  return headers.signature
    .split(' ')
    .map((token) => token.split(',')[1])
    .filter((sig): sig is string => Boolean(sig))
    .some((sig) => {
      const receivedBuffer = Buffer.from(sig);
      if (expectedBuffer.length !== receivedBuffer.length) return false;
      return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    });
}

// Resend's documented webhook event shape: {type: "email.delivered", created_at: "...",
// data: {email_id: "...", ...}}. Bounce sub-classification (permanent vs transient) is checked
// defensively across the field names Resend's own docs/changelog have used, since this hasn't
// been confirmed against a real captured payload in this environment -- never assumed present.
function mapResendEventType(type: string): EmailWebhookEvent['type'] {
  switch (type) {
    case 'email.sent':
      return 'sent';
    case 'email.delivered':
      return 'delivered';
    case 'email.bounced':
      return 'bounced';
    case 'email.delivery_delayed':
      return 'delivery_delayed';
    case 'email.complained':
      return 'complained';
    default:
      return 'other';
  }
}

// Real Resend integration (Stage 5, commercial-launch execution plan, WORKLOG.md this date).
// Deliberately does NOT resolve `input.attachments` (documentId -> file bytes) -- doing so would
// mean this provider class reaching into Supabase Storage/the documents table itself, which no
// other provider in this codebase does (payfast.ts's own comment: "no DB access from a provider
// class"). Confirmed via grep before writing this: zero real callers currently pass `attachments`
// to dispatchEmail() at all, so this is a disclosed, currently-unreachable gap, not a silent drop
// of something in active use -- logged loudly if it ever is exercised, rather than guessed at.
//
// No real Resend account/API key exists in THIS local/CI environment (external-service blocker,
// same class of gap as PayFast -- TECHNICAL_DEBT_REGISTER.md TD-36/TD-37), so this class is never
// exercised end-to-end by this session's own test suite. Production is a different story --
// confirmed via a real production release-verification pass (WORKLOG.md this date) that
// RESEND_API_KEY/RESEND_FROM_ADDRESS ARE configured there and this class does genuinely send.
export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;
  readonly providerName = 'resend';

  constructor(private readonly config: ResendConfig) {
    this.client = new Resend(config.apiKey);
  }

  // No webhook secret configured yet = reject every webhook outright (fail closed, matching
  // MockEmailProvider's own posture of never claiming a stronger guarantee than it has -- but
  // here failing closed rather than open, since this is the REAL provider and an unconfigured
  // secret means "not yet safe to trust anything claiming to be Resend," not "trust anything").
  verifyWebhookSignature(rawBody: string, headers: EmailWebhookHeaders): boolean {
    const secret = getResendWebhookSecret();
    if (!secret) return false;
    return verifySvixSignature(rawBody, headers, secret);
  }

  parseWebhookEvent(rawBody: string): EmailWebhookEvent {
    let parsed: {
      type?: string;
      created_at?: string;
      data?: { email_id?: string; bounce?: { type?: string }; bounce_type?: string };
    };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error('Resend webhook payload is not valid JSON');
    }
    const emailId = parsed.data?.email_id;
    if (!parsed.type || !emailId) {
      throw new Error('Resend webhook payload is missing required fields (type/data.email_id)');
    }
    return {
      // Resend's body has no per-delivery event id of its own -- the real idempotency key is the
      // `svix-id` header (matching PayFast's own parseWebhookEvent precedent of staying
      // rawBody-only and deriving what it can from content). processResendWebhookEvent prefers
      // the real svix-id header over this deterministic content-derived fallback, which by the
      // time processing reaches that point is only reachable if verification somehow succeeded
      // without a header present -- defensive, not the primary mechanism.
      providerEventId: `${emailId}:${parsed.type}:${parsed.created_at ?? ''}`,
      type: mapResendEventType(parsed.type),
      providerMessageId: emailId,
      occurredAt: parsed.created_at ?? new Date().toISOString(),
      bounceType: parsed.data?.bounce?.type ?? parsed.data?.bounce_type ?? null,
      raw: parsed,
    };
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (input.attachments && input.attachments.length > 0) {
      console.warn(
        '[ResendEmailProvider] attachments were requested but are not implemented (no DB access from a provider class) -- sending without them',
        { orgId: input.orgId, documentIds: input.attachments.map((a) => a.documentId) },
      );
    }

    const { data, error } = await this.client.emails.send({
      from: this.config.fromAddress,
      to: input.toAddress,
      subject: input.subject,
      text: input.bodyText,
      // V1 communications productionisation: HTML is optional at the SendEmailInput boundary but
      // every real template now provides it (emailDispatch.ts) -- Resend accepts both `text` and
      // `html` in the same call and clients that can render HTML use it, falling back to `text`
      // otherwise (the plain-text fallback this task requires, provided by the provider's own
      // MIME multipart/alternative behavior, not something this code needs to construct itself).
      ...(input.bodyHtml ? { html: input.bodyHtml } : {}),
      replyTo: input.replyTo,
    });

    if (error) {
      throw new Error(`Resend send failed: ${error.name} - ${error.message}`);
    }
    if (!data) {
      throw new Error('Resend send returned no data and no error -- unexpected response shape');
    }

    // Resend's synchronous response only confirms acceptance into their send queue, not final
    // delivery -- 'queued' here, exactly like the mock, for the same EMAIL.md §2 reason (real
    // delivery/bounce state arrives later via webhook, not fabricated here).
    return { providerMessageId: data.id, status: 'queued' };
  }
}

export function getEmailProvider(): EmailProvider {
  const resendConfig = getResendConfig();
  if (resendConfig) {
    return new ResendEmailProvider(resendConfig);
  }
  return new MockEmailProvider();
}

// Overnight platform pass (WORKLOG.md this date): closes a real gap found while diagnosing "owner
// and staff invitations show pending but no email ever arrives" -- dispatchEmail()'s result never
// distinguished "really handed to Resend" from "silently mocked because RESEND_API_KEY/
// RESEND_FROM_ADDRESS aren't set," so every caller (and the UI built on top of it) treated a mock
// no-op exactly like a real send. This is the one place that distinction is now made, so it can't
// drift out of sync with getEmailProvider()'s own fallback logic.
export function isEmailProviderConfigured(): boolean {
  return getResendConfig() !== null;
}
