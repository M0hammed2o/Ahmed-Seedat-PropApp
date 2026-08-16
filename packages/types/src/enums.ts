// Closed, stable enums mirrored 1:1 with Postgres enum types created in supabase/migrations.
// Keep in sync with the migration that defines each type — see DATABASE.md.

export const PROPERTY_STATUSES = ['active', 'archived'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const PROPERTY_TYPES = [
  'house',
  'apartment',
  'apartment_building',
  'townhouse',
  'vacant_land',
  'commercial',
  'retail',
  'office',
  'industrial',
  'mixed_use',
  'student_accommodation',
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

// 'archived' added by migration 20260101000025 -- was missing here until TASKS.md M19 found the
// drift while wiring POST /api/v1/admin/organizations/:orgId/archive (the first real writer of
// this value; nothing had ever exercised the gap before). Confirmed live via `select enumlabel
// from pg_enum ... where typname = 'organization_status'` before fixing, not assumed.
export const ORGANIZATION_STATUSES = [
  'trial',
  'active',
  'overdue',
  'suspended',
  'cancelled',
  'archived',
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

// Owner + staff access completion pass (WORKLOG.md this date): previously only ever defined
// locally inside StaffAccessPanel.tsx (as a bare Record<string,string>) -- shared here so the
// staff invitation form can use the exact same list, matching the migration
// 20260101000063 property_role enum ('owner' excluded -- staff invitation never grants owner
// property_role, that comes only from real property_owners ownership + owner-linking).
export const STAFF_PROPERTY_ROLES = [
  'administrator',
  'property_manager',
  'accountant',
  'maintenance_manager',
  'read_only',
] as const;
export type StaffPropertyRole = (typeof STAFF_PROPERTY_ROLES)[number];

export const PROPERTY_ACCESS_MODES = ['all', 'selected'] as const;
export type PropertyAccessMode = (typeof PROPERTY_ACCESS_MODES)[number];

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const UNIT_STATUSES = ['vacant', 'occupied', 'maintenance'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const OWNER_TYPES = ['individual', 'company', 'trust'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const TENANT_STATUSES = ['active', 'expired', 'pending'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const APPLICATION_SCREENING_STATUSES = [
  'not_started',
  'in_progress',
  'passed',
  'failed',
] as const;
export type ApplicationScreeningStatus = (typeof APPLICATION_SCREENING_STATUSES)[number];

// 'screening' is retained (dormant, V2 candidate -- ROADMAP.md) but no V1 UI path sets it.
// 'reviewing'/'withdrawn' added 2026-08-01 for the simplified V1 applications workflow.
export const APPLICATION_STATUSES = [
  'submitted',
  'reviewing',
  'screening',
  'decided',
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_DECISIONS = ['approved', 'declined'] as const;
export type ApplicationDecision = (typeof APPLICATION_DECISIONS)[number];

export const RENT_FREQUENCIES = ['monthly'] as const;
export type RentFrequency = (typeof RENT_FREQUENCIES)[number];

export const LEASE_STATUSES = ['draft', 'active', 'expired', 'terminated'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const LEASE_SOURCES = ['manual', 'pdf_parsed', 'application_approved'] as const;
export type LeaseSource = (typeof LEASE_SOURCES)[number];

export const RENT_SCHEDULE_STATUSES = [
  'pending',
  'invoiced',
  'paid',
  'overdue',
  'partial',
] as const;
export type RentScheduleStatus = (typeof RENT_SCHEDULE_STATUSES)[number];

export const MAINTENANCE_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_STATUSES = [
  'to_do',
  'in_progress',
  'pending_approval',
  'completed',
] as const;
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

export const INSPECTION_STATUSES = [
  'scheduled',
  'in_progress',
  'awaiting_signature',
  'completed',
] as const;
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

export const TRUST_LEDGER_ENTRY_TYPES = [
  'deposit_received',
  'interest_accrued',
  'deduction',
  'refund',
] as const;
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

export const NOTIFICATION_CATEGORIES = [
  'rent',
  'maintenance',
  'lease',
  'inspections',
  'announcements',
  'security',
  'promotional',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const EMAIL_STATUSES = ['queued', 'sent', 'delivered', 'bounced', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_SUPPRESSION_REASONS = ['hard_bounce', 'spam_complaint'] as const;
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

export const WHATSAPP_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export type WhatsAppStatus = (typeof WHATSAPP_STATUSES)[number];

export const VERIFIED_PHONE_ENTITY_TYPES = ['tenant', 'owner', 'organization_member'] as const;
export type VerifiedPhoneEntityType = (typeof VERIFIED_PHONE_ENTITY_TYPES)[number];

export const WHATSAPP_CONVERSATION_STATE_TYPES = ['none', 'awaiting_context_selection'] as const;
export type WhatsAppConversationStateType = (typeof WHATSAPP_CONVERSATION_STATE_TYPES)[number];

// WHATSAPP.md §2: closed trigger list, the ONLY accepted input to the WhatsApp send dispatcher --
// no sendWhatsApp(freeformText) entry point exists anywhere. Adding a trigger means adding a
// value here, a template, and a code review, not a string.
//
// WhatsApp production readiness pass (WORKLOG.md this date): 'payment_accepted',
// 'maintenance_update_critical', and 'tenant_invitation' renamed to 'payment_received_confirmation',
// 'maintenance_request_update', and 'tenant_account_invitation' respectively -- these are the
// ONLY three values with a real, currently-wired dispatch call site, and each rename matches the
// exact Meta-approved template name Mohammed created for it (the old template names were deleted
// and no longer exist in Meta Business Manager; sending under the old name would fail outright).
//
// WhatsApp V1 completion pass (WORKLOG.md this date): 'payment_awaiting_confirmation' renamed to
// 'payment_confirmation_required' and wired for real (Phase B) -- it's the exact same
// owner-facing "a payment needs your review" concept this enum already modeled, just now with a
// real trigger (payment_reports, migration 20260101000106) and a real recipient-resolution path
// (linked owners with a phone on file, via property_owners) that didn't exist before this pass.
//
// WhatsApp V1 completion pass (WORKLOG.md this date), Phase E: 'rent_overdue_material' renamed to
// 'rent_overdue_notice' and 'lease_expiring_soon' renamed to 'lease_expiry_reminder' -- both now
// have real triggers (rent_schedules_overdue_unreminded()/leases_expiring_unreminded(), migration
// 20260101000106) and match Mohammed's new template names as the closest existing tenant-facing
// semantic equivalent. 'rent_payment_reminder' is genuinely new (no "upcoming, not yet overdue"
// reminder concept existed in this enum before). The OWNER-facing variants
// ('rent_overdue_significant', 'lease_expiring_soon_owner') are deliberately left untouched and
// unwired -- Mohammed's 8 new templates don't obviously distinguish a tenant vs. owner audience
// for these two, and guessing that mapping would be exactly the kind of speculative rename this
// pass was told to avoid; see the session's own readiness report for this open question.
export const WHATSAPP_NOTIFICATION_TYPES = [
  'rent_overdue_notice',
  'payment_received_confirmation',
  'payment_rejected',
  'lease_expiry_reminder',
  'urgent_property_announcement',
  'inspection_reminder_important',
  'maintenance_request_update',
  'document_missing_required',
  'id_document_expiring',
  'payment_confirmation_required',
  'rent_payment_reminder',
  'payment_discrepancy',
  'rent_overdue_significant',
  'lease_expiring_soon_owner',
  'maintenance_approval_urgent',
  'account_security_event',
  'owner_statement_available',
  // PRODUCT DECISION 2 (2026-08-03): tenant activation delivered via WhatsApp -- a real,
  // synchronous trigger (staff clicks "Send invitation"), matching this list's existing
  // "already has a real trigger" discipline (WHATSAPP.md §2).
  'tenant_account_invitation',
] as const;
export type WhatsAppNotificationType = (typeof WHATSAPP_NOTIFICATION_TYPES)[number];

export const AI_MESSAGE_ROLES = ['user', 'assistant'] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export const PORTFOLIO_INSIGHT_SEVERITIES = ['info', 'warning', 'urgent'] as const;
export type PortfolioInsightSeverity = (typeof PORTFOLIO_INSIGHT_SEVERITIES)[number];

// AI_ARCHITECTURE.md §2.2: fixed rule set the Portfolio Intelligence rules engine evaluates --
// closed list, matching the WhatsApp trigger-list pattern above. Adding an insight type means
// adding a value here, a rule, and a severity table row (AI_ARCHITECTURE.md §2.4), not a string.
export const PORTFOLIO_INSIGHT_TYPES = [
  'rent_overdue',
  'rent_due_soon',
  'lease_expiring',
  'maintenance_open',
  'invoice_unpaid',
] as const;
export type PortfolioInsightType = (typeof PORTFOLIO_INSIGHT_TYPES)[number];

export const USAGE_TYPES = [
  'storage_bytes',
  'email_sent',
  'whatsapp_sent',
  'ocr_page',
  'ai_token',
] as const;
export type UsageType = (typeof USAGE_TYPES)[number];

// PRODUCT DECISION 2 (2026-08-03): tenant activation. Deliberately a separate enum/table from
// organization_invites -- see supabase/migrations/20260101000059's own header comment for why.
export const TENANT_INVITATION_DELIVERY_CHANNELS = ['email', 'whatsapp', 'manual'] as const;
export type TenantInvitationDeliveryChannel = (typeof TENANT_INVITATION_DELIVERY_CHANNELS)[number];

export const OWNER_INVITATION_DELIVERY_CHANNELS = ['email', 'manual'] as const;
export type OwnerInvitationDeliveryChannel = (typeof OWNER_INVITATION_DELIVERY_CHANNELS)[number];

// Mirrors accept_tenant_invitation()'s error_code return values exactly (migration
// 20260101000059's own comment lists them) -- the UI switches on these to show the right
// expired/invalid/already-linked state, never a raw Postgres error string.
export const TENANT_INVITATION_ERROR_CODES = [
  'not_found',
  'invalid_code',
  'locked_out',
  'revoked',
  'expired',
  'already_used',
  'org_inactive',
  'already_linked',
  'email_mismatch',
] as const;
export type TenantInvitationErrorCode = (typeof TENANT_INVITATION_ERROR_CODES)[number];

// PWA_V1_COMPLETION_PLAN.md #9. 'archived' covers both a deliberately retired template and one
// superseded by a replacement (supersedes_id on the newer row links the chain -- no separate
// 'superseded' value needed, an archived-because-replaced row and an archived-because-retired row
// are the same "not currently offered" state from every caller's perspective).
export const LEASE_TEMPLATE_STATUSES = ['active', 'archived'] as const;
export type LeaseTemplateStatus = (typeof LEASE_TEMPLATE_STATUSES)[number];

// Deliberately narrower than ALLOWED_MIME_TYPES -- a lease template is a document staff fill in
// and reuse, not a scanned bill/receipt photo, so image types are out.
export const LEASE_TEMPLATE_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export type LeaseTemplateMimeType = (typeof LEASE_TEMPLATE_MIME_TYPES)[number];
