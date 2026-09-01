-- Unified invoice-payment ledger pass (WORKLOG.md this date), Phase 2 (database/backend).
-- Approved architecture: OPTION A -- invoice_payments becomes the authoritative allocation ledger
-- for BOTH source='manual' and source='rent_schedule' invoices. It does not compete with
-- bank_transactions/cash_receipts as a representation of real money -- those remain the evidence
-- of receipt; invoice_payments is the ALLOCATION of that receipt (or of a plain manually-recorded
-- receipt with no bank-feed row yet) against a specific invoice. A rent-sourced invoice's linked
-- rent_schedule stays the single source Rent Due/property Accounting/the tenant portal already
-- trust -- this migration makes sure invoice_payments feeds INTO that same rent_schedule.status
-- computation (via a new shared helper) rather than becoming a second, disagreeing total.
--
-- ============================================================
-- 1. invoice_payments: org_id/tenant_id (denormalized for direct RLS/query scoping, always set
--    from the owning invoice, never independently client-supplied), reference (first-class,
--    separate from notes), reversal columns. Backfilled defensively even though local dev data is
--    pgTAP-only (rolled back) -- safe regardless.
-- ============================================================
alter table public.invoice_payments
  add column org_id uuid references public.organizations(id) on delete cascade,
  add column tenant_id uuid references public.tenants(id),
  add column reference text check (reference is null or char_length(reference) <= 100),
  add column reversed_at timestamptz,
  add column reversed_by_user_id uuid references auth.users(id) on delete set null,
  add column reversal_reason text;

update public.invoice_payments ip
set org_id = i.org_id, tenant_id = i.tenant_id
from public.invoices i
where ip.invoice_id = i.id and ip.org_id is null;

alter table public.invoice_payments
  alter column org_id set not null,
  alter column tenant_id set not null;

alter table public.invoice_payments
  add constraint invoice_payments_reversal_consistency
  check ((reversed_at is null) = (reversed_by_user_id is null) and (reversed_at is null) = (reversal_reason is null));

-- Payment method: constrained to the fixed set requested, rather than free text -- extends the
-- existing plain-text `method` column (migration 20260101000152) with a CHECK, the same "text +
-- CHECK" convention this codebase already uses elsewhere (e.g. subscription_payments.status)
-- rather than introducing a new Postgres enum type for one column.
alter table public.invoice_payments
  drop constraint if exists invoice_payments_method_check;
alter table public.invoice_payments
  alter column method set not null,
  add constraint invoice_payments_method_check
  check (method in ('eft', 'cash', 'card', 'debit_order', 'bank_deposit', 'other'));

create index invoice_payments_org_idx on public.invoice_payments (org_id, created_at desc);
create index invoice_payments_tenant_idx on public.invoice_payments (tenant_id, created_at desc);

comment on column public.invoice_payments.org_id is
  'Denormalized from invoices.org_id at insert time (never independently supplied) -- lets RLS and
   tenant-ledger/org-ledger queries scope directly on invoice_payments without a join. Final
   unified-ledger pass, migration 158.';
comment on column public.invoice_payments.reversed_at is
  'Non-null once reversed -- the row itself is NEVER deleted or edited otherwise (immutable audit
   trail). reversed_at/reversed_by_user_id/reversal_reason are always set together
   (invoice_payments_reversal_consistency) or not at all.';

-- ============================================================
-- 2. documents: proof-of-payment link, matching the existing tenant_id/unit_id/
--    maintenance_ticket_id convention (migration 20260101000085) exactly -- no new storage system.
-- ============================================================
alter table public.documents
  add column invoice_payment_id uuid references public.invoice_payments(id) on delete set null;

comment on column public.documents.invoice_payment_id is
  'Optional proof-of-payment attachment for a recorded invoice payment -- inherits every existing
   documents guarantee (org/property isolation, storage RLS, malware scan, size/type validation).
   A payment may have zero or more proof documents. Final unified-ledger pass, migration 158.';

-- ============================================================
-- 3. invoices: void state. Deliberately NOT a new invoice_status enum value -- status has never
--    actually been set to anything but draft/issued in the DB (paid/balance/display-status are all
--    computed, confirmed by grep across every migration before this one) -- voided_at is the same
--    kind of derived-display sentinel, consistent with that existing design, and avoids an
--    ALTER TYPE ADD VALUE transaction-boundary complication for no real benefit.
-- ============================================================
alter table public.invoices
  add column voided_at timestamptz,
  add column voided_by_user_id uuid references auth.users(id) on delete set null,
  add column void_reason text;

alter table public.invoices
  add constraint invoices_void_consistency
  check ((voided_at is null) = (voided_by_user_id is null) and (voided_at is null) = (void_reason is null));

comment on column public.invoices.voided_at is
  'Set only by void_invoice() (never a raw client update -- the draft-only invoices_update_draft_
   accountant_plus policy, migration 153, already blocks a raw UPDATE on an issued row, and
   void_invoice() itself refuses an invoice with active payments). A voided invoice remains fully
   visible (no SELECT policy change) -- it is excluded from outstanding-balance totals and cannot
   receive further payments, never deleted. Final unified-ledger pass, migration 158.';

-- ============================================================
-- 4. invoice_payments RLS: INSERT policy tightened to also verify the denormalized org_id/
--    tenant_id genuinely match the owning invoice (defense in depth -- record_invoice_payment()
--    below always sets them correctly; this stops a hypothetical direct-insert attempt from
--    supplying a mismatched pair even though it would already fail the accountant+/issued checks).
--    No UPDATE/DELETE policy is added -- reversal is a security-definer RPC exception, same
--    established idiom as issue_manual_invoice()/mark_invoice_emailed() (migration 153).
-- ============================================================
drop policy "invoice_payments_insert_issued_accountant_plus" on public.invoice_payments;

create policy "invoice_payments_insert_issued_accountant_plus"
  on public.invoice_payments for insert
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_payments.invoice_id
        and i.org_id = invoice_payments.org_id
        and i.tenant_id = invoice_payments.tenant_id
        and public.has_org_role(i.org_id, 'accountant')
        and i.status = 'issued'
        and i.voided_at is null
    )
  );

-- ============================================================
-- 5. Shared recomputation helper -- the actual "cannot disagree" mechanism. Extracted from
--    confirm_bank_transaction_match()/confirm_cash_receipt_deposit()'s own previously-duplicated
--    inline cumulative-total logic (each redefined below to call this instead), now summing a
--    THIRD source (non-reversed invoice_payments allocated to this schedule's own rent invoice)
--    alongside the original two. Behaviourally identical to before for every existing paid/partial
--    case (same >= comparison); the only new branch is total_paid<=0, which could not previously
--    occur (nothing ever reversed a rent-linked payment before this pass) -- it now correctly
--    reverts the schedule to invoiced/overdue (whichever a never-paid schedule would show) rather
--    than leaving a stale 'partial'/'paid' status after every allocation was reversed.
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

  select
    coalesce((select sum(abs(amount)) from public.bank_transactions
              where matched_rent_schedule_id = p_rent_schedule_id and match_status = 'matched'), 0)
    + coalesce((select sum(deposited_amount) from public.cash_receipts
                where rent_schedule_id = p_rent_schedule_id and deposited_at is not null), 0)
    + coalesce((select sum(ip.amount) from public.invoice_payments ip
                join public.invoices i on i.id = ip.invoice_id
                where i.source = 'rent_schedule' and i.lease_id = v_schedule.lease_id
                  and i.period = v_schedule.due_date and ip.reversed_at is null), 0)
  into v_total_paid;

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
  'The one place a rent_schedule''s cumulative-payment status is computed -- sums matched bank
   transactions + deposited cash receipts + non-reversed invoice_payments allocated to this
   schedule''s own rent invoice. Called by confirm_bank_transaction_match(),
   confirm_cash_receipt_deposit(), and record_invoice_payment()/reverse_invoice_payment() below, so
   all three payment sources agree by construction. Final unified-ledger pass, migration 158.';

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

  select * into v_lease from public.leases where id = v_schedule.lease_id;
  select property_id into v_property_id from public.units where id = v_lease.unit_id;
  select tenant_id into v_tenant_id from public.lease_tenants where lease_id = v_lease.id and is_primary limit 1;

  select id into v_bank_gl_account_id from public.chart_of_accounts
  where org_id = v_bank_account.org_id
    and code = (case when v_bank_account.account_class = 'trust' then '1010' else '1000' end);
  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_bank_account.org_id and code = '1100';

  v_matched_amount := abs(v_transaction.amount);

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

  perform public.recompute_rent_schedule_status(p_rent_schedule_id);

  return v_journal_entry_id;
end;
$$;

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
    perform public.recompute_rent_schedule_status(v_receipt.rent_schedule_id);
  end if;

  return v_journal_entry_id;
end;
$$;

-- ============================================================
-- 6. record_invoice_payment(): redefined again. Signature changes (reference added,
--    allow_overpayment REMOVED entirely -- not just hidden from the UI, the capability no longer
--    exists in the function at all, since a technically-callable-but-hidden bypass is a weaker
--    posture than removing it when the explicit instruction is "do not allow overpayment").
--    Mandatory concurrency fix: SELECT ... FOR UPDATE locks the invoice row before the
--    outstanding-balance check, so two simultaneous submissions against the same invoice
--    serialize instead of both reading a stale already-paid total.
-- ============================================================
drop function if exists public.record_invoice_payment(uuid, numeric, date, text, text, uuid, boolean);

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_method text,
  p_reference text,
  p_notes text,
  p_bank_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_unit_id uuid;
  v_property_id uuid;
  v_bank_gl_account_id uuid;
  v_ar_account_id uuid;
  v_payment_id uuid;
  v_journal_entry_id uuid;
  v_already_paid numeric(12, 2);
  v_bank_txn public.bank_transactions%rowtype;
  v_bank_txn_org_id uuid;
  v_rent_schedule_id uuid;
begin
  -- Row lock FIRST -- the mandatory concurrency guard. Every other check below reads
  -- v_invoice/v_already_paid from a state that cannot change under a concurrent call until this
  -- transaction commits or rolls back.
  --
  -- security definer is required here (not just idiomatic): Postgres RLS combines the SELECT
  -- policy with the USING clause of every applicable UPDATE/DELETE policy whenever the query
  -- carries FOR UPDATE. invoices_update_draft_accountant_plus only allows status = 'draft', so a
  -- non-definer FOR UPDATE lock on an already-issued invoice is silently filtered to zero rows.
  -- has_org_role() below remains the real authorization gate, same idiom as issue_manual_invoice().
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.has_org_role(v_invoice.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_invoice.voided_at is not null then
    raise exception 'Cannot record a payment against a voided invoice';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'Only issued invoices can have payments recorded against them';
  end if;
  if p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;
  if p_method not in ('eft', 'cash', 'card', 'debit_order', 'bank_deposit', 'other') then
    raise exception 'Invalid payment method';
  end if;

  select coalesce(sum(amount), 0) into v_already_paid
  from public.invoice_payments where invoice_id = p_invoice_id and reversed_at is null;

  -- V1: overpayment is never permitted through this RPC -- no bypass parameter exists.
  if (v_already_paid + p_amount) > v_invoice.amount then
    raise exception 'This payment (%) would exceed the outstanding balance (%) -- overpayment is not supported',
      p_amount, (v_invoice.amount - v_already_paid);
  end if;

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

  select unit_id into v_unit_id from public.leases where id = v_invoice.lease_id;
  select property_id into v_property_id from public.units where id = v_unit_id;
  select id into v_bank_gl_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1000';
  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1100';

  insert into public.invoice_payments (org_id, tenant_id, invoice_id, amount, paid_at, method, reference, notes, recorded_by, bank_transaction_id)
  values (v_invoice.org_id, v_invoice.tenant_id, p_invoice_id, p_amount, p_paid_at, p_method, p_reference, p_notes, auth.uid(), p_bank_transaction_id)
  returning id into v_payment_id;

  v_journal_entry_id := public.post_journal_entry(
    v_invoice.org_id,
    p_paid_at,
    case when v_invoice.source = 'manual' then 'Manual invoice payment received' else 'Rent payment received' end,
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

  if v_invoice.source = 'rent_schedule' then
    select rs.id into v_rent_schedule_id
      from public.rent_schedules rs
      where rs.lease_id = v_invoice.lease_id and rs.due_date = v_invoice.period;
    if v_rent_schedule_id is not null then
      perform public.recompute_rent_schedule_status(v_rent_schedule_id);
    end if;
  end if;

  perform public.write_lifecycle_audit_event(
    v_invoice.org_id, 'user', auth.uid(), 'payment.recorded', 'invoice_payments', v_payment_id,
    jsonb_build_object('invoiceId', p_invoice_id, 'amount', p_amount, 'method', p_method, 'reference', p_reference)
  );

  return v_payment_id;
end;
$$;

comment on function public.record_invoice_payment(uuid, numeric, date, text, text, text, uuid) is
  'The one payment-allocation entry point for BOTH manual and rent-sourced invoices (unified-ledger
   pass, migration 158). Locks the invoice row before checking outstanding balance (concurrency),
   never permits overpayment, and recomputes the linked rent_schedule (if any) via the shared
   recompute_rent_schedule_status() helper so Rent Due/property Accounting/the tenant portal, which
   all read rent_schedules.status directly, automatically stay in agreement.';

-- ============================================================
-- 7. reverse_invoice_payment(): new. Security definer -- invoice_payments has no UPDATE policy at
--    all by design (immutability), so reversal is the one sanctioned exception, same idiom as
--    issue_manual_invoice()/mark_invoice_emailed() (migration 153). The original payment row is
--    NEVER edited beyond the reversal columns themselves and NEVER deleted; the original journal
--    entry is untouched (ACCOUNTING.md's "original entry is untouched forever" convention) -- a
--    mirror-image correcting entry is posted instead (source_type 'reversal', which already
--    existed in journal_source_type for exactly this).
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

  -- Release any linked bank transaction back to unmatched -- it must not be left falsely
  -- marked as consumed.
  if v_payment.bank_transaction_id is not null then
    update public.bank_transactions
    set match_status = 'unmatched', matched_journal_entry_id = null, matched_invoice_payment_id = null
    where id = v_payment.bank_transaction_id;
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
   correcting journal entry; releases any linked bank transaction back to unmatched; recomputes the
   linked rent_schedule. Final unified-ledger pass, migration 158.';

-- ============================================================
-- 8. link_bank_transaction_to_invoice_payment(): new. Closes the "manual EFT recorded before the
--    bank feed caught up" gap explicitly called out in the approved brief -- a subsequently
--    imported bank transaction can be tied to the EXISTING invoice_payments row instead of forcing
--    (or risking) a second payment entry for the same real money. Purely evidentiary/reconciliation
--    -- record_invoice_payment() already posted the real GL entry at record time, so this never
--    posts a second one, matching "the same economic receipt must never create two ... GL
--    receipts."
-- ============================================================
create or replace function public.link_bank_transaction_to_invoice_payment(
  p_invoice_payment_id uuid,
  p_bank_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.invoice_payments%rowtype;
  v_bank_txn public.bank_transactions%rowtype;
  v_bank_txn_org_id uuid;
  v_journal_entry_id uuid;
begin
  select * into v_payment from public.invoice_payments where id = p_invoice_payment_id for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if not public.has_org_role(v_payment.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_payment.reversed_at is not null then
    raise exception 'Cannot link a bank transaction to a reversed payment';
  end if;
  if v_payment.bank_transaction_id is not null then
    raise exception 'This payment is already linked to a bank transaction';
  end if;

  select * into v_bank_txn from public.bank_transactions where id = p_bank_transaction_id;
  if not found then
    raise exception 'Bank transaction not found';
  end if;
  select ba.org_id into v_bank_txn_org_id from public.bank_accounts ba where ba.id = v_bank_txn.bank_account_id;
  if v_bank_txn_org_id <> v_payment.org_id then
    raise exception 'Bank transaction does not belong to this organization';
  end if;
  if v_bank_txn.match_status = 'matched' then
    raise exception 'This bank transaction has already been matched/allocated elsewhere';
  end if;

  -- bank_transactions_check requires matched_journal_entry_id to be set whenever match_status is
  -- 'matched' -- point it at the GL entry record_invoice_payment() already posted for this payment;
  -- this call never posts a second one.
  select id into v_journal_entry_id from public.journal_entries
    where source_type = 'payment' and source_id = p_invoice_payment_id;

  update public.invoice_payments set bank_transaction_id = p_bank_transaction_id where id = p_invoice_payment_id;
  update public.bank_transactions
  set match_status = 'matched', matched_invoice_payment_id = p_invoice_payment_id, matched_journal_entry_id = v_journal_entry_id
  where id = p_bank_transaction_id;
end;
$$;

comment on function public.link_bank_transaction_to_invoice_payment(uuid, uuid) is
  'Ties a subsequently-imported bank transaction to an already-recorded invoice payment, without
   posting a second journal entry -- the original record_invoice_payment() call already posted the
   real GL impact. Security definer (invoice_payments has no UPDATE policy). Final unified-ledger
   pass, migration 158.';

-- ============================================================
-- 9. void_invoice(): new. Security definer -- invoices_update_draft_accountant_plus (migration
--    153) only permits a raw client UPDATE while status='draft', so voiding an ISSUED invoice
--    needs the same exception every other post-issue state transition already uses.
-- ============================================================
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_has_active_payments boolean;
begin
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'A void reason is required';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.has_org_role(v_invoice.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_invoice.voided_at is not null then
    raise exception 'Invoice is already void';
  end if;

  select exists(
    select 1 from public.invoice_payments where invoice_id = p_invoice_id and reversed_at is null
  ) into v_has_active_payments;
  if v_has_active_payments then
    raise exception 'Cannot void an invoice with active payments -- reverse them first';
  end if;

  update public.invoices
  set voided_at = now(), voided_by_user_id = auth.uid(), void_reason = p_reason
  where id = p_invoice_id;

  perform public.write_lifecycle_audit_event(
    v_invoice.org_id, 'user', auth.uid(), 'invoice.voided', 'invoices', p_invoice_id,
    jsonb_build_object('reason', p_reason, 'previousStatus', v_invoice.status)
  );
end;
$$;

comment on function public.void_invoice(uuid, text) is
  'Voids a draft or issued invoice with no active (non-reversed) payments -- never deletes it,
   never silently drops payments (refuses outright if any exist and are not reversed first).
   Security definer (draft-only UPDATE policy would otherwise block voiding an issued invoice).
   Final unified-ledger pass, migration 158.';
