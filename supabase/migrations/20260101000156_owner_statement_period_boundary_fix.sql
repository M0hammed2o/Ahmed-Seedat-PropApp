-- Final accounting reconciliation pass (WORKLOG.md this date), P0: real, pre-existing bug in
-- generate_owner_statements() (last redefined 20260101000071) found by the full pgTAP suite on
-- 2026-08-31 (the last calendar day of a month) -- root-caused by direct reproduction, not
-- assumed.
--
-- property_ownership_history.effective_from/effective_to are `timestamptz` (real wall-clock
-- precision, migration 20260101000062); p_period_end is a bare `date`. Postgres casts a date to
-- timestamptz at MIDNIGHT (00:00:00, UTC -- `SHOW TimeZone` confirms this database runs UTC) when
-- comparing the two, so `effective_from <= p_period_end` silently excludes anything that happened
-- later than midnight on the period's own last day -- which is effectively always, since an
-- ownership row created "today" (via the property_owners trigger, effective_from = now()) is only
-- ever exactly midnight by coincidence. Reproduced directly: `select now() <= '2026-08-31'::date`
-- returns false at any time after 00:00:00 UTC. journal_entries.entry_date (used for the
-- rent/expense totals in this same function) is already a plain `date` column, compared
-- date-to-date with no such bug -- only the two ownership-history comparisons below needed fixing.
--
-- Fix: an explicit half-open interval, `effective_from < period_end + 1 day` (was `<= period_end`)
-- and `effective_to is null or effective_to >= period_end + 1 day` (was `> period_end`) --
-- "ownership was in effect at any point up to and including the entire last calendar day of the
-- period," computed once as v_period_end_exclusive and reused in both places. Body is otherwise
-- byte-for-byte identical to 20260101000071's version -- no other behaviour changes.

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
  -- Final accounting reconciliation pass, migration 156: the correct exclusive upper bound for
  -- comparing a timestamptz ownership-history boundary against this date-typed period -- see this
  -- migration's own header comment for why the naive `<= p_period_end` was wrong.
  v_period_end_exclusive timestamptz;
begin
  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if p_period_end <= p_period_start then
    raise exception 'period_end must be after period_start';
  end if;

  v_period_end_exclusive := (p_period_end + 1)::timestamptz;

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
    -- property_owners' current-state value -- the actual fix that migration makes. A property
    -- whose ownership never changed has exactly one open (effective_to is null) history row,
    -- found here identically to before; one whose ownership DID change resolves to whatever was
    -- true at period_end (the full calendar day, migration 156's own fix), not today.
    select count(*) into v_owner_count
    from public.property_ownership_history h
    where h.property_id = v_property.id
      and h.effective_from < v_period_end_exclusive
      and (h.effective_to is null or h.effective_to >= v_period_end_exclusive);
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
        and h.effective_from < v_period_end_exclusive
        and (h.effective_to is null or h.effective_to >= v_period_end_exclusive)
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
  'Migration 156: fixed a date/timestamptz boundary bug that silently excluded any property whose
   ownership record was created after midnight UTC on the period''s own last day -- i.e. almost
   always, surfacing worst-case on the last calendar day of a month. Otherwise identical to the
   20260101000071 version.';
