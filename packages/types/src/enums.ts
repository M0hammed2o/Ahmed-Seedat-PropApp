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
  'lease',
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

// --- PropertyVault multi-tenancy enums (see DATABASE.md, supabase/migrations/20260101000016+) ---

export const ORGANIZATION_STATUSES = [
  'trial',
  'active',
  'overdue',
  'suspended',
  'cancelled',
] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const ORGANIZATION_TYPES = ['owner_managed', 'agency'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_MEMBER_ROLES = [
  'principal',
  'manager',
  'agent',
  'accountant',
  'viewer',
] as const;
export type OrganizationMemberRole = (typeof ORGANIZATION_MEMBER_ROLES)[number];

export const ORGANIZATION_MEMBER_STATUSES = ['invited', 'active', 'revoked'] as const;
export type OrganizationMemberStatus = (typeof ORGANIZATION_MEMBER_STATUSES)[number];

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const UNIT_STATUSES = ['vacant', 'occupied', 'maintenance'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const OWNER_TYPES = ['individual', 'company', 'trust'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const TENANT_STATUSES = ['active', 'expired', 'pending'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const APPLICATION_SCREENING_STATUSES = ['not_started', 'in_progress', 'passed', 'failed'] as const;
export type ApplicationScreeningStatus = (typeof APPLICATION_SCREENING_STATUSES)[number];

export const APPLICATION_STATUSES = ['submitted', 'screening', 'decided'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_DECISIONS = ['approved', 'declined'] as const;
export type ApplicationDecision = (typeof APPLICATION_DECISIONS)[number];

export const RENT_FREQUENCIES = ['monthly'] as const;
export type RentFrequency = (typeof RENT_FREQUENCIES)[number];

export const LEASE_STATUSES = ['draft', 'active', 'expired', 'terminated'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const LEASE_SOURCES = ['manual', 'pdf_parsed', 'application_approved'] as const;
export type LeaseSource = (typeof LEASE_SOURCES)[number];

export const RENT_SCHEDULE_STATUSES = ['pending', 'invoiced', 'paid', 'overdue', 'partial'] as const;
export type RentScheduleStatus = (typeof RENT_SCHEDULE_STATUSES)[number];

export const MAINTENANCE_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_STATUSES = ['to_do', 'in_progress', 'pending_approval', 'completed'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const VENDOR_TRADE_CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'appliance_repair',
  'painting',
  'general_handyman',
  'landscaping',
  'pest_control',
  'locksmith',
  'cleaning',
  'roofing',
  'other',
] as const;
export type VendorTradeCategory = (typeof VENDOR_TRADE_CATEGORIES)[number];

export const VENDOR_STATUSES = ['active', 'inactive'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_BILL_STATUSES = ['submitted', 'approved', 'paid', 'rejected'] as const;
export type VendorBillStatus = (typeof VENDOR_BILL_STATUSES)[number];

export const INSPECTION_TYPES = ['move_in', 'move_out', 'routine'] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const INSPECTION_STATUSES = ['scheduled', 'in_progress', 'awaiting_signature', 'completed'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_CONDITION_RATINGS = ['good', 'fair', 'poor', 'damaged'] as const;
export type InspectionConditionRating = (typeof INSPECTION_CONDITION_RATINGS)[number];

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const LEDGER_CLASSES = ['business', 'trust', 'deposit'] as const;
export type LedgerClass = (typeof LEDGER_CLASSES)[number];

export const JOURNAL_SOURCE_TYPES = [
  'rent_invoice',
  'expense',
  'payment',
  'deposit',
  'owner_payout',
  'adjustment',
  'reversal',
] as const;
export type JournalSourceType = (typeof JOURNAL_SOURCE_TYPES)[number];

export const ACCOUNTING_PERIOD_STATUSES = ['open', 'closed'] as const;
export type AccountingPeriodStatus = (typeof ACCOUNTING_PERIOD_STATUSES)[number];

export const TRUST_LEDGER_ENTRY_TYPES = ['deposit_received', 'interest_accrued', 'deduction', 'refund'] as const;
export type TrustLedgerEntryType = (typeof TRUST_LEDGER_ENTRY_TYPES)[number];

export const BANK_ACCOUNT_CLASSES = ['business', 'trust'] as const;
export type BankAccountClass = (typeof BANK_ACCOUNT_CLASSES)[number];

export const BANK_TRANSACTION_MATCH_STATUSES = ['unmatched', 'matched', 'ignored'] as const;
export type BankTransactionMatchStatus = (typeof BANK_TRANSACTION_MATCH_STATUSES)[number];

export const INVOICE_STATUSES = ['draft', 'issued', 'paid'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const EXPENSE_STATUSES = ['recorded', 'pending', 'reimbursed', 'void'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const OWNER_STATEMENT_STATUSES = ['draft', 'issued', 'paid'] as const;
export type OwnerStatementStatus = (typeof OWNER_STATEMENT_STATUSES)[number];
