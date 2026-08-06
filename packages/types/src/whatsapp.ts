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
  rawPayload: unknown;
}

export interface WhatsAppStatusCallback {
  providerMessageId: string;
  status: Extract<WhatsAppStatus, 'sent' | 'delivered' | 'read' | 'failed'>;
  failureReason?: string;
}

export interface WhatsAppProvider {
  sendTemplateMessage(input: SendWhatsAppTemplateInput): Promise<SendWhatsAppTemplateResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
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
