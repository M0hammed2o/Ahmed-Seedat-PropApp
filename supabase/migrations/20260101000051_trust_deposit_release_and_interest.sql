-- TASKS.md M14 part 3 / TECHNICAL_DEBT_REGISTER.md TD-22: release_trust_deposit() and
-- accrue_trust_interest() -- the two trust-money operations deliberately left unbuilt in
-- migration 20260101000038 pending an account-mapping decision. ACCOUNTING.md §4 already
-- specifies the computation/gating rules unambiguously (release requires a completed move_out
-- inspection; interest applies organizations.deposit_interest_pct); only the exact chart-of-
-- accounts mapping for the release side was undecided. Decided here, documented inline rather
-- than left implicit, following the existing post_lease_deposit()/record_expense() pattern of a
-- Dr/Cr pair against real seeded accounts.

-- Two new system accounts -- the account_mapping question TD-22 actually raised. Backfilled onto
-- every existing org (seeding only runs at org creation) and added to seed_chart_of_accounts()
-- for every org created from here on.
insert into public.chart_of_accounts (org_id, code, name, account_type, ledger_class, is_system)
select o.id, '4900', 'Deposit Deduction Income', 'income', 'business', true
from public.organizations o
where not exists (
  select 1 from public.chart_of_accounts c where c.org_id = o.id and c.code = '4900'
);

insert into public.chart_of_accounts (org_id, code, name, account_type, ledger_class, is_system)
select o.id, '5950', 'Trust Interest Expense', 'expense', 'business', true
from public.organizations o
where not exists (
  select 1 from public.chart_of_accounts c where c.org_id = o.id and c.code = '5950'
);

create or replace function public.seed_chart_of_accounts(p_org_id uuid)
returns void
language plpgsql
as $$
begin
  insert into public.chart_of_accounts (org_id, code, name, account_type, ledger_class, is_system)
  values
    (p_org_id, '1000', 'Business Bank Account', 'asset', 'business', true),
    (p_org_id, '1010', 'Trust Bank Account', 'asset', 'trust', true),
    (p_org_id, '1100', 'Accounts Receivable', 'asset', 'business', true),
    (p_org_id, '2000', 'Accounts Payable', 'liability', 'business', true),
    (p_org_id, '2100', 'Tenant Deposits Held', 'liability', 'trust', true),
    (p_org_id, '3000', 'Owner Equity', 'equity', 'business', true),
    (p_org_id, '4000', 'Rent Income', 'income', 'business', true),
    (p_org_id, '4100', 'Late Fee Income', 'income', 'business', true),
    (p_org_id, '4900', 'Deposit Deduction Income', 'income', 'business', true),
    (p_org_id, '5000', 'Maintenance Expense', 'expense', 'business', true),
    (p_org_id, '5100', 'Management Fee Expense', 'expense', 'business', true),
    (p_org_id, '5900', 'Other Expense', 'expense', 'business', true),
    (p_org_id, '5950', 'Trust Interest Expense', 'expense', 'business', true);
end;
$$;

-- trust_ledgers.status: release is a one-time, terminal, whole-balance settlement (move-out
-- settles the whole deposit at once, per ACCOUNTING.md's own evidenced framing -- there is no
-- documented "partial release" workflow to build against) -- this is the real double-release
-- guard, not just an application-layer check.
create type public.trust_ledger_status as enum ('active', 'released');
alter table public.trust_ledgers add column status public.trust_ledger_status not null default 'active';

-- === release_trust_deposit(): "deduction"/"refund" trust_ledger_entries, source_type='deposit'
-- (journal_source_type has no separate deduction/refund value -- ACCOUNTING.md §3's table has no
-- row for either; reusing 'deposit' for every trust-ledger-touching entry, matching the enum that
-- already exists rather than widening it for a label-only distinction the trust_ledger_entries
-- row itself already carries via entry_type) ===
--
-- Settles the ENTIRE remaining trust_ledgers.current_balance in one call, split into a deduction
-- portion (kept by the landlord) and a refund portion (returned to the tenant) that must sum to
-- exactly the current balance -- V1 does not support a partial/staged release, matching the
-- evidenced "no deduction without findings on a completed move-out inspection" move-out-settlement
-- framing (IMG_8039), not an installment-refund product.
--
-- Two journal entries, not one, because they represent two different real cash movements:
-- (1) both the deduction and refund amounts leave the Trust Bank Account and the Tenant Deposits
--     Held liability is cleared by the same total -- mirrors post_lease_deposit()'s own Dr/Cr pair
--     exactly, reversed.
-- (2) the deduction portion specifically then becomes the landlord's own money -- recognised as
--     income into the Business Bank Account. The refund portion needs no second entry: it already
--     left the org's accounts entirely in entry (1).
create or replace function public.release_trust_deposit(
  p_lease_id uuid,
  p_deduction_amount numeric,
  p_refund_amount numeric,
  p_deduction_memo text default null
)
returns uuid
language plpgsql
as $$
declare
  v_ledger public.trust_ledgers%rowtype;
  v_org_id uuid;
  v_trust_bank_account_id uuid;
  v_deposits_held_account_id uuid;
  v_business_bank_account_id uuid;
  v_deduction_income_account_id uuid;
  v_release_entry_id uuid;
  v_deduction_entry_id uuid;
  v_total numeric(12, 2);
begin
  if p_deduction_amount < 0 or p_refund_amount < 0 then
    raise exception 'Deduction and refund amounts must both be zero or positive';
  end if;
  v_total := p_deduction_amount + p_refund_amount;
  if v_total <= 0 then
    raise exception 'A deposit release requires a positive deduction and/or refund amount';
  end if;

  -- Deliberately no FOR UPDATE: on a table with an accountant+-only "for all" write policy,
  -- SELECT ... FOR UPDATE additionally requires satisfying that UPDATE-level policy (not just the
  -- viewer+ SELECT policy) to lock the row -- found by a real test: an agent-only caller got a
  -- misleading "No trust ledger exists" instead of the intended "Caller does not have
  -- accountant+ rights" message, since RLS silently filtered the row out before this function's
  -- own explicit role check ever ran. Matches every other posting operation in this codebase
  -- (post_lease_deposit() etc.), none of which use FOR UPDATE either.
  select * into v_ledger from public.trust_ledgers where lease_id = p_lease_id;
  if not found then
    raise exception 'No trust ledger exists for lease %', p_lease_id;
  end if;
  v_org_id := v_ledger.org_id;

  if not public.has_org_role(v_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_ledger.status = 'released' then
    raise exception 'Trust ledger for lease % has already been released', p_lease_id;
  end if;
  if v_total <> v_ledger.current_balance then
    raise exception 'Deduction (%) + refund (%) must equal the trust ledger''s current balance (%)',
      p_deduction_amount, p_refund_amount, v_ledger.current_balance;
  end if;

  -- ACCOUNTING.md §4 release gate: "no deduction without findings on a completed move-out
  -- inspection" -- enforced here, in the service, not just a UI disable.
  if not exists (
    select 1 from public.inspections
    where lease_id = p_lease_id and inspection_type = 'move_out' and status = 'completed'
  ) then
    raise exception 'Lease % has no completed move-out inspection -- deposit cannot be released', p_lease_id;
  end if;

  select id into v_trust_bank_account_id from public.chart_of_accounts where org_id = v_org_id and code = '1010';
  select id into v_deposits_held_account_id from public.chart_of_accounts where org_id = v_org_id and code = '2100';

  v_release_entry_id := public.post_journal_entry(
    v_org_id,
    current_date,
    'Deposit release (settlement)',
    'deposit',
    p_lease_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_deposits_held_account_id, 'debit', v_total, 'tenant_id', v_ledger.tenant_id),
      jsonb_build_object('account_id', v_trust_bank_account_id, 'credit', v_total, 'tenant_id', v_ledger.tenant_id)
    )
  );

  if p_deduction_amount > 0 then
    select id into v_business_bank_account_id from public.chart_of_accounts where org_id = v_org_id and code = '1000';
    select id into v_deduction_income_account_id from public.chart_of_accounts where org_id = v_org_id and code = '4900';

    v_deduction_entry_id := public.post_journal_entry(
      v_org_id,
      current_date,
      coalesce('Deposit deduction: ' || p_deduction_memo, 'Deposit deduction'),
      'deposit',
      p_lease_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_business_bank_account_id, 'debit', p_deduction_amount, 'tenant_id', v_ledger.tenant_id),
        jsonb_build_object('account_id', v_deduction_income_account_id, 'credit', p_deduction_amount, 'tenant_id', v_ledger.tenant_id)
      )
    );

    insert into public.trust_ledger_entries (trust_ledger_id, journal_entry_id, entry_type, amount)
    values (v_ledger.id, v_release_entry_id, 'deduction', p_deduction_amount);
  end if;

  if p_refund_amount > 0 then
    insert into public.trust_ledger_entries (trust_ledger_id, journal_entry_id, entry_type, amount)
    values (v_ledger.id, v_release_entry_id, 'refund', p_refund_amount);
  end if;

  update public.trust_ledgers set current_balance = 0, status = 'released' where id = v_ledger.id;

  return v_release_entry_id;
end;
$$;

comment on function public.release_trust_deposit(uuid, numeric, numeric, text) is
  'Settles a trust ledger''s entire remaining balance at move-out: Dr Tenant Deposits Held,
   Cr Trust Bank Account for the total, plus Dr Business Bank / Cr Deposit Deduction Income for
   any deduction portion. Requires a completed move_out inspection (ACCOUNTING.md §4) and is a
   one-time, whole-balance, accountant+-only action -- ACCOUNTING.md/TASKS.md M14 part 3.';

-- === accrue_trust_interest(): "interest_accrued" trust_ledger_entries ===
--
-- ACCOUNTING.md §4's rule is unambiguous on WHAT to compute (organizations.deposit_interest_pct
-- applied to the ledger's balance, posted as its own entry, never folded silently into the
-- balance) -- simple daily-prorated interest since the last accrual (or since the deposit was
-- received, if never accrued) is the ordinary way to prorate an annual percentage rate, not an
-- invented business rule. What ACCOUNTING.md does NOT specify is unattended scheduling -- like
-- TD-20's rent-schedule generator before this pass, that needs real cron infrastructure this
-- codebase doesn't have yet. Rather than block interest entirely on that missing infrastructure,
-- this ships as an explicit accountant-triggered action (matching post_lease_deposit()'s own
-- existing "accountant+ only, called explicitly" pattern, not a client-supplied guess) -- real
-- unattended automation is deferred, not the computation itself.
create or replace function public.accrue_trust_interest(p_trust_ledger_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_ledger public.trust_ledgers%rowtype;
  v_interest_expense_account_id uuid;
  v_deposits_held_account_id uuid;
  v_journal_entry_id uuid;
  v_days numeric;
  v_interest_amount numeric(12, 2);
begin
  -- No FOR UPDATE here either -- same reasoning as release_trust_deposit() above.
  select * into v_ledger from public.trust_ledgers where id = p_trust_ledger_id;
  if not found then
    raise exception 'Trust ledger % not found', p_trust_ledger_id;
  end if;

  if not public.has_org_role(v_ledger.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_ledger.status <> 'active' then
    raise exception 'Trust ledger % is not active (already released)', p_trust_ledger_id;
  end if;
  if v_ledger.interest_rate_pct <= 0 or v_ledger.current_balance <= 0 then
    return null; -- nothing to accrue -- not an error, just a no-op (matches post_journal_entry()'s
                 -- own "cannot have zero total value" rule; silently skipping avoids forcing every
                 -- caller to special-case a zero-rate/zero-balance ledger).
  end if;

  v_days := extract(epoch from (now() - coalesce(v_ledger.last_interest_accrual_at, v_ledger.created_at))) / 86400;
  if v_days <= 0 then
    return null; -- already accrued at or after "now" (e.g. called twice in the same instant)
  end if;

  v_interest_amount := round(v_ledger.current_balance * (v_ledger.interest_rate_pct / 100) * (v_days / 365), 2);
  if v_interest_amount <= 0 then
    return null; -- rounds to zero for a very short elapsed period -- a real no-op, not an error
  end if;

  select id into v_interest_expense_account_id from public.chart_of_accounts where org_id = v_ledger.org_id and code = '5950';
  select id into v_deposits_held_account_id from public.chart_of_accounts where org_id = v_ledger.org_id and code = '2100';

  v_journal_entry_id := public.post_journal_entry(
    v_ledger.org_id,
    current_date,
    'Trust deposit interest accrual',
    'deposit',
    p_trust_ledger_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_interest_expense_account_id, 'debit', v_interest_amount, 'tenant_id', v_ledger.tenant_id),
      jsonb_build_object('account_id', v_deposits_held_account_id, 'credit', v_interest_amount, 'tenant_id', v_ledger.tenant_id)
    )
  );

  insert into public.trust_ledger_entries (trust_ledger_id, journal_entry_id, entry_type, amount)
  values (v_ledger.id, v_journal_entry_id, 'interest_accrued', v_interest_amount);

  update public.trust_ledgers
  set current_balance = current_balance + v_interest_amount, last_interest_accrual_at = now()
  where id = v_ledger.id;

  return v_journal_entry_id;
end;
$$;

comment on function public.accrue_trust_interest(uuid) is
  'Posts Dr Trust Interest Expense, Cr Tenant Deposits Held for simple daily-prorated interest at
   organizations.deposit_interest_pct since the last accrual. Explicit accountant+ action in V1
   (no unattended scheduler exists yet, same infrastructure gap as TD-20) -- ACCOUNTING.md §4,
   TECHNICAL_DEBT_REGISTER.md TD-22.';

-- === accrue_trust_interest_for_org(): convenience bulk wrapper, still session-based (runs under
-- the calling accountant's own rights for every ledger in their org in one action, not a system
-- job) -- lets Super Admin/accounting UI offer a single "accrue interest for all active deposits"
-- action without needing service-role/cron infrastructure. ===
create or replace function public.accrue_trust_interest_for_org(p_org_id uuid)
returns table(trust_ledger_id uuid, journal_entry_id uuid)
language plpgsql
as $$
declare
  v_ledger record;
  v_entry_id uuid;
begin
  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;

  for v_ledger in
    select id from public.trust_ledgers where org_id = p_org_id and status = 'active' order by id
  loop
    v_entry_id := public.accrue_trust_interest(v_ledger.id);
    if v_entry_id is not null then
      trust_ledger_id := v_ledger.id;
      journal_entry_id := v_entry_id;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.accrue_trust_interest_for_org(uuid) is
  'Runs accrue_trust_interest() for every active trust ledger in one org, under the calling
   accountant''s own session -- the multi-ledger convenience action, not a scheduled job.';
