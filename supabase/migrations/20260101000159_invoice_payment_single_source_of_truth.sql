-- Invoice-payment single-source-of-truth correction pass (WORKLOG.md this date). LOCAL ONLY --
-- production migration head remains 157; this file has NOT been applied to production and is not
-- to be pushed or deployed.
--
-- Review of migration 158 found it did not actually complete the approved Option A architecture:
-- confirm_bank_transaction_match()/confirm_cash_receipt_deposit() (the pre-existing rent-matching
-- RPCs) never created an invoice_payments row at all -- a rent invoice's "paid" figure was really
-- a THREE-WAY sum (bank_transactions + cash_receipts + invoice_payments) computed independently in
-- both recompute_rent_schedule_status() and the TypeScript loadInvoicesWithBalances(), rather than
-- invoice_payments being the one authoritative allocation ledger the approved brief specified. This
-- did not cause a live double-count (the bank-matched path and the invoice_payments path never
-- overlapped, since the former never wrote to invoice_payments), but it left TWO independently
-- maintained totals that happened to agree by omission, not by construction -- and it meant the
-- Tenant Payments tab (which reads invoice_payments directly) was silently missing every rent
-- payment reconciled through ordinary bank/cash matching.
--
-- Fix: confirm_bank_transaction_match() and confirm_cash_receipt_deposit() now ALSO insert the
-- corresponding invoice_payments row (the allocation) in the same transaction as the journal entry
-- they already post -- never a second GL entry for the same money, matching
-- link_bank_transaction_to_invoice_payment()'s existing "allocation vs. posting are different
-- concerns" pattern. recompute_rent_schedule_status() and loadInvoicesWithBalances() then both
-- collapse to ONE source: sum(invoice_payments.amount where reversed_at is null). A backfill
-- catches any bank/cash matches already confirmed under the old (158) code path on this local DB.

-- ============================================================
-- 1. invoice_payments: cash_receipt_id, symmetric to the existing bank_transaction_id link -- lets
--    reverse_invoice_payment() release a cash receipt back to un-deposited state exactly as it
--    already releases a linked bank transaction back to unmatched. A payment is evidenced by at
--    most one of the two (a manually-recorded payment with neither is also valid -- evidence may
--    arrive later via link_bank_transaction_to_invoice_payment()).
-- ============================================================
alter table public.invoice_payments
  add column cash_receipt_id uuid references public.cash_receipts(id);

alter table public.invoice_payments
  add constraint invoice_payments_single_evidence_source
  check (bank_transaction_id is null or cash_receipt_id is null);

create unique index invoice_payments_cash_receipt_unique_idx
  on public.invoice_payments (cash_receipt_id) where cash_receipt_id is not null;

comment on column public.invoice_payments.cash_receipt_id is
  'Set when this allocation was created by confirm_cash_receipt_deposit() -- mutually exclusive with
   bank_transaction_id (invoice_payments_single_evidence_source). A cash deposit''s own
   bank_transaction (the aggregate deposit-slip row) is deliberately NOT linked here: one deposit
   transaction can back several cash receipts, which would violate bank_transaction_id''s own
   uniqueness. Single-source-of-truth correction pass.';

-- ============================================================
-- 2. recompute_rent_schedule_status(): collapses to ONE source now that every allocation --
--    manual, bank-matched, or cash-deposited -- lands in invoice_payments. Matches the approved
--    target formula exactly: paid_amount = SUM(invoice_payments.amount WHERE reversed_at IS NULL).
-- ============================================================
create or replace function public.recompute_rent_schedule_status(p_rent_schedule_id uuid)
returns void
language plpgsql
as $$
declare
  v_schedule public.rent_schedules%rowtype;
  v_total_paid numeric(12, 2);
  v_new_status public.rent_schedule_status;
begin
  select * into v_schedule from public.rent_schedules where id = p_rent_schedule_id;
  if not found then
    return;
  end if;

  select coalesce(sum(ip.amount), 0) into v_total_paid
  from public.invoice_payments ip
  join public.invoices i on i.id = ip.invoice_id
  where i.source = 'rent_schedule' and i.lease_id = v_schedule.lease_id
    and i.period = v_schedule.due_date and ip.reversed_at is null;

  if v_total_paid >= v_schedule.amount then
    v_new_status := 'paid';
  elsif v_total_paid > 0 then
    v_new_status := 'partial';
  elsif v_schedule.due_date < current_date then
    v_new_status := 'overdue';
  else
    v_new_status := 'invoiced';
  end if;

  update public.rent_schedules set status = v_new_status where id = p_rent_schedule_id;
end;
$$;

comment on function public.recompute_rent_schedule_status(uuid) is
  'The one place a rent_schedule''s cumulative-payment status is computed -- sums ONLY non-reversed
   invoice_payments allocated to this schedule''s own rent invoice (single-source-of-truth
   correction pass). bank_transactions/cash_receipts are evidence a payment came from, never a
   second independent total -- confirm_bank_transaction_match()/confirm_cash_receipt_deposit() now
   create the corresponding invoice_payments row themselves before calling this.';

-- ============================================================
-- 3. confirm_bank_transaction_match(): now also creates the invoice_payments allocation row, in
--    the same transaction as the journal entry it already posts -- never a second GL entry for the
--    same money. Overpayment is refused with the same invariant record_invoice_payment() enforces
--    (this table is the one place that invariant must hold, regardless of which RPC writes to it).
--    The rent_schedule status precondition already above (must be invoiced/overdue/partial) is only
--    reachable via invoice_rent_schedule(), which always creates the invoice in the same
--    transaction it sets status='invoiced' -- so the matching invoice is guaranteed to exist; if it
--    is somehow missing, that is a genuine data-integrity fault worth raising loudly, not silently
--    tolerating a payment nothing can be allocated against.
-- ============================================================
create or replace function public.confirm_bank_transaction_match(
  p_bank_transaction_id uuid,
  p_rent_schedule_id uuid
)
returns uuid
language plpgsql
as $$
declare
  v_transaction public.bank_transactions%rowtype;
  v_bank_account public.bank_accounts%rowtype;
  v_schedule public.rent_schedules%rowtype;
  v_lease public.leases%rowtype;
  v_property_id uuid;
  v_tenant_id uuid;
  v_bank_gl_account_id uuid;
  v_ar_account_id uuid;
  v_journal_entry_id uuid;
  v_matched_amount numeric(12, 2);
  v_invoice public.invoices%rowtype;
  v_already_paid numeric(12, 2);
  v_payment_id uuid;
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

  select * into v_schedule from public.rent_schedules
  where id = p_rent_schedule_id and org_id = v_bank_account.org_id;
  if not found then
    raise exception 'Rent schedule not found (or not in the same org as the bank account)';
  end if;
  if v_schedule.status not in ('invoiced', 'overdue', 'partial') then
    raise exception 'Rent schedule % is not in a payable state (current status: %)', p_rent_schedule_id, v_schedule.status;
  end if;

  select * into v_invoice from public.invoices
  where lease_id = v_schedule.lease_id and period = v_schedule.due_date and source = 'rent_schedule';
  if not found then
    raise exception 'No invoice exists for rent schedule % -- invoice_rent_schedule() must run before a payment can be matched', p_rent_schedule_id;
  end if;

  select * into v_lease from public.leases where id = v_schedule.lease_id;
  select property_id into v_property_id from public.units where id = v_lease.unit_id;
  select tenant_id into v_tenant_id from public.lease_tenants where lease_id = v_lease.id and is_primary limit 1;

  select id into v_bank_gl_account_id from public.chart_of_accounts
  where org_id = v_bank_account.org_id
    and code = (case when v_bank_account.account_class = 'trust' then '1010' else '1000' end);
  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_bank_account.org_id and code = '1100';

  v_matched_amount := abs(v_transaction.amount);

  select coalesce(sum(amount), 0) into v_already_paid
  from public.invoice_payments where invoice_id = v_invoice.id and reversed_at is null;
  if (v_already_paid + v_matched_amount) > v_invoice.amount then
    raise exception 'This match (%) would exceed invoice %''s outstanding balance (%) -- overpayment is not supported',
      v_matched_amount, v_invoice.invoice_number, (v_invoice.amount - v_already_paid);
  end if;

  v_journal_entry_id := public.post_journal_entry(
    v_bank_account.org_id,
    v_transaction.transaction_date,
    'Rent payment received',
    'payment',
    p_bank_transaction_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_bank_gl_account_id, 'debit', v_matched_amount, 'property_id', v_property_id, 'tenant_id', v_tenant_id),
      jsonb_build_object('account_id', v_ar_account_id, 'credit', v_matched_amount, 'property_id', v_property_id, 'tenant_id', v_tenant_id)
    )
  );

  update public.bank_transactions
  set match_status = 'matched', matched_journal_entry_id = v_journal_entry_id, matched_rent_schedule_id = p_rent_schedule_id
  where id = p_bank_transaction_id;

  -- The allocation, in the one ledger that now authoritatively determines invoice paid/balance --
  -- no second journal entry (the one above already posted the real GL impact of this receipt).
  insert into public.invoice_payments (org_id, tenant_id, invoice_id, amount, paid_at, method, reference, recorded_by, bank_transaction_id)
  values (v_invoice.org_id, v_invoice.tenant_id, v_invoice.id, v_matched_amount, v_transaction.transaction_date, 'eft', v_transaction.reference, auth.uid(), p_bank_transaction_id)
  returning id into v_payment_id;

  perform public.recompute_rent_schedule_status(p_rent_schedule_id);

  perform public.write_lifecycle_audit_event(
    v_bank_account.org_id, 'user', auth.uid(), 'payment.recorded', 'invoice_payments', v_payment_id,
    jsonb_build_object('invoiceId', v_invoice.id, 'amount', v_matched_amount, 'method', 'eft', 'source', 'bank_match')
  );

  return v_journal_entry_id;
end;
$$;

comment on function public.confirm_bank_transaction_match(uuid, uuid) is
  'Matches a bank transaction to a rent schedule, posts the Dr Bank / Cr AR journal entry (unchanged
   from migration 38), AND records the corresponding invoice_payments allocation row against that
   schedule''s invoice (single-source-of-truth correction pass) -- never a second GL entry.
   Overpayment against the invoice is refused, same invariant record_invoice_payment() enforces.';

-- ============================================================
-- 4. confirm_cash_receipt_deposit(): same treatment -- the invoice_payments row is linked via
--    cash_receipt_id, never bank_transaction_id (the deposit-slip bank_transaction can legitimately
--    back several cash receipts bundled into one deposit, which bank_transaction_id's uniqueness
--    would forbid).
-- ============================================================
create or replace function public.confirm_cash_receipt_deposit(
  p_cash_receipt_id uuid,
  p_bank_transaction_id uuid,
  p_deposited_amount numeric
)
returns uuid
language plpgsql
as $$
declare
  v_receipt public.cash_receipts%rowtype;
  v_bank_account public.bank_accounts%rowtype;
  v_transaction public.bank_transactions%rowtype;
  v_schedule public.rent_schedules%rowtype;
  v_tenant_id uuid;
  v_bank_gl_account_id uuid;
  v_ar_account_id uuid;
  v_journal_entry_id uuid;
  v_invoice public.invoices%rowtype;
  v_already_paid numeric(12, 2);
  v_payment_id uuid;
begin
  select * into v_receipt from public.cash_receipts where id = p_cash_receipt_id;
  if not found then
    raise exception 'Cash receipt % not found', p_cash_receipt_id;
  end if;
  if not public.has_org_role(v_receipt.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_receipt.deposited_at is not null then
    raise exception 'Cash receipt % has already been confirmed as deposited', p_cash_receipt_id;
  end if;
  if p_deposited_amount <= 0 then
    raise exception 'Deposited amount must be positive';
  end if;

  select * into v_transaction from public.bank_transactions where id = p_bank_transaction_id;
  if not found then
    raise exception 'Bank transaction not found';
  end if;
  select * into v_bank_account from public.bank_accounts where id = v_transaction.bank_account_id;
  if v_bank_account.org_id <> v_receipt.org_id then
    raise exception 'Bank transaction is not in the same organization as the cash receipt';
  end if;

  if v_receipt.rent_schedule_id is not null then
    select * into v_schedule from public.rent_schedules where id = v_receipt.rent_schedule_id;
    if v_schedule.status not in ('invoiced', 'overdue', 'partial') then
      raise exception 'Rent schedule % is not in a payable state (current status: %)', v_receipt.rent_schedule_id, v_schedule.status;
    end if;
    select * into v_invoice from public.invoices
    where lease_id = v_schedule.lease_id and period = v_schedule.due_date and source = 'rent_schedule';
    if not found then
      raise exception 'No invoice exists for rent schedule % -- invoice_rent_schedule() must run before a deposit can be confirmed against it', v_receipt.rent_schedule_id;
    end if;
    select coalesce(sum(amount), 0) into v_already_paid
    from public.invoice_payments where invoice_id = v_invoice.id and reversed_at is null;
    if (v_already_paid + p_deposited_amount) > v_invoice.amount then
      raise exception 'This deposit (%) would exceed invoice %''s outstanding balance (%) -- overpayment is not supported',
        p_deposited_amount, v_invoice.invoice_number, (v_invoice.amount - v_already_paid);
    end if;
  end if;

  select id into v_bank_gl_account_id from public.chart_of_accounts
  where org_id = v_receipt.org_id
    and code = (case when v_bank_account.account_class = 'trust' then '1010' else '1000' end);
  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_receipt.org_id and code = '1100';

  if v_receipt.lease_id is not null then
    select tenant_id into v_tenant_id from public.lease_tenants where lease_id = v_receipt.lease_id and is_primary limit 1;
  end if;

  v_journal_entry_id := public.post_journal_entry(
    v_receipt.org_id,
    v_transaction.transaction_date,
    'Cash rent payment deposited',
    'payment',
    p_cash_receipt_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_bank_gl_account_id, 'debit', p_deposited_amount, 'property_id', v_receipt.property_id, 'tenant_id', v_tenant_id),
      jsonb_build_object('account_id', v_ar_account_id, 'credit', p_deposited_amount, 'property_id', v_receipt.property_id, 'tenant_id', v_tenant_id)
    )
  );

  update public.cash_receipts
  set deposited_at = now(),
      deposit_bank_transaction_id = p_bank_transaction_id,
      deposited_amount = p_deposited_amount,
      variance = p_deposited_amount - v_receipt.amount,
      journal_entry_id = v_journal_entry_id
  where id = p_cash_receipt_id;

  if v_receipt.rent_schedule_id is not null then
    insert into public.invoice_payments (org_id, tenant_id, invoice_id, amount, paid_at, method, recorded_by, cash_receipt_id)
    values (v_invoice.org_id, v_invoice.tenant_id, v_invoice.id, p_deposited_amount, v_transaction.transaction_date, 'cash', auth.uid(), p_cash_receipt_id)
    returning id into v_payment_id;

    perform public.recompute_rent_schedule_status(v_receipt.rent_schedule_id);

    perform public.write_lifecycle_audit_event(
      v_receipt.org_id, 'user', auth.uid(), 'payment.recorded', 'invoice_payments', v_payment_id,
      jsonb_build_object('invoiceId', v_invoice.id, 'amount', p_deposited_amount, 'method', 'cash', 'source', 'cash_deposit')
    );
  end if;

  return v_journal_entry_id;
end;
$$;

comment on function public.confirm_cash_receipt_deposit(uuid, uuid, numeric) is
  'Confirms a cash receipt as deposited, posts the Dr Bank / Cr AR journal entry (unchanged from
   migration 73), AND -- when the receipt is linked to a rent schedule -- records the corresponding
   invoice_payments allocation row via cash_receipt_id (single-source-of-truth correction pass).
   Never a second GL entry. Overpayment against the invoice is refused.';

-- ============================================================
-- 5. reverse_invoice_payment(): release a linked cash receipt back to un-deposited, symmetric to
--    the existing bank-transaction release -- and clear matched_rent_schedule_id on a linked bank
--    transaction too (confirm_bank_transaction_match() above sets that field, not
--    matched_invoice_payment_id; clearing both is a no-op for whichever one was never set).
-- ============================================================
create or replace function public.reverse_invoice_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.invoice_payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_unit_id uuid;
  v_property_id uuid;
  v_bank_gl_account_id uuid;
  v_ar_account_id uuid;
  v_rent_schedule_id uuid;
begin
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'A reversal reason is required';
  end if;

  select * into v_payment from public.invoice_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if v_payment.reversed_at is not null then
    raise exception 'This payment has already been reversed';
  end if;

  select * into v_invoice from public.invoices where id = v_payment.invoice_id for update;
  if not public.has_org_role(v_invoice.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;

  update public.invoice_payments
  set reversed_at = now(), reversed_by_user_id = auth.uid(), reversal_reason = p_reason
  where id = p_payment_id;

  select unit_id into v_unit_id from public.leases where id = v_invoice.lease_id;
  select property_id into v_property_id from public.units where id = v_unit_id;
  select id into v_bank_gl_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1000';
  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1100';

  perform public.post_journal_entry(
    v_invoice.org_id,
    current_date,
    'Payment reversed: ' || p_reason,
    'reversal',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar_account_id, 'debit', v_payment.amount, 'property_id', v_property_id, 'tenant_id', v_invoice.tenant_id),
      jsonb_build_object('account_id', v_bank_gl_account_id, 'credit', v_payment.amount, 'property_id', v_property_id, 'tenant_id', v_invoice.tenant_id)
    )
  );

  -- Release any linked bank transaction back to unmatched -- covers both the manual-then-linked
  -- path (matched_invoice_payment_id) and confirm_bank_transaction_match()'s own path
  -- (matched_rent_schedule_id); clearing whichever one was never set is a harmless no-op.
  if v_payment.bank_transaction_id is not null then
    update public.bank_transactions
    set match_status = 'unmatched', matched_journal_entry_id = null, matched_invoice_payment_id = null, matched_rent_schedule_id = null
    where id = v_payment.bank_transaction_id;
  end if;

  -- Release a linked cash receipt back to un-deposited, symmetric to the bank-transaction release.
  if v_payment.cash_receipt_id is not null then
    update public.cash_receipts
    set deposited_at = null, deposit_bank_transaction_id = null, deposited_amount = null, variance = null, journal_entry_id = null
    where id = v_payment.cash_receipt_id;
  end if;

  if v_invoice.source = 'rent_schedule' then
    select rs.id into v_rent_schedule_id
      from public.rent_schedules rs
      where rs.lease_id = v_invoice.lease_id and rs.due_date = v_invoice.period;
    if v_rent_schedule_id is not null then
      perform public.recompute_rent_schedule_status(v_rent_schedule_id);
    end if;
  end if;

  perform public.write_lifecycle_audit_event(
    v_invoice.org_id, 'user', auth.uid(), 'payment.reversed', 'invoice_payments', p_payment_id,
    jsonb_build_object('invoiceId', v_invoice.id, 'amount', v_payment.amount, 'reason', p_reason)
  );
end;
$$;

comment on function public.reverse_invoice_payment(uuid, text) is
  'The only path that may set invoice_payments.reversed_at -- security definer since the table has
   no UPDATE policy at all. Never deletes or edits the original row; posts a mirror-image
   correcting journal entry; releases any linked bank transaction back to unmatched OR any linked
   cash receipt back to un-deposited; recomputes the linked rent_schedule. Single-source-of-truth
   correction pass.';

-- ============================================================
-- 6. Backfill: any bank transaction already matched to a rent schedule, or cash receipt already
--    deposited against one, under the OLD (migration 158) code path has no invoice_payments row at
--    all -- without this, recompute_rent_schedule_status()'s new invoice_payments-only sum would
--    make an already-paid schedule revert to unpaid the moment anything touches it again. Idempotent
--    (guarded by not exists), safe to run more than once, inserts no new journal entries (the GL
--    impact was already posted when each was originally confirmed).
-- ============================================================
insert into public.invoice_payments (org_id, tenant_id, invoice_id, amount, paid_at, method, reference, bank_transaction_id)
select i.org_id, i.tenant_id, i.id, abs(bt.amount), bt.transaction_date, 'eft', bt.reference, bt.id
from public.bank_transactions bt
join public.rent_schedules rs on rs.id = bt.matched_rent_schedule_id
join public.invoices i on i.lease_id = rs.lease_id and i.period = rs.due_date and i.source = 'rent_schedule'
where bt.match_status = 'matched'
  and bt.matched_rent_schedule_id is not null
  and not exists (select 1 from public.invoice_payments ip where ip.bank_transaction_id = bt.id);

insert into public.invoice_payments (org_id, tenant_id, invoice_id, amount, paid_at, method, cash_receipt_id)
select i.org_id, i.tenant_id, i.id, cr.deposited_amount, coalesce(bt.transaction_date, cr.received_at::date), 'cash', cr.id
from public.cash_receipts cr
join public.rent_schedules rs on rs.id = cr.rent_schedule_id
join public.invoices i on i.lease_id = rs.lease_id and i.period = rs.due_date and i.source = 'rent_schedule'
left join public.bank_transactions bt on bt.id = cr.deposit_bank_transaction_id
where cr.deposited_at is not null
  and cr.rent_schedule_id is not null
  and not exists (select 1 from public.invoice_payments ip where ip.cash_receipt_id = cr.id);

-- Every previously-matched/deposited rent schedule now has its backfilled invoice_payments row --
-- recompute so status agrees with the new single-source formula immediately, not just on next
-- touch.
do $$
declare
  v_schedule_id uuid;
begin
  for v_schedule_id in
    select distinct rs.id from public.rent_schedules rs
    where rs.status in ('invoiced', 'overdue', 'partial', 'paid')
  loop
    perform public.recompute_rent_schedule_status(v_schedule_id);
  end loop;
end;
$$;
