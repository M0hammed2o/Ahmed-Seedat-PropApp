import type { DocumentType } from './enums';

export interface ProcessingInput {
  documentId: string;
  storagePath: string;
  mimeType: string;
  /** A short-lived signed URL the caller (an API route, which already holds a Supabase client)
   * resolves before calling a real provider -- so a provider implementation never needs storage/DB
   * access of its own (matches the "no DB access from a provider class" boundary every other
   * provider in this codebase follows, e.g. payfast.ts/email.ts). Optional because
   * MockDocumentIntelligenceProvider never reads it -- only a provider that genuinely needs the
   * file's bytes (AWSTextractDocumentIntelligenceProvider) does. */
  signedUrl?: string;
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
  // Bill/invoice-shaped fields (Phase 1, implemented).
  supplierName?: ExtractedField<string>;
  accountNumber?: ExtractedField<string>;
  amountDue?: ExtractedField<number>;
  dueDate?: ExtractedField<string>;
  statementDate?: ExtractedField<string>;
  invoiceNumber?: ExtractedField<string>;
  paymentReference?: ExtractedField<string>;
  // Lease-shaped fields (TASKS.md M12, DOCUMENT_INTELLIGENCE.md). Deliberately on the same
  // all-optional result type rather than a separate LeaseFieldExtractionResult -- the caller
  // already knows which fields to expect from the `documentType` it passed into extractFields(),
  // and a single result shape keeps the confirmation-screen review pattern (every field, whatever
  // document type, gets the identical edit-before-accept treatment) uniform across document types.
  tenantName?: ExtractedField<string>;
  rentAmount?: ExtractedField<number>;
  depositAmount?: ExtractedField<number>;
  leaseStartDate?: ExtractedField<string>;
  leaseEndDate?: ExtractedField<string>;
  propertyAddress?: ExtractedField<string>;
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
  ownerUserId: string | null;
  orgId: string | null;
  status: 'queued' | 'processing' | 'succeeded' | 'failed' | 'needs_review';
  attempt: number;
  providerName: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Persisted counterpart of FieldExtractionResult (TASKS.md M20 Documents/OCR review slice).
 * `reviewedAt`/`reviewedBy` are set by POST /api/v1/documents/:id/review -- a human confirming
 * (not necessarily correcting) the extraction is accurate, never an auto-apply onto a business
 * record (DOCUMENT_INTELLIGENCE.md's "always confirm before treating as final" rule).
 */
export interface ExtractionResult {
  id: string;
  extractionJobId: string;
  ownerUserId: string | null;
  orgId: string | null;
  rawProviderOutput: FieldExtractionResult;
  overallConfidence: number | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
}
