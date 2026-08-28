import { z } from 'zod';

// Accounting periods API (apps/admin/app/api/v1/accounting-periods -- ACCOUNTING.md §9,
// TASKS.md M14). No journal-entry create schema here on purpose: ACCOUNTING.md §3 -- "no generic
// post a journal entry API exists" -- posting always goes through a typed server-side operation
// calling post_journal_entry() directly, never a client-supplied free-form entry.
export const accountingPeriodCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  periodStart: z.string().min(1, 'periodStart is required (YYYY-MM-DD)'),
  periodEnd: z.string().min(1, 'periodEnd is required (YYYY-MM-DD)'),
});
export type AccountingPeriodCreateInput = z.infer<typeof accountingPeriodCreateSchema>;

// Expenses API (apps/admin/app/api/v1/expenses). Create only inserts a 'pending' row -- posting
// (record_expense()) is a separate, explicit action, matching ACCOUNTING.md §3's "An expenses row
// is marked recorded" trigger wording.
export const expenseCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  propertyId: z.string().uuid('propertyId must be a valid UUID'),
  unitId: z.string().uuid().optional().nullable(),
  vendorId: z.string().uuid().optional().nullable(),
  category: z.string().min(1, 'Category is required').max(100),
  amount: z.number().min(0),
  documentId: z.string().uuid().optional().nullable(),
  referenceNumber: z.string().max(100).optional().nullable(),
  invoiceDate: z.string().min(1, 'invoiceDate must be YYYY-MM-DD').optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

// Evidence gate (V1 launch-completion pass): record_expense() itself is untouched -- this schema
// only shapes the request body for the thin wrapper route
// (apps/admin/app/api/v1/expenses/[id]/record/route.ts), which decides server-side whether
// exceptionReason is actually required (only when the expense has no linked document_id). A
// 10-char floor matches this codebase's other free-text-justification fields' own "not just a
// single word" bar (e.g. deductionMemo has no such floor since it's optional context, but this one
// is a compliance justification, not a memo).
export const expenseRecordSchema = z.object({
  paidImmediately: z.boolean().default(false),
  exceptionReason: z
    .string()
    .trim()
    .min(10, 'Explain why this is being posted without evidence (at least 10 characters).')
    .max(1000)
    .optional(),
});
export type ExpenseRecordInput = z.infer<typeof expenseRecordSchema>;

export const expenseAttachEvidenceSchema = z.object({
  documentId: z.string().uuid('documentId must be a valid UUID'),
});
export type ExpenseAttachEvidenceInput = z.infer<typeof expenseAttachEvidenceSchema>;

// Bank accounts/transactions API.
export const bankAccountCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  accountClass: z.enum(['business', 'trust']).default('business'),
  bankName: z.string().min(1, 'Bank name is required').max(200),
});
export type BankAccountCreateInput = z.infer<typeof bankAccountCreateSchema>;

// V1 launch-completion pass: property/unit/tenant/vendor/category/document/notes are all
// optional manual tags (migration 20260101000146) -- purely informational/filterable, never read
// by confirm_bank_transaction_match()/match_bank_transaction_to_expense() (both derive the real
// property_id etc. from whatever they matched against).
export const bankTransactionCreateSchema = z.object({
  bankAccountId: z.string().uuid('bankAccountId must be a valid UUID'),
  transactionDate: z.string().min(1, 'transactionDate is required (YYYY-MM-DD)'),
  amount: z.number(),
  description: z.string().max(500).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
  propertyId: z.string().uuid().optional().nullable(),
  unitId: z.string().uuid().optional().nullable(),
  tenantId: z.string().uuid().optional().nullable(),
  vendorId: z.string().uuid().optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  documentId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type BankTransactionCreateInput = z.infer<typeof bankTransactionCreateSchema>;

export const bankTransactionConfirmMatchSchema = z.object({
  rentScheduleId: z.string().uuid('rentScheduleId must be a valid UUID'),
});
export type BankTransactionConfirmMatchInput = z.infer<typeof bankTransactionConfirmMatchSchema>;

// V1 launch-completion pass: the second real matching destination (migration 20260101000146),
// alongside confirm_bank_transaction_match()'s rent-schedule case above.
export const bankTransactionMatchExpenseSchema = z.object({
  expenseId: z.string().uuid('expenseId must be a valid UUID'),
});
export type BankTransactionMatchExpenseInput = z.infer<typeof bankTransactionMatchExpenseSchema>;

// Trust deposit release (ACCOUNTING.md §4, TASKS.md M14 part 3). deductionAmount + refundAmount
// must equal the trust ledger's current_balance -- enforced server-side by
// release_trust_deposit() itself, not re-derived here (this schema only validates shape).
export const trustDepositReleaseSchema = z.object({
  deductionAmount: z.number().min(0).default(0),
  refundAmount: z.number().min(0).default(0),
  deductionMemo: z.string().max(500).optional().nullable(),
});
export type TrustDepositReleaseInput = z.infer<typeof trustDepositReleaseSchema>;

// Owner statements (ACCOUNTING.md §5/§10, API_SPEC.md §6). "draft" is the month-scoped batch
// generation endpoint -- orgId + a period, never a client-supplied owner/amount (the service
// derives everything from the ledger, ACCOUNTING.md §5's "generated, not hand-entered" rule).
export const ownerStatementDraftSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  periodStart: z.string().min(1, 'periodStart is required (YYYY-MM-DD)'),
  periodEnd: z.string().min(1, 'periodEnd is required (YYYY-MM-DD)'),
});
export type OwnerStatementDraftInput = z.infer<typeof ownerStatementDraftSchema>;

export const ownerStatementConfirmPayoutSchema = z.object({
  bankTransactionId: z.string().uuid('bankTransactionId must be a valid UUID'),
  // Optional -- omitted means "pay the full remaining outstanding balance," matching
  // confirm_owner_statement_payout()'s own default (migration 20260101000071). A caller may pass
  // a smaller amount for a genuine partial payout.
  amount: z.number().positive('amount must be positive').optional(),
});
export type OwnerStatementConfirmPayoutInput = z.infer<typeof ownerStatementConfirmPayoutSchema>;

// Cash Management (Stage 3 Phase 7, commercial-launch execution plan, migration 20260101000073).
export const cashReceiptCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  propertyId: z.string().uuid('propertyId must be a valid UUID'),
  amount: z.number().positive('amount must be positive'),
  leaseId: z.string().uuid('leaseId must be a valid UUID').optional().nullable(),
  rentScheduleId: z.string().uuid('rentScheduleId must be a valid UUID').optional().nullable(),
  documentId: z.string().uuid('documentId must be a valid UUID').optional().nullable(),
});
export type CashReceiptCreateInput = z.infer<typeof cashReceiptCreateSchema>;

export const cashReceiptConfirmDepositSchema = z.object({
  bankTransactionId: z.string().uuid('bankTransactionId must be a valid UUID'),
  depositedAmount: z.number().positive('depositedAmount must be positive'),
});
export type CashReceiptConfirmDepositInput = z.infer<typeof cashReceiptConfirmDepositSchema>;
