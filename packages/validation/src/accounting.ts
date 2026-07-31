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
