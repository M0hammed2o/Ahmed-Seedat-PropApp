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
  relatedEntityType?: string;
  relatedEntityId?: string;
  attachments?: { documentId: string }[];
  replyTo?: string;
}

export interface SendEmailResult {
  providerMessageId: string;
  status: EmailStatus;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
