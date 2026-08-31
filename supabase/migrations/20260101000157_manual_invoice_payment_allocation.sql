-- Final accounting reconciliation pass (WORKLOG.md this date), P0 "prove/fix economic payment
-- duplication". Full audit of the money-receipt architecture, answered directly before designing
-- anything (schema read via psql, not assumed):
--
-- 1. Can a bank_transaction be allocated directly to a MANUAL invoice today? NO --
--    confirm_bank_transaction_match() takes p_rent_schedule_id, and a manual invoice has no
--    rent_schedule at all.
-- 2. Can a cash_receipt be allocated directly to a MANUAL invoice today? NO -- same reason
--    (cash_receipts.rent_schedule_id, migration 20260101000073).
-- 3. If a manual invoice is paid by EFT and that EFT later appears in bank_transactions: before
--    this migration, that bank_transactions row would sit permanently 'unmatched' (nothing in the
--    schema could ever consume it for a manual invoice) -- an incomplete reconciliation picture,
--    not a double-count, but not the coherent "receipt -> allocation -> invoice" model asked for.
-- 4. Can staff call record_invoice_payment() and LATER also independently process the same real
--    bank_transaction elsewhere? Before this migration: yes, nothing stopped it (the manual
--    record and the bank feed were two entirely disconnected representations of the same money).
--    After this migration: only if they never linked the bank_transaction at record-time -- if
--    they did, confirm_bank_transaction_match()'s own existing `match_status = 'matched'` guard
--    (unchanged) now also blocks reusing it for rent, and vice versa.
-- 5. No shared bank_transaction_id/cash_receipt_id/external-reference/allocation table/uniqueness
--    constraint/reconciliation state existed linking invoice_payments to real money before this
--    migration -- confirmed by reading every column on both tables.
-- 6/7. Could the same economic payment produce two GL entries -- one DR Bank/CR AR from
--    invoice_payments, another DR Bank/CR AR (or similar) from bank matching? Structurally NO for
--    the SAME invoice (a manual invoice's AR account only every gets credited by
--    record_invoice_payment(), since confirm_bank_transaction_match() only posts against
--    rent_schedule-linked invoices) -- but nothing prevented the same real cash from being
--    represented as BOTH an invoice_payments row AND a separately-matched, unrelated
--    bank_transaction sitting unreconciled forever, which is exactly the "two unrelated
--    representations of the same money" the task brief said to close.
-- 8. Given 6/7, financial reports could not overstate a single invoice's own paid/AR figures (no
--    code path double-posts against the SAME invoice), but the bank ledger could permanently carry
--    an unexplained unmatched transaction that a staff member, working from the bank feed instead
--    of the invoice, might mistakenly re-match against something unrelated (e.g. a genuine pending
--    rent_schedule for the same tenant) -- a discipline/UX gap this migration also closes by making
--    linking possible and the two mechanisms mutually exclusive at the database level.
--
-- Fix, the smallest safe version of the desired model (INVOICE = obligation, PAYMENT SOURCE =
-- receipt, ALLOCATION = application of receipt to invoice): invoice_payments already IS the
-- allocation record for manual invoices (existing, tested) -- it gains an OPTIONAL tie to the real
-- bank_transactions row when one exists, reusing bank_transactions' own existing match_status/
-- matched_journal_entry_id machinery (the same idiom confirm_bank_transaction_match() already
-- uses) rather than inventing a new parallel ledger. Cash receipts are deliberately NOT extended
-- here -- a cash receipt is physically taken by staff at the moment of receipt (its own
-- received_at IS the manual record), a materially different, much rarer risk than a bank feed
-- import surfacing the same money later; extending it isn't needed to close the risk this task
-- describes and would be scope growth beyond what was asked.
--
-- Also closes a second, independent gap: record_invoice_payment() had no protection at all against
-- the same real payment being recorded twice by mistake (Test B in the task brief) -- it now
-- refuses (unless explicitly confirmed) any payment that would push total recorded payments past
-- the invoice's own total, making overpayment an explicit, safe, opt-in action instead of a silent
-- possibility indistinguishable from an accidental duplicate entry.

alter table public.bank_transactions
  add column matched_invoice_payment_id uuid references public.invoice_payments(id);

alter table public.bank_transactions
  add constraint bank_transactions_single_match_target
  check (matched_rent_schedule_id is null or matched_invoice_payment_id is null);

comment on column public.bank_transactions.matched_invoice_payment_id is
  'Set when this transaction was linked to a manual (non-rent) invoice payment via
   record_invoice_payment()''s optional p_bank_transaction_id -- mutually exclusive with
   matched_rent_schedule_id (bank_transactions_single_match_target), and covered by the SAME
   (match_status = ''matched'') = (matched_journal_entry_id is not null) invariant every other
   match already uses. Final hardening pass, migration 157.';

alter table public.invoice_payments
  add column bank_transaction_id uuid references public.bank_transactions(id);

create unique index invoice_payments_bank_transaction_unique_idx
  on public.invoice_payments (bank_transaction_id)
  where bank_transaction_id is not null;

comment on column public.invoice_payments.bank_transaction_id is
  'Optional -- set when this recorded payment corresponds to a real, already-imported bank
   transaction (staff explicitly links it at record time). Null for a pure manual entry (cash, or a
   bank line that has not appeared in the feed yet). The unique index (defense in depth alongside
   this function''s own match_status check) means the same bank_transactions row can never fund two
   different invoice_payments rows. Final hardening pass, migration 157.';

-- The migration 153 version had a different (shorter) parameter list -- `create or replace`
-- with a new signature creates a SECOND overload rather than replacing it, which left
-- `record_invoice_payment(uuid, numeric, date, text, text)` ambiguous against callers passing
-- exactly five args (found by running the existing manual_invoices.test.sql suite, not assumed
-- safe). Drop the old signature explicitly first.
drop function if exists public.record_invoice_payment(uuid, numeric, date, text, text);

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_method text,
  p_notes text,
  p_bank_transaction_id uuid default null,
  p_allow_overpayment boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_invoice public.invoices%rowtype;
  v_property_id uuid;
  v_bank_gl_account_id uuid;
  v_ar_account_id uuid;
  v_payment_id uuid;
  v_journal_entry_id uuid;
  v_already_paid numeric(12, 2);
  v_bank_txn public.bank_transactions%rowtype;
  v_bank_txn_org_id uuid;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.has_org_role(v_invoice.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'Only issued invoices can have payments recorded against them';
  end if;
  if p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  -- Explicit, safe overpayment (task brief Test E) -- also the practical guard against an
  -- accidental blind double-entry of the same real payment (Test B): recording the same amount
  -- twice against an already-fully-paid invoice is refused unless the caller explicitly opts in.
  select coalesce(sum(amount), 0) into v_already_paid
  from public.invoice_payments where invoice_id = p_invoice_id;
  if (v_already_paid + p_amount) > v_invoice.amount and not p_allow_overpayment then
    raise exception 'This payment (%) would overpay the invoice (already paid %, invoice total %) -- pass allow_overpayment to confirm this is intentional',
      p_amount, v_already_paid, v_invoice.amount;
  end if;

  -- Optional bank-transaction link (the actual fix for the economic-duplication risk): verify
  -- same org, and that it has not already been consumed by EITHER this mechanism or the rent-
  -- matching one (confirm_bank_transaction_match()'s own existing guard is the mirror image of
  -- this check, migration 157).
  if p_bank_transaction_id is not null then
    select * into v_bank_txn from public.bank_transactions where id = p_bank_transaction_id;
    if not found then
      raise exception 'Bank transaction not found';
    end if;
    select ba.org_id into v_bank_txn_org_id from public.bank_accounts ba where ba.id = v_bank_txn.bank_account_id;
    if v_bank_txn_org_id <> v_invoice.org_id then
      raise exception 'Bank transaction does not belong to this organization';
    end if;
    if v_bank_txn.match_status = 'matched' then
      raise exception 'This bank transaction has already been matched/allocated elsewhere';
    end if;
  end if;

  select property_id into v_property_id from public.units
    where id = (select unit_id from public.leases where id = v_invoice.lease_id);
  select id into v_bank_gl_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1000';
  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1100';

  insert into public.invoice_payments (invoice_id, amount, paid_at, method, notes, recorded_by, bank_transaction_id)
  values (p_invoice_id, p_amount, p_paid_at, p_method, p_notes, auth.uid(), p_bank_transaction_id)
  returning id into v_payment_id;

  v_journal_entry_id := public.post_journal_entry(
    v_invoice.org_id,
    p_paid_at,
    'Manual invoice payment received',
    'payment',
    v_payment_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_bank_gl_account_id, 'debit', p_amount, 'property_id', v_property_id, 'tenant_id', v_invoice.tenant_id),
      jsonb_build_object('account_id', v_ar_account_id, 'credit', p_amount, 'property_id', v_property_id, 'tenant_id', v_invoice.tenant_id)
    )
  );

  if p_bank_transaction_id is not null then
    update public.bank_transactions
    set match_status = 'matched', matched_journal_entry_id = v_journal_entry_id, matched_invoice_payment_id = v_payment_id
    where id = p_bank_transaction_id;
  end if;

  return v_payment_id;
end;
$$;

comment on function public.record_invoice_payment(uuid, numeric, date, text, text, uuid, boolean) is
  'Manually records that an issued invoice was paid, posts the matching GL entry, and OPTIONALLY
   links a real bank_transactions row (making it unavailable for rent-matching and vice versa).
   Refuses to silently overpay -- p_allow_overpayment must be explicit. Final hardening pass,
   migration 157 (extends migration 153''s version; the payment-row-insert + GL-posting core is
   unchanged, this adds the link + overpayment guard around it).';
