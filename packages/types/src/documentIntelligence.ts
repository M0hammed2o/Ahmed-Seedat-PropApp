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
  // Applicant document-shaped fields (WORKLOG.md 2026-08-25, first-tenant-workflow predeploy
  // pass) -- same "one shared all-optional result type" reasoning as the lease fields above,
  // documentType tells the caller which subset to expect.
  // id_document (SA ID book/card or passport):
  fullName?: ExtractedField<string>;
  idNumber?: ExtractedField<string>;
  dateOfBirth?: ExtractedField<string>;
  nationality?: ExtractedField<string>;
  documentExpiryDate?: ExtractedField<string>;
  // proof_of_address:
  personName?: ExtractedField<string>;
  residentialAddress?: ExtractedField<string>;
  documentDate?: ExtractedField<string>;
  // payslip / proof of income:
  employeeName?: ExtractedField<string>;
  employerName?: ExtractedField<string>;
  grossIncome?: ExtractedField<number>;
  netIncome?: ExtractedField<number>;
  payPeriod?: ExtractedField<string>;
  // bank_statement:
  accountHolderName?: ExtractedField<string>;
  statementPeriod?: ExtractedField<string>;
  overallConfidence: number;
  metadata: ProviderMetadata;
}

/**
 * Vendor-agnostic boundary. Never call a vendor SDK/API from mobile or admin client code —
 * only from server-side/Edge Function implementations of this interface. See DOCUMENT_INTELLIGENCE.md.
 */
export interface DocumentIntelligenceProvider {
  /** Stable provider identity (e.g. 'aws-textract' / 'google-document-ai' / 'mock') -- already
   * echoed on every result's own metadata.providerName; declared here too (infrastructure
   * hardening pass, WORKLOG.md this date) so a caller holding only the interface type, not a
   * concrete class, can read it BEFORE calling any method (needed to record which provider was in
   * use even when the call itself throws). Mirrors EmailProvider.providerName exactly. */
  readonly providerName: string;
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
  /** Which concrete DocumentIntelligenceProvider actually served this extraction (its own
   * `providerName`, e.g. 'aws-textract'/'google-document-ai'/'mock') -- previously only ever
   * returned in-memory as part of the result's own metadata.providerName and never persisted, so
   * there was no way to audit which vendor handled a given extraction after the fact. Mirrors
   * ExtractionJob.providerName below, which already existed as a column but was likewise never
   * written by either extract route. */
  providerName: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
}
