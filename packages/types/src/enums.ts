// Closed, stable enums mirrored 1:1 with Postgres enum types created in supabase/migrations.
// Keep in sync with the migration that defines each type — see DATABASE.md.

export const PROPERTY_STATUSES = ['active', 'archived'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const PROPERTY_TYPES = [
  'house',
  'apartment',
  'townhouse',
  'vacant_land',
  'commercial',
  'other',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const DOCUMENT_TYPES = [
  'bill',
  'statement',
  'proof_of_payment',
  'receipt',
  'supporting_document',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DEFAULT_DOCUMENT_CATEGORIES = [
  'water',
  'electricity',
  'rates_and_taxes',
  'levies',
  'insurance',
  'bond',
  'maintenance',
  'rental_documents',
  'proof_of_payment',
  'receipt',
  'compliance_documents',
  'tax_documents',
  'other',
] as const;
export type DefaultDocumentCategorySlug = (typeof DEFAULT_DOCUMENT_CATEGORIES)[number];

export const BILL_STATUSES = [
  'processing',
  'needs_review',
  'unpaid',
  'partially_paid',
  'paid',
  'overdue',
  'disputed',
  'void',
] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = [
  'unknown',
  'trialing',
  'active',
  'grace_period',
  'billing_issue',
  'expired',
  'cancelled',
  'revoked',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const ADMIN_ROLES = [
  'super_admin',
  'support_admin',
  'operations_admin',
  'read_only_admin',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const EXTRACTION_JOB_STATUSES = [
  'queued',
  'processing',
  'succeeded',
  'failed',
  'needs_review',
] as const;
export type ExtractionJobStatus = (typeof EXTRACTION_JOB_STATUSES)[number];

export const PAYMENT_MATCH_STATUSES = ['proposed', 'confirmed', 'rejected', 'unlinked'] as const;
export type PaymentMatchStatus = (typeof PAYMENT_MATCH_STATUSES)[number];
