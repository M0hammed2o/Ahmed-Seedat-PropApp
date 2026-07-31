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
