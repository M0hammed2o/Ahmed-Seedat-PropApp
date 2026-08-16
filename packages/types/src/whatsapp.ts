import type { WhatsAppNotificationType, WhatsAppStatus, VerifiedPhoneEntityType } from './enums';

// Vendor-agnostic WhatsApp provider boundary (WHATSAPP.md §5), mirroring
// DocumentIntelligenceProvider/EmailProvider's shape.

export type { WhatsAppNotificationType };

export interface SendWhatsAppTemplateInput {
  to: string; // E.164
  templateName: WhatsAppNotificationType;
  variables: Record<string, string>;
  orgId: string;
}

export interface SendWhatsAppTemplateResult {
  providerMessageId: string;
}

/**
 * WhatsApp V1 completion pass, Phase H (WORKLOG.md this date). A freeform (non-template) reply --
 * only valid within Meta's 24-hour customer-service window after the recipient's last inbound
 * message (WHATSAPP.md §3's own documented rule). Provider-layer foundation ONLY: no caller in
 * this codebase invokes this yet (no LLM orchestration, no auto-reply route) -- built so a future
 * controlled assistant has a real, tested send primitive to call into, per this pass's own explicit
 * "implement only the provider/service abstraction needed for future use" instruction. Deliberately
 * NOT part of WhatsAppNotificationType's closed enum -- that enum is specifically "pre-approved
 * template names Meta can send outside the session window" (WHATSAPP.md §2); a freeform reply is
 * the opposite case (inside the window, no template), so it needs its own destination-and-body
 * shape, not a templateName.
 */
export interface SendWhatsAppFreeformInput {
  to: string; // E.164 -- MUST come from a verified, server-resolved identity, never client-supplied
  body: string;
  orgId: string;
}

export interface SendWhatsAppFreeformResult {
  providerMessageId: string;
}

export type InboundWhatsAppEventKind = 'message' | 'status_callback';

export interface InboundWhatsAppEvent {
  kind: InboundWhatsAppEventKind;
  from?: string; // E.164, present for kind='message'
  body?: string;
  /** Provider-assigned id for THIS inbound message (Meta's wamid...) -- the idempotency key
   * WHATSAPP.md §4 point 4 requires ("idempotent by provider-assigned message id"). Optional since
   * a mock/test payload may not carry one. */
  providerMessageId?: string;
  rawPayload: unknown;
}

export interface WhatsAppStatusCallback {
  providerMessageId: string;
  status: Extract<WhatsAppStatus, 'sent' | 'delivered' | 'read' | 'failed'>;
  failureReason?: string;
}

/** Which parse method a caller should use for a given raw webhook payload -- Meta (and most BSPs)
 * nest both inbound messages and delivery-status callbacks under the same top-level shape,
 * distinguished only by which inner key is present. A provider-agnostic seam so the webhook route
 * never needs to know a specific BSP's JSON structure itself (WHATSAPP.md §5's provider-agnostic
 * boundary), mirroring how EmailProvider.parseWebhookEvent's single `type` field already tells its
 * caller what kind of event it received. */
export type WhatsAppWebhookEventKind = 'message' | 'status_callback' | 'unknown';

export interface WhatsAppProvider {
  sendTemplateMessage(input: SendWhatsAppTemplateInput): Promise<SendWhatsAppTemplateResult>;
  /** Phase H, WhatsApp V1 completion pass -- see SendWhatsAppFreeformInput's own doc comment. */
  sendFreeformMessage(input: SendWhatsAppFreeformInput): Promise<SendWhatsAppFreeformResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  classifyWebhookEvent(rawBody: unknown): WhatsAppWebhookEventKind;
  parseInboundEvent(rawBody: unknown): InboundWhatsAppEvent;
  parseStatusCallback(rawBody: unknown): WhatsAppStatusCallback;
}

// WHATSAPP.md §1.2's resolution algorithm result shape -- the three branches, never a guess among
// 2+ matches (AMBIGUOUS), never inferred from message content (UNAUTHENTICATED has no context at
// all).
export interface ResolvedWhatsAppMatch {
  orgId: string;
  entityType: VerifiedPhoneEntityType;
  entityId: string;
}

export type WhatsAppResolutionResult =
  | { kind: 'unauthenticated' }
  | { kind: 'resolved'; match: ResolvedWhatsAppMatch }
  | { kind: 'ambiguous'; candidates: ResolvedWhatsAppMatch[] };
