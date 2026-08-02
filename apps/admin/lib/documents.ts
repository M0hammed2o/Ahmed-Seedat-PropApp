import 'server-only';
import type { DocumentRecord, ExtractionJob, ExtractionResult } from '@propvault/types';

// Documents/OCR row mapping (apps/admin/app/api/v1/documents/**, TASKS.md M11/M20).

interface DocumentRow {
  id: string;
  owner_user_id: string | null;
  org_id: string | null;
  property_id: string;
  category_id: string;
  document_type: string;
  storage_path: string;
  original_file_name: string;
  mime_type: string;
  file_size_bytes: number;
  checksum_sha256: string;
  billing_year: number | null;
  billing_month: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapDocumentRow(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    orgId: row.org_id,
    propertyId: row.property_id,
    categoryId: row.category_id,
    documentType: row.document_type as DocumentRecord['documentType'],
    storagePath: row.storage_path,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    checksumSha256: row.checksum_sha256,
    billingYear: row.billing_year,
    billingMonth: row.billing_month,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ExtractionJobRow {
  id: string;
  document_id: string;
  owner_user_id: string | null;
  org_id: string | null;
  status: string;
  attempt: number;
  provider_name: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function mapExtractionJobRow(row: ExtractionJobRow): ExtractionJob {
  return {
    id: row.id,
    documentId: row.document_id,
    ownerUserId: row.owner_user_id,
    orgId: row.org_id,
    status: row.status as ExtractionJob['status'],
    attempt: row.attempt,
    providerName: row.provider_name,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ExtractionResultRow {
  id: string;
  extraction_job_id: string;
  owner_user_id: string | null;
  org_id: string | null;
  raw_provider_output: unknown;
  overall_confidence: number | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

export function mapExtractionResultRow(row: ExtractionResultRow): ExtractionResult {
  return {
    id: row.id,
    extractionJobId: row.extraction_job_id,
    ownerUserId: row.owner_user_id,
    orgId: row.org_id,
    rawProviderOutput: row.raw_provider_output as ExtractionResult['rawProviderOutput'],
    overallConfidence: row.overall_confidence,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at,
  };
}
