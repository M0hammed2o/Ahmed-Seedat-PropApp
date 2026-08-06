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
  vendorId: z.string().uuid().optional().nullable(),
  category: z.string().min(1, 'Category is required').max(100),
  amount: z.number().min(0),
  documentId: z.string().uuid().optional().nullable(),
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

export const expenseRecordSchema = z.object({
  paidImmediately: z.boolean().default(false),
});
export type ExpenseRecordInput = z.infer<typeof expenseRecordSchema>;

// Bank accounts/transactions API.
export const bankAccountCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
  accountClass: z.enum(['business', 'trust']).default('business'),
  bankName: z.string().min(1, 'Bank name is required').max(200),
});
export type BankAccountCreateInput = z.infer<typeof bankAccountCreateSchema>;

export const bankTransactionCreateSchema = z.object({
  bankAccountId: z.string().uuid('bankAccountId must be a valid UUID'),
  transactionDate: z.string().min(1, 'transactionDate is required (YYYY-MM-DD)'),
  amount: z.number(),
  description: z.string().max(500).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
});
export type BankTransactionCreateInput = z.infer<typeof bankTransactionCreateSchema>;

export const bankTransactionConfirmMatchSchema = z.object({
  rentScheduleId: z.string().uuid('rentScheduleId must be a valid UUID'),
});
export type BankTransactionConfirmMatchInput = z.infer<typeof bankTransactionConfirmMatchSchema>;

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
