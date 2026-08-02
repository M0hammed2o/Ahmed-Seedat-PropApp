-- TASKS.md M14 part 3 / API_SPEC.md §6: Owner Statements generation. ACCOUNTING.md §5's rules
-- (generated not hand-entered, snapshot not live, paid only via a matched payout) plus §10's
-- documented multi-owner rounding rule (round each owner's share independently, post the
-- remainder to the last owner in stable owner_id order) implemented exactly as specified.

-- Simple flat org-level rate, mirroring the existing organizations.deposit_interest_pct pattern
-- exactly -- ACCOUNTING.md/DATABASE.md never specify a management-fee schedule beyond "computes
-- management_fee", so a single configurable percentage (not a tiered/per-property schedule) is
-- the smallest correct V1 mechanism, following the one precedent this codebase already has for
-- "an org-configured percentage applied by a posting/statement service."
alter table public.organizations
  add column management_fee_pct numeric(5, 2) not null default 0 check (management_fee_pct >= 0);

-- === generate_owner_statements(): the "month-scoped batch draft" (API_SPEC.md §6) ===
-- For every property in the org, sums payment/expense journal_lines for the period, splits by
-- property_owners.ownership_pct with the ACCOUNTING.md §10 rounding-remainder-to-last-owner rule,
-- accumulates each owner's totals across every property they hold a stake in (an owner with
-- stakes in 3 properties gets ONE statement row for the period, not three), then writes/updates a
-- draft owner_statements row per owner. Skips (does not overwrite) any owner who already has a
-- non-draft (issued/paid) statement for this exact period -- ACCOUNTING.md §5's "a statement
-- already issued must not silently change" rule. Re-running for the same period is safe: a draft
-- is recomputed from the ledger (still just a draft, nothing has been shown to an owner as final
-- yet); an issued/paid statement is left untouched.
create or replace function public.generate_owner_statements(
  p_org_id uuid,
  p_period_start date,
  p_period_end date
)
-- OUT param named result_owner_id, not owner_id -- property_owners/owner_statements/the temp
-- table below all have a real column literally named owner_id, and PL/pgSQL genuinely cannot
-- disambiguate an OUT parameter of that same name from the table column even inside an
-- ON CONFLICT (owner_id) target (found by running this, not assumed safe from the FOR-loop fix
-- above -- that one only covered a plain SELECT, not every clause shape).
returns table(result_owner_id uuid, owner_statement_id uuid, net_payable numeric, skipped_existing boolean)
language plpgsql
as $$
declare
  v_mgmt_fee_pct numeric;
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

  select management_fee_pct into v_mgmt_fee_pct from public.organizations where id = p_org_id;

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

    select count(*) into v_owner_count from public.property_owners where property_id = v_property.id;
    if v_owner_count = 0 then
      continue; -- no recorded owner to allocate this property's activity to
    end if;

    v_idx := 0;
    v_rent_running := 0;
    v_expenses_running := 0;

    -- Columns qualified explicitly (po.owner_id, not owner_id) -- this function's own OUT
    -- parameter is also named owner_id, and an unqualified reference here would be genuinely
    -- ambiguous between that PL/pgSQL variable and the table column (found by actually running
    -- this, not assumed safe).
    for v_co_owner in
      select po.owner_id, po.ownership_pct from public.property_owners po
      where po.property_id = v_property.id order by po.owner_id
    loop
      v_idx := v_idx + 1;
      if v_idx = v_owner_count then
        -- Last owner in stable order absorbs the rounding remainder (ACCOUNTING.md §10) --
        -- guarantees sum(owner shares) = property total exactly, never silently a cent short/over.
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
      v_net numeric(12, 2) := v_result.rent_collected - v_result.expenses_total - v_mgmt_fee;
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

      insert into public.owner_statements (org_id, owner_id, period_start, period_end, rent_collected, expenses_total, management_fee, net_payable, status)
      values (p_org_id, v_result.owner_id, p_period_start, p_period_end, v_result.rent_collected, v_result.expenses_total, v_mgmt_fee, v_net, 'draft')
      on conflict (owner_id, period_start, period_end) do update set
        rent_collected = excluded.rent_collected,
        expenses_total = excluded.expenses_total,
        management_fee = excluded.management_fee,
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
   across every property they hold a stake in, for the given period -- ACCOUNTING.md §5/§10,
   API_SPEC.md §6 "month-scoped batch draft, skips owners who already have one" (issued/paid ones).';

-- === issue_owner_statement(): freezes a draft as the durable snapshot ACCOUNTING.md §5 requires ===
create or replace function public.issue_owner_statement(p_owner_statement_id uuid)
returns void
language plpgsql
as $$
declare
  v_statement public.owner_statements%rowtype;
begin
  select * into v_statement from public.owner_statements where id = p_owner_statement_id;
  if not found then
    raise exception 'Owner statement % not found', p_owner_statement_id;
  end if;
  if not public.has_org_role(v_statement.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_statement.status <> 'draft' then
    raise exception 'Owner statement % is not a draft (current status: %)', p_owner_statement_id, v_statement.status;
  end if;

  update public.owner_statements set status = 'issued' where id = p_owner_statement_id;
end;
$$;

comment on function public.issue_owner_statement(uuid) is
  'Freezes a draft owner_statements row -- no further regeneration will touch it, matching
   ACCOUNTING.md §5''s snapshot requirement.';

-- === confirm_owner_statement_payout(): the "owner_payout" journal_source_type, ACCOUNTING.md §3 ===
create or replace function public.confirm_owner_statement_payout(
  p_owner_statement_id uuid,
  p_bank_transaction_id uuid
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
  if v_statement.net_payable <= 0 then
    raise exception 'Owner statement % has no positive net_payable to pay out', p_owner_statement_id;
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
      jsonb_build_object('account_id', v_owner_equity_account_id, 'debit', v_statement.net_payable, 'owner_id', v_statement.owner_id),
      jsonb_build_object('account_id', v_business_bank_account_id, 'credit', v_statement.net_payable, 'owner_id', v_statement.owner_id)
    )
  );

  update public.bank_transactions
  set match_status = 'matched', matched_journal_entry_id = v_journal_entry_id
  where id = p_bank_transaction_id;

  update public.owner_statements
  set status = 'paid', payout_matched_transaction_id = p_bank_transaction_id
  where id = p_owner_statement_id;

  return v_journal_entry_id;
end;
$$;

comment on function public.confirm_owner_statement_payout(uuid, uuid) is
  'Posts Dr Owner Equity, Cr Business Bank for an issued statement''s net_payable, matched to a
   confirmed outgoing bank_transaction -- ACCOUNTING.md §3/§5''s "marked paid only when a payout
   is matched" rule, never on generation/issue alone.';
