-- V1 launch-completion pass: expense evidence + missing detail fields (TASKS.md M14 follow-up).
-- Confirmed against the CURRENT expenses schema (20260101000037, no later `alter table
-- public.expenses` statements existed before this one) before writing this migration, not assumed:
-- `document_id uuid references public.documents(id)` already exists on `expenses` (added in
-- 20260101000037 itself) and is already wired through packages/validation's expenseCreateSchema,
-- apps/admin/app/api/v1/expenses/route.ts, apps/admin/lib/accounting.ts's mapExpenseRow, and
-- packages/types' Expense interface -- the evidence-link direction (expense -> its one supporting
-- document, mirroring cash_receipts.document_id's identical "evidence for a financial record" use
-- case) is already established. Deliberately NOT adding a second, competing `documents.expense_id`
-- column in the other direction (the direction lease_id/unit_id/tenant_id/maintenance_ticket_id/
-- application_id use on `documents` for their one-to-many "tag this upload to its parent" case) --
-- an expense has exactly one evidence document in this design, so the existing one-to-one
-- `expenses.document_id` already covers it without inventing a second, redundant link.
--
-- What's genuinely missing (verified absent from 20260101000037's column list): unit_id,
-- reference_number, invoice_date, notes. All four added here as NULLABLE columns only -- purely
-- additive, no backfill needed, no existing row is affected, no existing constraint (including the
-- `check ((status='recorded') = (journal_entry_id is not null))` immutability guard and
-- post_journal_entry()'s chart-of-accounts guard from the prior P0 pass) is touched.

alter table public.expenses
  add column unit_id uuid references public.units(id),
  add column reference_number text check (reference_number is null or char_length(reference_number) between 1 and 100),
  add column invoice_date date,
  add column notes text check (notes is null or char_length(notes) <= 2000);

-- Mirrors expenses_property_idx's own reasoning -- cheap, only useful once populated, partial so
-- it costs nothing for the (expected-common) rows that never set a unit.
create index expenses_unit_idx on public.expenses (unit_id) where unit_id is not null;

comment on column public.expenses.unit_id is
  'Optional -- which unit within property_id this expense concerns, when it is unit-specific rather than property-wide.';
comment on column public.expenses.reference_number is
  'Optional free-text invoice/reference number from the vendor''s own paperwork.';
comment on column public.expenses.invoice_date is
  'Optional -- the date on the vendor''s invoice/receipt, distinct from created_at (when the row was entered) and the journal entry''s entry_date (when it was posted).';
comment on column public.expenses.notes is
  'Optional free-text notes, e.g. why this expense was posted without evidence.';
