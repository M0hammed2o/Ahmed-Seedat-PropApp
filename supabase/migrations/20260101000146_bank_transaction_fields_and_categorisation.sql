-- V1 launch-completion pass: bank_transactions gets the fields an accountant needs to actually
-- categorise a bank-statement line (property/unit/tenant/vendor/category/evidence/notes -- all
-- additive, nullable, TASKS.md/ACCOUNTING.md gap), plus a second real matching destination
-- (Expense) alongside the existing rent-schedule matching. confirm_bank_transaction_match()
-- itself (20260101000038/73) is untouched -- this migration only adds new, parallel
-- functionality, matching the same idempotency ("already matched" raises first) and
-- ledger-posting-through-an-existing-function shape that function already established.
--
-- Deliberately NOT built this pass (would need new chart-of-accounts categories/posting
-- semantics that don't exist yet): owner-contribution, owner-withdrawal, supplier-payment
-- (as distinct from an existing expense), refund, other-income, other-expense. Tracked as
-- open work, same as record_expense()'s own migration (20260101000038) left
-- release_trust_deposit()/accrue_trust_interest() as disclosed follow-ups rather than guessing at
-- an unspecified mapping.

alter table public.bank_transactions
  add column property_id uuid references public.properties(id),
  add column unit_id uuid references public.units(id),
  add column tenant_id uuid references public.tenants(id),
  add column vendor_id uuid references public.vendors(id),
  add column category text,
  add column document_id uuid references public.documents(id),
  add column notes text,
  -- Set only by match_bank_transaction_to_expense() below, mirroring matched_rent_schedule_id's
  -- own shape (a nullable pointer to whichever destination this transaction was matched against).
  add column expense_id uuid references public.expenses(id);

comment on column public.bank_transactions.property_id is
  'Optional manual tag -- which property this bank-statement line relates to. Purely
   informational/filterable; never read by confirm_bank_transaction_match() or
   match_bank_transaction_to_expense() (both derive the real property_id from whatever they
   matched against instead).';
comment on column public.bank_transactions.unit_id is 'Optional manual tag, same shape as property_id.';
comment on column public.bank_transactions.tenant_id is 'Optional manual tag, same shape as property_id.';
comment on column public.bank_transactions.vendor_id is 'Optional manual tag, same shape as property_id.';
comment on column public.bank_transactions.category is
  'Optional free-text categorisation label for staff filtering/reporting -- distinct from
   expenses.category, which drives real chart-of-accounts posting inside record_expense().';
comment on column public.bank_transactions.document_id is
  'Optional supporting-evidence document (e.g. a bank statement excerpt or proof screenshot),
   same bank_transactions.document_id -> documents.id direction cash_receipts.document_id
   already uses.';
comment on column public.bank_transactions.notes is 'Optional free-text staff note.';
comment on column public.bank_transactions.expense_id is
  'Set by match_bank_transaction_to_expense() when this transaction was matched to an existing
   expense, mirroring matched_rent_schedule_id''s role for the rent-matching destination.';

create index bank_transactions_property_idx on public.bank_transactions (property_id) where property_id is not null;
create index bank_transactions_expense_idx on public.bank_transactions (expense_id) where expense_id is not null;

-- === match_bank_transaction_to_expense(): the "Expense" matching destination ===
-- Reconciles a bank-statement line against an expense staff already recorded manually
-- (status = 'pending'), by calling record_expense() as a black box (never duplicating its own
-- category-to-account posting logic) with p_paid_immediately = true -- this transaction IS the
-- evidence the expense was actually paid, via this exact bank line. Same
-- accountant-role/already-matched/not-found-or-cross-org/not-pending guard order as
-- confirm_bank_transaction_match() (20260101000038/73), so the two destinations behave
-- identically from the caller's point of view.
create or replace function public.match_bank_transaction_to_expense(
  p_bank_transaction_id uuid,
  p_expense_id uuid
)
returns uuid
language plpgsql
as $$
declare
  v_transaction public.bank_transactions%rowtype;
  v_bank_account public.bank_accounts%rowtype;
  v_expense public.expenses%rowtype;
  v_journal_entry_id uuid;
begin
  select * into v_transaction from public.bank_transactions where id = p_bank_transaction_id;
  if not found then
    raise exception 'Bank transaction not found';
  end if;

  select * into v_bank_account from public.bank_accounts where id = v_transaction.bank_account_id;
  if not public.has_org_role(v_bank_account.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_transaction.match_status = 'matched' then
    raise exception 'Bank transaction % is already matched', p_bank_transaction_id;
  end if;

  select * into v_expense from public.expenses
  where id = p_expense_id and org_id = v_bank_account.org_id;
  if not found then
    raise exception 'Expense not found (or not in the same org as the bank account)';
  end if;
  if v_expense.status <> 'pending' then
    raise exception 'Expense % is not pending (current status: %)', p_expense_id, v_expense.status;
  end if;

  -- record_expense() does all the real posting work (category-to-account matching, Dr Expense /
  -- Cr Business Bank since paid_immediately, marking the expense 'recorded') -- this function
  -- never duplicates that logic, only reconciles the bank line against its result.
  v_journal_entry_id := public.record_expense(p_expense_id, true);

  update public.bank_transactions
  set match_status = 'matched', matched_journal_entry_id = v_journal_entry_id, expense_id = p_expense_id
  where id = p_bank_transaction_id;

  return v_journal_entry_id;
end;
$$;

comment on function public.match_bank_transaction_to_expense(uuid, uuid) is
  'Reconciles a bank-statement line against an existing pending expense by calling
   record_expense(p_expense_id, p_paid_immediately := true) internally (Dr [category] Expense,
   Cr Business Bank). Idempotent the same way confirm_bank_transaction_match() is -- raises if
   the transaction is already matched, before any posting. V1 scope: only the Rent
   (confirm_bank_transaction_match) and Expense (this function) destinations are implemented --
   owner-contribution/withdrawal/refund/other-income/other-expense need new chart-of-accounts
   modelling not built this pass.';
