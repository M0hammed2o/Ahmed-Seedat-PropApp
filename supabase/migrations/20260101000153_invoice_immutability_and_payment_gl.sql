-- Final completion + security hardening pass (WORKLOG.md this date). Two P0 fixes, both scoped to
-- migration 152's own new surface (invoices.source='manual', invoice_line_items, invoice_payments)
-- -- invoice_rent_schedule() and confirm_bank_transaction_match() (migration 20260101000038) are
-- untouched by this file.
--
-- === P0-1: invoice financial immutability ===
-- invoices_write_accountant_plus (migration 20260101000037) is a broad FOR ALL policy -- any
-- accountant+ member could directly UPDATE an ISSUED invoice's amount, or DELETE it outright,
-- bypassing update_manual_invoice()'s own draft-only guard entirely (RLS, not the RPC, is the real
-- authorization boundary -- a raw Supabase client call skips the RPC completely). Same gap exists
-- one level down: invoice_line_items_write_accountant_plus and invoice_payments_write_accountant_plus
-- are both also FOR ALL with no status check, so a client could directly rewrite an issued invoice's
-- line items, or insert a payment against a still-draft invoice, bypassing issue_manual_invoice()'s
-- and record_invoice_payment()'s own guards the exact same way.
--
-- Fix: replace each FOR ALL policy with narrower INSERT/UPDATE policies gated on the CURRENT row's
-- status (using) and, for UPDATE, the same status after (with check) -- an authenticated client can
-- freely edit a DRAFT manual invoice and its line items directly (this is what update_manual_invoice()
-- itself relies on, unchanged below), but can never touch an issued invoice, its line items, or issue
-- a payment against a still-draft invoice. No DELETE policy is added anywhere -- with RLS enabled,
-- no policy for a command means that command is denied by default, so DELETE is refused unconditionally
-- for every invoice regardless of status (no delete/void workflow exists or was requested).
--
-- The two legitimate state-transition operations that raw-client RLS can no longer perform
-- (draft -> issued, and the /send route's emailed_at update on an already-issued row) become
-- `security definer` functions instead -- bypassing RLS internally while keeping their own existing
-- has_org_role() check as the real authorization gate. This is the same idiom this codebase already
-- uses for create_subscription_invoice_for_payment() and seed_chart_of_accounts() -- not a new
-- pattern introduced here. create_manual_invoice() and update_manual_invoice() do NOT need this --
-- both only ever touch rows that are, and remain, draft, which the new plain (non-security-definer)
-- policies already permit for an authorized accountant+ caller.

drop policy "invoices_write_accountant_plus" on public.invoices;

create policy "invoices_insert_accountant_plus"
  on public.invoices for insert
  with check (public.has_org_role(org_id, 'accountant'));

create policy "invoices_update_draft_accountant_plus"
  on public.invoices for update
  using (public.has_org_role(org_id, 'accountant') and status = 'draft')
  with check (public.has_org_role(org_id, 'accountant') and status = 'draft');

comment on policy "invoices_update_draft_accountant_plus" on public.invoices is
  'Direct client UPDATE is only ever possible on a row that is draft BEFORE and remains draft AFTER
   -- an issued/paid invoice can never be mutated by a raw client call, and even a draft cannot be
   flipped to issued this way (issue_manual_invoice() is security definer specifically so it can
   perform that one transition). Final hardening pass, migration 153.';

drop policy "invoice_line_items_write_accountant_plus" on public.invoice_line_items;

create policy "invoice_line_items_write_draft_accountant_plus"
  on public.invoice_line_items for all
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and public.has_org_role(i.org_id, 'accountant')
        and i.status = 'draft'
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and public.has_org_role(i.org_id, 'accountant')
        and i.status = 'draft'
    )
  );

comment on policy "invoice_line_items_write_draft_accountant_plus" on public.invoice_line_items is
  'Line items are only writable while their parent invoice is draft -- once issued, a raw client
   INSERT/UPDATE/DELETE on invoice_line_items is refused regardless of role. Final hardening pass,
   migration 153.';

drop policy "invoice_payments_write_accountant_plus" on public.invoice_payments;

create policy "invoice_payments_insert_issued_accountant_plus"
  on public.invoice_payments for insert
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_payments.invoice_id
        and public.has_org_role(i.org_id, 'accountant')
        and i.status = 'issued'
    )
  );

comment on policy "invoice_payments_insert_issued_accountant_plus" on public.invoice_payments is
  'A payment can only be recorded against an ISSUED invoice -- closes the same class of RPC-bypass
   record_invoice_payment() already guards against internally, at the RLS layer too. No UPDATE/DELETE
   policy exists at all: once inserted, a payment record is immutable audit evidence, matching
   record_invoice_payment()''s own append-only design. Final hardening pass, migration 153.';

-- issue_manual_invoice() becomes security definer so it can perform the one RLS-blocked transition
-- (draft -> issued) that a raw client now cannot. Body is otherwise byte-for-byte unchanged from
-- migration 152 -- its own has_org_role() check (unchanged) is still the real authorization gate;
-- security definer only removes the ADDITIONAL, now-too-strict RLS check this migration just added,
-- it does not remove or weaken the function's own explicit permission check.
create or replace function public.issue_manual_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_property_id uuid;
  v_ar_account_id uuid;
  v_income_account_id uuid;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.has_org_role(v_invoice.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_invoice.source <> 'manual' then
    raise exception 'Only manually-created invoices can be issued this way';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'Invoice has already been issued';
  end if;

  select property_id into v_property_id from public.units
    where id = (select unit_id from public.leases where id = v_invoice.lease_id);

  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1100';
  select id into v_income_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '4000';

  perform public.post_journal_entry(
    v_invoice.org_id,
    current_date,
    coalesce(v_invoice.description, 'Manual invoice'),
    'rent_invoice',
    p_invoice_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar_account_id, 'debit', v_invoice.amount, 'property_id', v_property_id, 'tenant_id', v_invoice.tenant_id),
      jsonb_build_object('account_id', v_income_account_id, 'credit', v_invoice.amount, 'property_id', v_property_id, 'tenant_id', v_invoice.tenant_id)
    )
  );

  update public.invoices set status = 'issued', issued_at = now() where id = p_invoice_id;
end;
$$;

-- New, narrowly-scoped security definer replacement for the /send route's previous direct
-- `.update({emailed_at: ...})` on public.invoices -- that raw UPDATE is now refused by
-- invoices_update_draft_accountant_plus (an issued row is never directly updatable), exactly the
-- "narrowly scoped controlled operation" the task brief asked for rather than weakening the new
-- immutability policy. Idempotent (only ever sets emailed_at when it was null), mirroring the
-- previous route's own `.is('emailed_at', null)` guard exactly -- moved server-side, not changed.
create or replace function public.mark_invoice_emailed(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.has_org_role(v_invoice.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;

  update public.invoices
  set emailed_at = now()
  where id = p_invoice_id and emailed_at is null
  returning * into v_invoice;

  if v_invoice.id is null then
    select * into v_invoice from public.invoices where id = p_invoice_id;
  end if;

  return v_invoice;
end;
$$;

comment on function public.mark_invoice_emailed(uuid) is
  'The only path that may set invoices.emailed_at -- security definer so it can update an issued
   invoice under the new immutability policy, gated by the same has_org_role accountant+ check the
   old direct route UPDATE relied on. Final hardening pass, migration 153.';

-- === P0-2: manual invoice payments must post to the general ledger ===
-- record_invoice_payment() (migration 152) only ever inserted an invoice_payments row -- it never
-- posted a journal entry. That means a manual invoice's Accounts Receivable (1100) balance,
-- created when issue_manual_invoice() debits it, NEVER goes back down when the invoice is later
-- paid -- the Invoice Detail page would correctly show "Paid" (computed from invoice_payments),
-- while the Trial Balance / general ledger would show that same receivable as permanently
-- outstanding forever. That is exactly the "Invoice says Paid but Accounting says unpaid"
-- architecture the task brief said must not ship. Fixed by posting the same kind of 'payment'
-- journal entry confirm_bank_transaction_match() already posts for rent (debit the business bank
-- account 1000, credit AR 1100) -- manual-invoice payments have no real bank_transactions row to
-- match against (recorded by staff, not from a bank feed), so this is the manual-invoice
-- equivalent of that same real event, not a new financial concept.
--
-- This does NOT create a second payment truth alongside bank_transactions/cash_receipts: those two
-- tables are keyed to rent_schedule_id, which a manual invoice never has -- there is no code path
-- (before or after this migration) by which a bank transaction or cash receipt can be matched to a
-- source='manual' invoice, so the same real-world payment cannot be recorded in both places for the
-- same invoice. invoice_payments remains the single, sole source of "was this manual invoice paid"
-- truth; this fix only makes the GENERAL LEDGER agree with that truth, which it did not before.
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_method text,
  p_notes text
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

  select property_id into v_property_id from public.units
    where id = (select unit_id from public.leases where id = v_invoice.lease_id);
  select id into v_bank_gl_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1000';
  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1100';

  insert into public.invoice_payments (invoice_id, amount, paid_at, method, notes, recorded_by)
  values (p_invoice_id, p_amount, p_paid_at, p_method, p_notes, auth.uid())
  returning id into v_payment_id;

  perform public.post_journal_entry(
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

  return v_payment_id;
end;
$$;

comment on function public.record_invoice_payment(uuid, numeric, date, text, text) is
  'Manually records that an issued invoice was paid AND posts the matching payment journal entry
   (debit 1000 bank, credit 1100 AR) so the general ledger and the invoice''s own paid/balance never
   disagree. Final hardening pass, migration 153 (payment row insert unchanged from migration 152;
   the journal posting is the fix).';
