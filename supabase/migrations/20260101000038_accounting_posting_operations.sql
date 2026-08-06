-- TASKS.md M14 part 2: typed posting operations. Only the four unambiguously-specified in
-- ACCOUNTING.md §3's source-type table are built here: expense recording, rent invoicing,
-- payment confirmation, and deposit posting. Deliberately NOT built in this migration:
-- release_trust_deposit() (deduction/refund) and accrue_trust_interest() -- both require an
-- accounting-account mapping ACCOUNTING.md doesn't specify (which account absorbs a deposit
-- deduction? does interest accrual model real bank-earned interest, tenant-owed interest, or
-- both as one flow?), and both touch real trust-money handling where inventing an unspecified
-- mapping carries more real consequence than getting an expense/invoice/payment posting wrong.
-- Tracked as open work, not guessed at -- see TECHNICAL_DEBT_REGISTER.md.

-- rent_schedules (20260101000030) was built agent+-writable, before accounting existed --
-- invoicing/payment-confirmation need to update it too, and that's squarely an accounting action
-- (PERMISSIONS.md §2: agent has no accounting-post rights). Adds a second, independent permissive
-- policy rather than replacing the existing one -- Postgres RLS OR's multiple permissive policies
-- together, so rent_schedules becomes writable by *either* agent+ (day-to-day schedule
-- adjustments) *or* accountant+ (invoicing/payment posting), each for their own concern.
create policy "rent_schedules_write_accountant_plus"
  on public.rent_schedules for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

-- === record_expense(): the "expense" source type ===
create or replace function public.record_expense(
  p_expense_id uuid,
  p_paid_immediately boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_expense public.expenses%rowtype;
  v_expense_account_id uuid;
  v_credit_account_id uuid;
  v_journal_entry_id uuid;
begin
  select * into v_expense from public.expenses where id = p_expense_id;
  if not found then
    raise exception 'Expense not found';
  end if;
  if not public.has_org_role(v_expense.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_expense.status <> 'pending' then
    raise exception 'Expense % is not pending (current status: %)', p_expense_id, v_expense.status;
  end if;

  -- Category-to-account matching: exact (case-insensitive) name match against the org's active
  -- expense accounts, falling back to the seeded 'Other Expense' (5900) catch-all. V1 answer,
  -- matching ACCOUNTING.md §10's own stated approach to unmodelled specifics ("no automatic
  -- apportionment logic exists in V1") -- no fuzzy matching or auto-created per-category accounts.
  select id into v_expense_account_id from public.chart_of_accounts
  where org_id = v_expense.org_id and is_active and account_type = 'expense'
    and lower(name) = lower(v_expense.category || ' Expense')
  limit 1;

  if v_expense_account_id is null then
    select id into v_expense_account_id from public.chart_of_accounts
    where org_id = v_expense.org_id and code = '5900';
  end if;

  select id into v_credit_account_id from public.chart_of_accounts
  where org_id = v_expense.org_id and code = (case when p_paid_immediately then '1000' else '2000' end);

  v_journal_entry_id := public.post_journal_entry(
    v_expense.org_id,
    current_date,
    'Expense: ' || v_expense.category,
    'expense',
    p_expense_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_expense_account_id, 'debit', v_expense.amount, 'property_id', v_expense.property_id),
      jsonb_build_object('account_id', v_credit_account_id, 'credit', v_expense.amount, 'property_id', v_expense.property_id)
    )
  );

  update public.expenses set status = 'recorded', journal_entry_id = v_journal_entry_id where id = p_expense_id;

  return v_journal_entry_id;
end;
$$;

comment on function public.record_expense(uuid, boolean) is
  'Posts Dr [category] Expense, Cr Accounts Payable (or Business Bank if paid immediately),
   ACCOUNTING.md §3. Marks the expense recorded -- the trigger the source-type table describes.';

-- === invoice_rent_schedule(): the "rent_invoice" source type ===
create or replace function public.invoice_rent_schedule(p_rent_schedule_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_schedule public.rent_schedules%rowtype;
  v_lease public.leases%rowtype;
  v_property_id uuid;
  v_tenant_id uuid;
  v_ar_account_id uuid;
  v_income_account_id uuid;
  v_journal_entry_id uuid;
  v_invoice_id uuid;
begin
  select * into v_schedule from public.rent_schedules where id = p_rent_schedule_id;
  if not found then
    raise exception 'Rent schedule not found';
  end if;
  if not public.has_org_role(v_schedule.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_schedule.status <> 'pending' then
    raise exception 'Rent schedule % is not pending (current status: %)', p_rent_schedule_id, v_schedule.status;
  end if;

  select * into v_lease from public.leases where id = v_schedule.lease_id;
  select property_id into v_property_id from public.units where id = v_lease.unit_id;
  select tenant_id into v_tenant_id from public.lease_tenants where lease_id = v_lease.id and is_primary limit 1;

  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_schedule.org_id and code = '1100';
  select id into v_income_account_id from public.chart_of_accounts where org_id = v_schedule.org_id and code = '4000';

  v_journal_entry_id := public.post_journal_entry(
    v_schedule.org_id,
    v_schedule.due_date,
    'Rent invoice',
    'rent_invoice',
    p_rent_schedule_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar_account_id, 'debit', v_schedule.amount, 'property_id', v_property_id, 'tenant_id', v_tenant_id),
      jsonb_build_object('account_id', v_income_account_id, 'credit', v_schedule.amount, 'property_id', v_property_id, 'tenant_id', v_tenant_id)
    )
  );

  insert into public.invoices (org_id, lease_id, tenant_id, period, amount, status, issued_at)
  values (v_schedule.org_id, v_lease.id, v_tenant_id, v_schedule.due_date, v_schedule.amount, 'issued', now())
  returning id into v_invoice_id;

  update public.rent_schedules set status = 'invoiced' where id = p_rent_schedule_id;

  return v_invoice_id;
end;
$$;

comment on function public.invoice_rent_schedule(uuid) is
  'Posts Dr Accounts Receivable, Cr Rent Income and issues the invoice, ACCOUNTING.md §3.';

-- === confirm_bank_transaction_match(): the "payment" source type, rent-payment case ===
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

  -- Post whatever was actually matched, never the full scheduled amount -- ACCOUNTING.md §10's
  -- documented partial-payment edge case: "post a payment journal entry for the actual matched
  -- amount... never the full scheduled amount."
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

  -- Partial vs full distinction lives in rent_schedules.status, not in how the entry is built
  -- (ACCOUNTING.md §10) -- no special-cased posting logic for a partial amount beyond "post what
  -- was actually matched," which the line above already does unconditionally. The paid-vs-partial
  -- decision itself must compare against the CUMULATIVE amount matched against this schedule
  -- across every transaction, not just this one -- a second covering payment on top of an earlier
  -- partial payment would otherwise be compared against the full schedule amount in isolation and
  -- wrongly stay 'partial' even once fully covered. Found as a real bug by testing the two-payment
  -- case specifically, not assumed correct from a single-payment test.
  select coalesce(sum(abs(amount)), 0) into v_total_paid
  from public.bank_transactions
  where matched_rent_schedule_id = p_rent_schedule_id and match_status = 'matched';

  update public.rent_schedules
  set status = (case when v_total_paid >= v_schedule.amount then 'paid' else 'partial' end)::public.rent_schedule_status
  where id = p_rent_schedule_id;

  return v_journal_entry_id;
end;
$$;

comment on function public.confirm_bank_transaction_match(uuid, uuid) is
  'Posts Dr Business/Trust Bank, Cr Accounts Receivable for the matched amount (never the full
   scheduled amount if less), ACCOUNTING.md §3/§10. Confirmation is always a staff action -- this
   function is never called automatically by a proposed-match step.';

-- === post_lease_deposit(): the "deposit" source type ===
-- accountant+ only (PERMISSIONS.md §2: agent has NO accounting-post rights) -- deliberately not
-- folded into approve_application() (agent+), even though ACCOUNTING.md §3 describes "a lease
-- with a deposit goes active" as the trigger. Checked PERMISSIONS.md's role table before writing
-- this, not after: an agent approving a move-in should not be able to trigger a trust-account
-- posting as a side effect -- that is exactly the "agents handle day-to-day operations,
-- accountants see money" separation the role table encodes. This is therefore a deliberate,
-- separate, explicit accountant action taken once a deposit-bearing lease exists, not an
-- automatic consequence of approval.
create or replace function public.post_lease_deposit(p_lease_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_lease public.leases%rowtype;
  v_tenant_id uuid;
  v_trust_bank_account_id uuid;
  v_deposits_held_account_id uuid;
  v_journal_entry_id uuid;
  v_trust_ledger_id uuid;
  v_interest_pct numeric;
begin
  select * into v_lease from public.leases where id = p_lease_id;
  if not found then
    raise exception 'Lease not found';
  end if;
  if not public.has_org_role(v_lease.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_lease.deposit_amount <= 0 then
    raise exception 'Lease % has no deposit amount to post', p_lease_id;
  end if;
  if exists (select 1 from public.trust_ledgers where lease_id = p_lease_id) then
    raise exception 'A trust ledger already exists for lease %', p_lease_id;
  end if;

  select tenant_id into v_tenant_id from public.lease_tenants where lease_id = p_lease_id and is_primary limit 1;
  if v_tenant_id is null then
    raise exception 'Lease % has no primary tenant to post the deposit against', p_lease_id;
  end if;

  select id into v_trust_bank_account_id from public.chart_of_accounts where org_id = v_lease.org_id and code = '1010';
  select id into v_deposits_held_account_id from public.chart_of_accounts where org_id = v_lease.org_id and code = '2100';
  select deposit_interest_pct into v_interest_pct from public.organizations where id = v_lease.org_id;

  v_journal_entry_id := public.post_journal_entry(
    v_lease.org_id,
    current_date,
    'Deposit received',
    'deposit',
    p_lease_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_trust_bank_account_id, 'debit', v_lease.deposit_amount, 'tenant_id', v_tenant_id),
      jsonb_build_object('account_id', v_deposits_held_account_id, 'credit', v_lease.deposit_amount, 'tenant_id', v_tenant_id)
    )
  );

  insert into public.trust_ledgers (org_id, tenant_id, lease_id, opening_balance, current_balance, interest_rate_pct)
  values (v_lease.org_id, v_tenant_id, p_lease_id, v_lease.deposit_amount, v_lease.deposit_amount, coalesce(v_interest_pct, 0))
  returning id into v_trust_ledger_id;

  insert into public.trust_ledger_entries (trust_ledger_id, journal_entry_id, entry_type, amount)
  values (v_trust_ledger_id, v_journal_entry_id, 'deposit_received', v_lease.deposit_amount);

  return v_trust_ledger_id;
end;
$$;

comment on function public.post_lease_deposit(uuid) is
  'Posts Dr Trust Bank, Cr Tenant Deposits Held and opens the trust ledger for a deposit-bearing
   lease, ACCOUNTING.md §3/§4. accountant+ only, called explicitly once by whoever handles the
   org''s trust accounting -- never automatic, never callable twice for the same lease.';
