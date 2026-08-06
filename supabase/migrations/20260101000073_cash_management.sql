-- Commercial-launch execution plan, Stage 3, Phase 7 (Cash Management, WORKLOG.md this date):
-- "Many South African landlords still receive rent in cash" -- the original directive's own
-- wording. Cash received, receipt generated, who received it, deposit into bank, deposit
-- confirmation, variance between received and banked, supporting documents.
--
-- Reuses the existing document-evidence pattern (a `document_id` FK, same as bills/payments) and
-- follows confirm_bank_transaction_match()'s exact posting/rent-schedule-status shape
-- (20260101000038) rather than inventing a parallel one -- cash and bank-matched rent must feed
-- the SAME accounting pipeline (and therefore the same owner statements) or cash rent would
-- simply never show up in a distribution, defeating the point of tracking it at all.

create type public.payment_method as enum ('bank_transfer', 'cash', 'eft', 'card', 'other');

-- Additive, informational -- neither table's existing logic depends on this column; nothing
-- currently reads it. `payments` (bills_and_payments.sql, OCR-extracted outgoing payments) and
-- `bank_transactions` (actual bank-statement lines) both predate the cash-vs-bank distinction.
alter table public.payments add column payment_method public.payment_method;
alter table public.bank_transactions add column payment_method public.payment_method;

create sequence public.cash_receipt_number_seq;

create table public.cash_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  lease_id uuid references public.leases(id),
  rent_schedule_id uuid references public.rent_schedules(id),
  amount numeric(12, 2) not null check (amount > 0),
  -- Global, not per-org, sequence -- simpler and race-free than a per-org counter, and this is an
  -- internal evidence/record-keeping number (not a legal sequential-tax-invoice requirement, which
  -- `invoice_prefix` was reserved for and which nothing in this codebase actually implements yet).
  receipt_number text not null unique default ('CR-' || lpad(nextval('public.cash_receipt_number_seq')::text, 6, '0')),
  received_by uuid not null references auth.users(id),
  received_at timestamptz not null default now(),
  document_id uuid references public.documents(id),
  deposited_at timestamptz,
  deposit_bank_transaction_id uuid references public.bank_transactions(id),
  deposited_amount numeric(12, 2),
  -- Positive: more was banked than received (e.g. bundled with other cash); negative: a shortfall.
  -- Null until actually deposited -- a variance of "0" before any deposit would misleadingly read
  -- as "confirmed exact," not "not yet checked."
  variance numeric(12, 2),
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((deposited_at is not null) = (deposit_bank_transaction_id is not null)),
  check ((deposited_at is not null) = (deposited_amount is not null))
);

create index cash_receipts_property_idx on public.cash_receipts (property_id);
create index cash_receipts_org_idx on public.cash_receipts (org_id, received_at);
create index cash_receipts_rent_schedule_idx on public.cash_receipts (rent_schedule_id) where rent_schedule_id is not null;

create trigger set_cash_receipts_updated_at
  before update on public.cash_receipts
  for each row execute function public.set_updated_at();

alter table public.cash_receipts enable row level security;

-- Same staff-or-owner shape as every other direct-property_id table cut over in Stage 1/3
-- (migrations 20260101000068/72) -- cash receipts are exactly the kind of evidence a co-owner
-- needs to independently verify ("cash payments cannot be tracked" was named directly in the
-- original governance requirement).
create policy "cash_receipts_select_staff_or_owner"
  on public.cash_receipts for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'))
    or public.has_property_access(property_id, 'owner')
  );

-- record_cash_receipt()/confirm_cash_receipt_deposit() below are both SECURITY INVOKER (not
-- definer -- the calling staff member's own real privileges are what authorize these, same
-- reasoning post_journal_entry()/confirm_bank_transaction_match() already use), so their own
-- internal inserts/updates need real policies to succeed under RLS, matching each RPC's own
-- role check exactly -- same lesson owner_statement_payouts (Stage 2) already established: "no
-- policy at all" only works for a SECURITY DEFINER function, and these deliberately aren't ones.
create policy "cash_receipts_insert_agent_plus_and_property_access"
  on public.cash_receipts for insert
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  );

create policy "cash_receipts_update_accountant_plus"
  on public.cash_receipts for update
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

-- record_cash_receipt(): logs that cash was physically received, before any bank deposit exists.
-- agent+ (not accountant+) -- this is an operational "I collected this" action, matching the role
-- level PERMISSIONS.md already assigns to day-to-day property operations; the money doesn't hit
-- the ledger until confirm_cash_receipt_deposit() below, which IS accountant+, same separation
-- ACCOUNTING.md/post_lease_deposit()'s own comment documents ("agents handle day-to-day
-- operations, accountants see money").
create or replace function public.record_cash_receipt(
  p_org_id uuid,
  p_property_id uuid,
  p_amount numeric,
  p_lease_id uuid default null,
  p_rent_schedule_id uuid default null,
  p_document_id uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_receipt_id uuid;
begin
  if auth.uid() is null then
    raise exception 'record_cash_receipt requires an authenticated user';
  end if;
  if not public.has_org_role(p_org_id, 'agent') then
    raise exception 'Caller does not have agent+ rights in this organization';
  end if;
  if not (public.has_property_access(p_property_id, 'property_manager') or public.has_property_access(p_property_id, 'owner')) then
    raise exception 'Caller does not have property-level access to record a cash receipt for this property';
  end if;

  insert into public.cash_receipts (org_id, property_id, lease_id, rent_schedule_id, amount, received_by, document_id)
  values (p_org_id, p_property_id, p_lease_id, p_rent_schedule_id, p_amount, auth.uid(), p_document_id)
  returning id into v_receipt_id;

  return v_receipt_id;
end;
$$;

comment on function public.record_cash_receipt(uuid, uuid, numeric, uuid, uuid, uuid) is
  'Logs a physically-received cash payment (receipt_number auto-generated). Does not touch the
   ledger or rent_schedules -- that happens only once confirm_cash_receipt_deposit() confirms the
   money actually reached the bank, same "record, then separately confirm" two-step
   record_expense()/post_journal_entry() already uses elsewhere in this codebase.';

-- confirm_cash_receipt_deposit(): the money actually reached the bank -- THIS is what posts to the
-- ledger, mirroring confirm_bank_transaction_match() exactly (Dr Bank / Cr Accounts Receivable,
-- property_id + tenant_id tagged, rent_schedule status recomputed from the CUMULATIVE total across
-- every payment source, not just this one).
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
  v_total_paid numeric(12, 2);
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

  -- Same "not in a payable state" guard confirm_bank_transaction_match() applies -- only relevant
  -- when a rent_schedule is actually linked; a generic cash receipt with none has nothing to
  -- guard here.
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

  -- Same cumulative-total reasoning confirm_bank_transaction_match() documents (a real bug found
  -- by testing the two-payment case there) -- extended here to sum across BOTH bank_transactions
  -- and cash_receipts matched to the same schedule, since a schedule can now legitimately be
  -- covered by a mix of both, not just one or the other.
  if v_receipt.rent_schedule_id is not null then
    select * into v_schedule from public.rent_schedules where id = v_receipt.rent_schedule_id;

    select
      coalesce((select sum(abs(amount)) from public.bank_transactions
                where matched_rent_schedule_id = v_receipt.rent_schedule_id and match_status = 'matched'), 0)
      + coalesce((select sum(deposited_amount) from public.cash_receipts
                  where rent_schedule_id = v_receipt.rent_schedule_id and deposited_at is not null), 0)
    into v_total_paid;

    update public.rent_schedules
    set status = (case when v_total_paid >= v_schedule.amount then 'paid' else 'partial' end)::public.rent_schedule_status
    where id = v_receipt.rent_schedule_id;
  end if;

  return v_journal_entry_id;
end;
$$;

comment on function public.confirm_cash_receipt_deposit(uuid, uuid, numeric) is
  'Posts Dr Business/Trust Bank, Cr Accounts Receivable for the DEPOSITED amount (never the
   originally-received amount if different -- ACCOUNTING.md §10''s "post what was actually
   matched" principle, applied to cash). variance = deposited_amount - amount (positive = more
   banked than received, e.g. bundled with other receipts; negative = a shortfall). Recomputes the
   linked rent_schedule''s status from the cumulative total across every bank_transaction AND
   cash_receipt matched to it, not just this one.';

-- confirm_bank_transaction_match() itself (20260101000038) needs the same cumulative-total fix in
-- the other direction -- a schedule partially paid by cash then completed by a bank transfer must
-- also see the cash portion, not just prior bank_transactions.
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
  v_total_paid numeric(12, 2);
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

  select
    coalesce((select sum(abs(amount)) from public.bank_transactions
              where matched_rent_schedule_id = p_rent_schedule_id and match_status = 'matched'), 0)
    + coalesce((select sum(deposited_amount) from public.cash_receipts
                where rent_schedule_id = p_rent_schedule_id and deposited_at is not null), 0)
  into v_total_paid;

  update public.rent_schedules
  set status = (case when v_total_paid >= v_schedule.amount then 'paid' else 'partial' end)::public.rent_schedule_status
  where id = p_rent_schedule_id;

  return v_journal_entry_id;
end;
$$;

comment on function public.confirm_bank_transaction_match(uuid, uuid) is
  'Posts Dr Business/Trust Bank, Cr Accounts Receivable for the matched amount (never the full
   scheduled amount if less), ACCOUNTING.md §3/§10. Confirmation is always a staff action -- this
   function is never called automatically by a proposed-match step. Rent-schedule status is now
   computed across BOTH bank_transactions and cash_receipts matched to the schedule (Stage 3 Phase
   7, commercial-launch execution plan) -- a schedule can legitimately be covered by a mix of both.';
