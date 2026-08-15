import type { ProviderError } from './documentIntelligence';
import type { EmailStatus } from './enums';

// Vendor-agnostic email provider boundary (EMAIL.md §2), mirroring DocumentIntelligenceProvider's
// shape exactly, including reusing its ProviderError class -- "same shape as
// DocumentIntelligenceProvider's ProviderError, for consistent retry handling across every
// external-vendor integration in the codebase" (EMAIL.md §2's own words).
export type { ProviderError };

export interface SendEmailInput {
  orgId: string;
  toAddress: string;
  templateName: string;
  templateVars: Record<string, unknown>;
  /** Rendered by the caller (emailDispatch.ts's TEMPLATE_SUBJECTS/TEMPLATE_BODY) before reaching
   * this boundary -- a provider implementation should never need to know what a given
   * templateName means, only send the already-rendered subject/body it's given. */
  subject: string;
  bodyText: string;
  /** V1 communications productionisation: the branded HTML rendering of the same content
   * (emailDispatch.ts's renderEmailTemplate(), built on lib/email/layout.ts's shared components).
   * Optional at this boundary so a provider that never receives it (or a caller mid-migration)
   * degrades to plain text, never a missing send -- but every real template in this codebase sets
   * it. `bodyText` remains authoritative and is always sent alongside it as the MIME
   * text/plain part, satisfying clients that don't render HTML. */
  bodyHtml?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  attachments?: { documentId: string }[];
  replyTo?: string;
}

export interface SendEmailResult {
  providerMessageId: string;
  status: EmailStatus;
}

// Normalized webhook event shape every EmailProvider.parseWebhookEvent() implementation maps its
// vendor's raw payload into -- callers (emailDispatch.ts's processResendWebhookEvent) work only
// against this shape, never a vendor-specific one, matching how BillingWebhookEvent already
// insulates processBillingWebhookEvent() from PayFast's own payload shape.
// 'other' covers a validly-shaped, genuinely-authenticated event whose type this codebase doesn't
// act on (e.g. Resend's email.opened/email.clicked, or a future event type Resend adds) --
// distinct from a malformed/unparseable payload, which parseWebhookEvent() throws on instead. A
// real provider must never be treated as "retry forever" for an event type it's entitled to send.
export type EmailWebhookEventType =
  'sent' | 'delivered' | 'bounced' | 'delivery_delayed' | 'complained' | 'other';

export interface EmailWebhookEvent {
  /** The provider's own per-delivery-attempt id (Resend/Svix: the `svix-id` header value) -- the
   * idempotency key a retried webhook delivery reuses verbatim. */
  providerEventId: string;
  type: EmailWebhookEventType;
  /** Matches SendEmailResult.providerMessageId / email_messages.provider_message_id -- how the
   * event is joined back to the row it concerns. */
  providerMessageId: string;
  /** ISO timestamp the provider says the event occurred, used to reject a stale/out-of-order
   * event that arrives after a later one already advanced the status (EMAIL.md-style "never let
   * an old sent event un-deliver a delivered message"). */
  occurredAt: string;
  /** Present only for `type: 'bounced'` when the provider distinguishes permanent from
   * transient (Resend: `data.bounce.type` of 'permanent'/'transient') -- only a permanent bounce
   * should ever suppress future sends. */
  bounceType?: string | null;
  raw: unknown;
}

/** Resend delivers webhooks signed via Svix, which needs three headers (not one signature string
 * like WhatsApp/Meta's X-Hub-Signature-256) -- the id and timestamp are part of what gets signed,
 * not just the signature itself. All three optional/nullable since a malformed or spoofed request
 * may be missing any of them; verifyWebhookSignature() must reject cleanly rather than throw. */
export interface EmailWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export interface EmailProvider {
  readonly providerName: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
  /** Verifies an inbound webhook is genuinely from this provider, before parseWebhookEvent() is
   * ever trusted -- must run first. Sync: Resend/Svix's verification (like WhatsApp/Meta's) is a
   * pure local HMAC comparison, no server-to-server round trip needed (contrast
   * BillingGatewayProvider.verifyWebhookSignature, which is async because PayFast's recommended
   * verification needs one). */
  verifyWebhookSignature(rawBody: string, headers: EmailWebhookHeaders): boolean;
  parseWebhookEvent(rawBody: string): EmailWebhookEvent;
}
