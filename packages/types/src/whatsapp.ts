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
