import type { DocumentType } from './enums';

export interface ProcessingInput {
  documentId: string;
  storagePath: string;
  mimeType: string;
}

export interface ProviderMetadata {
  providerName: string;
  providerVersion: string | null;
  processingDurationMs: number | null;
  estimatedCostUsd: number | null;
}

export type ProviderErrorKind = 'retryable' | 'non_retryable';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly providerName: string;

  constructor(message: string, kind: ProviderErrorKind, providerName: string) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.providerName = providerName;
  }
}

export interface ClassificationResult {
  documentType: DocumentType;
  confidence: number;
  metadata: ProviderMetadata;
}

export interface OcrResult {
  rawText: string;
  confidence: number;
  metadata: ProviderMetadata;
}

export interface ExtractedField<T> {
  value: T;
  confidence: number;
}

export interface FieldExtractionResult {
  supplierName?: ExtractedField<string>;
  accountNumber?: ExtractedField<string>;
  amountDue?: ExtractedField<number>;
  dueDate?: ExtractedField<string>;
  statementDate?: ExtractedField<string>;
  invoiceNumber?: ExtractedField<string>;
  paymentReference?: ExtractedField<string>;
  overallConfidence: number;
  metadata: ProviderMetadata;
}

/**
 * Vendor-agnostic boundary. Never call a vendor SDK/API from mobile or admin client code —
 * only from server-side/Edge Function implementations of this interface. See DOCUMENT_INTELLIGENCE.md.
 */
export interface DocumentIntelligenceProvider {
  classify(input: ProcessingInput): Promise<ClassificationResult>;
  extractText(input: ProcessingInput): Promise<OcrResult>;
  extractFields(input: ProcessingInput, documentType: DocumentType): Promise<FieldExtractionResult>;
}

export interface ExtractionJob {
  id: string;
  documentId: string;
  ownerUserId: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed' | 'needs_review';
  attempt: number;
  providerName: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
