-- Commercial-launch execution plan, Stage 2 (Phase 3 — Shared Ownership data layer, WORKLOG.md
-- this date): extends generate_owner_statements() to be ownership-history-aware (uses the
-- percentage that was actually in effect during the statement's period, not whatever
-- property_owners says today), and adds outstanding-balance/partial-payout tracking plus an
-- explicit maintenance-reserve line to owner_statements. Extends the existing, already-correct
-- percentage-split/rounding-remainder math (20260101000052) rather than replacing it.
--
-- Deliberate scope boundary, documented rather than silently assumed: this resolves the ownership
-- percentage as of the statement's period_end (a single historical snapshot), not full pro-rated
-- allocation for a percentage change that happens mid-period (e.g. an owner sells half their share
-- on day 15 of a 30-day period). That is a materially harder problem -- splitting one property's
-- period activity by date range across two different ownership regimes -- and is not what "the
-- percentage in effect for the period" was scoped to solve in the execution plan. What this DOES
-- fix: a statement generated today for a PAST period now correctly reflects who owned what at
-- that time, not today's percentages, which is the actual dispute scenario this feature exists
-- for ("my brother changed the split after the fact" becomes impossible to even attempt).

alter table public.organizations
  add column maintenance_reserve_pct numeric(5, 2) not null default 0 check (maintenance_reserve_pct >= 0);

alter table public.owner_statements
  add column reserve_amount numeric(12, 2) not null default 0 check (reserve_amount >= 0),
  add column amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  add column outstanding_balance numeric(12, 2) generated always as (net_payable - amount_paid) stored;

-- owner_statement_payouts: a statement can now be paid across multiple partial payments, each
-- matched to its own bank_transaction -- the existing owner_statements.payout_matched_transaction_id
-- (singular) can't represent that. Kept, unchanged meaning: "the transaction that completed FULL
-- payment," set only when the statement reaches status = 'paid' (same CHECK constraint as before,
-- untouched). This table is the new authoritative ledger of every payout event, partial or full --
-- exactly the "distribution history" governance requirement (WORKLOG.md/DECISIONS.md this date's
-- broader context).
create table public.owner_statement_payouts (
  id uuid primary key default gen_random_uuid(),
  owner_statement_id uuid not null references public.owner_statements(id) on delete cascade,
  bank_transaction_id uuid not null references public.bank_transactions(id),
  amount numeric(12, 2) not null check (amount > 0),
  journal_entry_id uuid not null references public.journal_entries(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index owner_statement_payouts_statement_idx on public.owner_statement_payouts (owner_statement_id);

alter table public.owner_statement_payouts enable row level security;

-- Same visibility shape as owner_statements itself (org staff viewer+, or the owner viewing their
-- own record) -- deliberately NOT gated by has_property_access() for the same reason
-- owner_statements itself isn't (TECHNICAL_DEBT_REGISTER.md TD-33): a payout is against a
-- statement that can span multiple properties, no single property_id to gate on correctly.
create policy "owner_statement_payouts_select_org_or_self"
  on public.owner_statement_payouts for select
  using (
    exists (
      select 1 from public.owner_statements os
      where os.id = owner_statement_payouts.owner_statement_id
        and (
          public.has_org_role(os.org_id, 'viewer')
          or exists (select 1 from public.owners o where o.id = os.owner_id and o.user_id = auth.uid())
        )
    )
  );

-- Insert only through confirm_owner_statement_payout() below in practice (same accountant+ check
-- it already performs) -- a direct policy, not "no policy at all" like organizations/
-- property_access, because this function is SECURITY INVOKER (not definer, matching
-- post_journal_entry()'s own reasoning: the calling accountant's own real privileges are what
-- authorize this, not an elevated bypass), so its own internal insert needs a real grant to
-- succeed under RLS. No update/delete policy anywhere -- a payout record, once created, is a
-- permanent part of the distribution history, same posture as journal_lines.
create policy "owner_statement_payouts_insert_accountant_plus"
  on public.owner_statement_payouts for insert
  with check (
    exists (
      select 1 from public.owner_statements os
      where os.id = owner_statement_payouts.owner_statement_id and public.has_org_role(os.org_id, 'accountant')
    )
  );

-- === generate_owner_statements(): now ownership-history-aware, reserve-aware ===
create or replace function public.generate_owner_statements(
  p_org_id uuid,
  p_period_start date,
  p_period_end date
)
returns table(result_owner_id uuid, owner_statement_id uuid, net_payable numeric, skipped_existing boolean)
language plpgsql
as $$
declare
  v_mgmt_fee_pct numeric;
  v_reserve_pct numeric;
  v_property record;
  v_property_rent numeric(12, 2);
  v_property_expenses numeric(12, 2);
  v_co_owner record;
  v_owner_count integer;
  v_idx integer;
  v_rent_running numeric(12, 2);
  v_expenses_running numeric(12, 2);
  v_owner_rent_share numeric(12, 2);
  v_owner_expenses_share numeric(12, 2);
  v_result record;
begin
  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if p_period_end <= p_period_start then
    raise exception 'period_end must be after period_start';
  end if;

  select management_fee_pct, maintenance_reserve_pct into v_mgmt_fee_pct, v_reserve_pct
  from public.organizations where id = p_org_id;

  create temporary table if not exists tmp_owner_statement_totals (
    owner_id uuid primary key,
    rent_collected numeric(12, 2) not null default 0,
    expenses_total numeric(12, 2) not null default 0
  ) on commit drop;
  delete from tmp_owner_statement_totals;

  for v_property in select id from public.properties where org_id = p_org_id loop
    select coalesce(sum(jl.debit), 0) into v_property_rent
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.org_id = p_org_id and je.source_type = 'payment' and jl.debit > 0
      and jl.property_id = v_property.id
      and je.entry_date between p_period_start and p_period_end;

    select coalesce(sum(jl.debit), 0) into v_property_expenses
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.org_id = p_org_id and je.source_type = 'expense' and jl.debit > 0
      and jl.property_id = v_property.id
      and je.entry_date between p_period_start and p_period_end;

    if v_property_rent = 0 and v_property_expenses = 0 then
      continue; -- nothing to allocate for this property this period
    end if;

    -- Ownership as of period_end, from property_ownership_history (20260101000062), not
    -- property_owners' current-state value -- the actual fix this migration makes. A property
    -- whose ownership never changed has exactly one open (effective_to is null) history row,
    -- found here identically to before; one whose ownership DID change resolves to whatever was
    -- true at period_end, not today.
    select count(*) into v_owner_count
    from public.property_ownership_history h
    where h.property_id = v_property.id
      and h.effective_from <= p_period_end
      and (h.effective_to is null or h.effective_to > p_period_end);
    if v_owner_count = 0 then
      continue; -- no recorded owner (as of this period) to allocate this property's activity to
    end if;

    v_idx := 0;
    v_rent_running := 0;
    v_expenses_running := 0;

    for v_co_owner in
      select h.owner_id, h.ownership_pct
      from public.property_ownership_history h
      where h.property_id = v_property.id
        and h.effective_from <= p_period_end
        and (h.effective_to is null or h.effective_to > p_period_end)
      order by h.owner_id
    loop
      v_idx := v_idx + 1;
      if v_idx = v_owner_count then
        v_owner_rent_share := v_property_rent - v_rent_running;
        v_owner_expenses_share := v_property_expenses - v_expenses_running;
      else
        v_owner_rent_share := round(v_property_rent * v_co_owner.ownership_pct / 100, 2);
        v_owner_expenses_share := round(v_property_expenses * v_co_owner.ownership_pct / 100, 2);
        v_rent_running := v_rent_running + v_owner_rent_share;
        v_expenses_running := v_expenses_running + v_owner_expenses_share;
      end if;

      insert into tmp_owner_statement_totals (owner_id, rent_collected, expenses_total)
      values (v_co_owner.owner_id, v_owner_rent_share, v_owner_expenses_share)
      on conflict (owner_id) do update set
        rent_collected = tmp_owner_statement_totals.rent_collected + excluded.rent_collected,
        expenses_total = tmp_owner_statement_totals.expenses_total + excluded.expenses_total;
    end loop;
  end loop;

  for v_result in select t.owner_id, t.rent_collected, t.expenses_total from tmp_owner_statement_totals t loop
    declare
      v_mgmt_fee numeric(12, 2) := round(v_result.rent_collected * v_mgmt_fee_pct / 100, 2);
      v_reserve numeric(12, 2) := round(v_result.rent_collected * v_reserve_pct / 100, 2);
      v_net numeric(12, 2) := v_result.rent_collected - v_result.expenses_total - v_mgmt_fee - v_reserve;
      v_existing_status public.owner_statement_status;
      v_statement_id uuid;
    begin
      select os.id, os.status into v_statement_id, v_existing_status
      from public.owner_statements os
      where os.owner_id = v_result.owner_id and os.period_start = p_period_start and os.period_end = p_period_end;

      if v_statement_id is not null and v_existing_status <> 'draft' then
        result_owner_id := v_result.owner_id;
        owner_statement_id := v_statement_id;
        net_payable := null;
        skipped_existing := true;
        return next;
        continue;
      end if;

      insert into public.owner_statements (
        org_id, owner_id, period_start, period_end, rent_collected, expenses_total,
        management_fee, reserve_amount, net_payable, status
      )
      values (
        p_org_id, v_result.owner_id, p_period_start, p_period_end, v_result.rent_collected,
        v_result.expenses_total, v_mgmt_fee, v_reserve, v_net, 'draft'
      )
      on conflict (owner_id, period_start, period_end) do update set
        rent_collected = excluded.rent_collected,
        expenses_total = excluded.expenses_total,
        management_fee = excluded.management_fee,
        reserve_amount = excluded.reserve_amount,
        net_payable = excluded.net_payable
      returning id into v_statement_id;

      result_owner_id := v_result.owner_id;
      owner_statement_id := v_statement_id;
      net_payable := v_net;
      skipped_existing := false;
      return next;
    end;
  end loop;
end;
$$;

comment on function public.generate_owner_statements(uuid, date, date) is
  'Batch-drafts (or recomputes existing drafts of) one owner_statements row per owner, aggregated
   across every property they held a stake in AS OF THE PERIOD END (property_ownership_history,
   not property_owners'' current state), for the given period -- ACCOUNTING.md §5/§10,
   API_SPEC.md §6. net_payable now also deducts an org-configured maintenance reserve
   (organizations.maintenance_reserve_pct), same mechanism as management_fee_pct.';

-- === confirm_owner_statement_payout(): now supports partial payouts ===
-- `create or replace` does NOT retire the old (uuid, uuid) two-argument signature when the new
-- version adds a third defaulted parameter -- Postgres treats them as distinct overloads, and
-- since p_amount defaults, `confirm_owner_statement_payout(uuid, uuid)` becomes genuinely
-- ambiguous between the two (found live: "function ... is not unique" breaking every existing
-- caller, including the real API route, which only ever passes two arguments). The old signature
-- must be dropped explicitly first.
drop function if exists public.confirm_owner_statement_payout(uuid, uuid);

create or replace function public.confirm_owner_statement_payout(
  p_owner_statement_id uuid,
  p_bank_transaction_id uuid,
  p_amount numeric default null
)
returns uuid
language plpgsql
as $$
declare
  v_statement public.owner_statements%rowtype;
  v_bank_account public.bank_accounts%rowtype;
  v_transaction public.bank_transactions%rowtype;
  v_owner_equity_account_id uuid;
  v_business_bank_account_id uuid;
  v_journal_entry_id uuid;
  v_amount numeric(12, 2);
  v_new_amount_paid numeric(12, 2);
begin
  select * into v_statement from public.owner_statements where id = p_owner_statement_id;
  if not found then
    raise exception 'Owner statement % not found', p_owner_statement_id;
  end if;
  if not public.has_org_role(v_statement.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_statement.status <> 'issued' then
    raise exception 'Owner statement % must be issued before it can be paid (current status: %)', p_owner_statement_id, v_statement.status;
  end if;
  if v_statement.outstanding_balance <= 0 then
    raise exception 'Owner statement % has no outstanding balance to pay out', p_owner_statement_id;
  end if;

  -- p_amount defaults to "pay the rest" -- every existing caller (the app route sends no amount)
  -- gets the exact prior full-payout behavior unchanged; a new caller may pass a smaller amount
  -- for a genuine partial payout.
  v_amount := coalesce(p_amount, v_statement.outstanding_balance);
  if v_amount <= 0 then
    raise exception 'Payout amount must be positive';
  end if;
  if v_amount > v_statement.outstanding_balance then
    raise exception 'Payout amount % exceeds outstanding balance %', v_amount, v_statement.outstanding_balance;
  end if;

  select * into v_transaction from public.bank_transactions where id = p_bank_transaction_id;
  if not found then
    raise exception 'Bank transaction not found';
  end if;
  select * into v_bank_account from public.bank_accounts where id = v_transaction.bank_account_id;
  if v_bank_account.org_id <> v_statement.org_id then
    raise exception 'Bank transaction is not in the same organization as the owner statement';
  end if;
  if v_transaction.match_status = 'matched' then
    raise exception 'Bank transaction % is already matched', p_bank_transaction_id;
  end if;

  select id into v_owner_equity_account_id from public.chart_of_accounts where org_id = v_statement.org_id and code = '3000';
  select id into v_business_bank_account_id from public.chart_of_accounts where org_id = v_statement.org_id and code = '1000';

  v_journal_entry_id := public.post_journal_entry(
    v_statement.org_id,
    v_transaction.transaction_date,
    'Owner statement payout',
    'owner_payout',
    p_owner_statement_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_owner_equity_account_id, 'debit', v_amount, 'owner_id', v_statement.owner_id),
      jsonb_build_object('account_id', v_business_bank_account_id, 'credit', v_amount, 'owner_id', v_statement.owner_id)
    )
  );

  update public.bank_transactions
  set match_status = 'matched', matched_journal_entry_id = v_journal_entry_id
  where id = p_bank_transaction_id;

  insert into public.owner_statement_payouts (owner_statement_id, bank_transaction_id, amount, journal_entry_id, created_by)
  values (p_owner_statement_id, p_bank_transaction_id, v_amount, v_journal_entry_id, auth.uid());

  v_new_amount_paid := v_statement.amount_paid + v_amount;

  update public.owner_statements
  set amount_paid = v_new_amount_paid,
      status = (case when v_new_amount_paid >= v_statement.net_payable then 'paid' else 'issued' end)::public.owner_statement_status,
      payout_matched_transaction_id = case when v_new_amount_paid >= v_statement.net_payable then p_bank_transaction_id else payout_matched_transaction_id end
  where id = p_owner_statement_id;

  return v_journal_entry_id;
end;
$$;

comment on function public.confirm_owner_statement_payout(uuid, uuid, numeric) is
  'Posts Dr Owner Equity, Cr Business Bank for p_amount (defaults to the full remaining
   outstanding_balance, matching the pre-existing full-payout-only behavior exactly for any caller
   that omits it), matched to a confirmed outgoing bank_transaction. Records every payout event in
   owner_statement_payouts (the distribution history) and only flips status to ''paid'' once
   amount_paid reaches net_payable -- may now be called more than once per statement for a genuine
   partial-payout sequence.';
