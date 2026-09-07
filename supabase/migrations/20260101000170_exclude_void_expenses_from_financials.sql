-- VOID expenses must not count as spend, anywhere (public UAT 2026-09-08).
--
-- The dashboard counterpart was corrected first: computeDashboardKpis() now counts every NON-VOID
-- expense, because every expense created through the web form lands as `pending` (status `recorded`
-- additionally requires a journal_entry_id -- see the expenses_check constraint), and excluding
-- pending made the Dashboard's Expenses card read R0 while the Operating position on the same
-- screen used the real total.
--
-- That left the mirror-image inconsistency on the database side: these three functions apply NO
-- status filter at all, so they count a VOIDED expense as money spent. A void expense is money NOT
-- spent; counting it overstates operating cost, understates net position, and inflates budget
-- actuals. With the dashboard excluding void and the RPCs including it, the two authoritative
-- financial surfaces would diverge by exactly the voided amount.
--
-- Semantics fixed here, matching the application side exactly:
--   pending     -> counts (a real, incurred, not-yet-posted expense)
--   recorded    -> counts
--   reimbursed  -> counts (existing intended accounting semantics, unchanged)
--   void        -> DOES NOT COUNT
--
-- Nothing else changes: identical signatures, identical return columns, identical money CTEs,
-- identical has_org_role() guards. Each function is reproduced verbatim from its current
-- definition (owner_financial_summary from 168, owner_portfolio_financial_summary from 169,
-- budget_vs_actual from 164) with one added predicate, so this reviews as a one-line change per
-- function rather than a rewrite.
--
-- Additive and reversible: no table, column, or row is touched.

drop function if exists public.owner_financial_summary(uuid, date);
drop function if exists public.owner_portfolio_financial_summary(uuid, date);

create function public.owner_financial_summary(p_property_id uuid, p_month date)
returns table (
  rent_planned numeric,
  rent_collected numeric,
  rent_outstanding numeric,
  utilities_expense numeric,
  water_expense numeric,
  electricity_expense numeric,
  rates_and_levies_expense numeric,
  rates_taxes_expense numeric,
  levies_expense numeric,
  other_expenses numeric,
  total_expenses numeric,
  awaiting_confirmation_count integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.properties where id = p_property_id;
  if v_org_id is null then
    raise exception 'Property not found';
  end if;
  if not public.has_org_role(v_org_id, 'viewer') then
    raise exception 'Caller does not have access to this organization''s financial summary';
  end if;

  return query
  with month_bounds as (
    select
      date_trunc('month', p_month)::date as month_start,
      (date_trunc('month', p_month) + interval '1 month')::date as month_end
  ),
  schedules as (
    select rs.id, rs.lease_id, rs.due_date, rs.amount
    from public.rent_schedules rs
    join public.leases l on l.id = rs.lease_id
    join public.units u on u.id = l.unit_id
    cross join month_bounds mb
    where u.property_id = p_property_id
      and rs.due_date >= mb.month_start
      and rs.due_date < mb.month_end
  ),
  collected as (
    select coalesce(sum(ip.amount), 0) as total
    from public.invoice_payments ip
    join public.invoices i on i.id = ip.invoice_id
    join schedules rs on rs.lease_id = i.lease_id and rs.due_date = i.period
    where ip.reversed_at is null
  ),
  expenses_scope as (
    select e.category_code, e.amount
    from public.expenses e
    cross join month_bounds mb
    where e.property_id = p_property_id
      and e.status <> 'void'
      and e.invoice_date is not null
      and e.invoice_date >= mb.month_start
      and e.invoice_date < mb.month_end
  ),
  expense_totals as (
    select
      coalesce(sum(amount) filter (where category_code = 'water'), 0) as water,
      coalesce(sum(amount) filter (where category_code = 'electricity'), 0) as electricity,
      coalesce(sum(amount) filter (where category_code = 'rates_taxes'), 0) as rates_taxes,
      coalesce(sum(amount) filter (where category_code = 'levies'), 0) as levies,
      coalesce(sum(amount) filter (
        where category_code not in ('water', 'electricity', 'rates_taxes', 'levies')
      ), 0) as other,
      coalesce(sum(amount), 0) as total
    from expenses_scope
  ),
  awaiting as (
    select count(*) as cnt
    from public.payment_reports pr
    cross join month_bounds mb
    where pr.property_id = p_property_id
      and pr.status = 'reported'
      and pr.payment_date >= mb.month_start
      and pr.payment_date < mb.month_end
  )
  select
    coalesce((select sum(amount) from schedules), 0),
    (select total from collected),
    coalesce((select sum(amount) from schedules), 0) - (select total from collected),
    (select water from expense_totals) + (select electricity from expense_totals),
    (select water from expense_totals),
    (select electricity from expense_totals),
    (select rates_taxes from expense_totals) + (select levies from expense_totals),
    (select rates_taxes from expense_totals),
    (select levies from expense_totals),
    (select other from expense_totals),
    (select total from expense_totals),
    (select cnt from awaiting)::integer;
end;
$$;

create function public.owner_portfolio_financial_summary(p_org_id uuid, p_month date)
returns table (
  rent_planned numeric,
  rent_collected numeric,
  rent_outstanding numeric,
  utilities_expense numeric,
  water_expense numeric,
  electricity_expense numeric,
  rates_and_levies_expense numeric,
  rates_taxes_expense numeric,
  levies_expense numeric,
  other_expenses numeric,
  total_expenses numeric,
  budget_planned numeric,
  budget_actual numeric,
  budget_remaining numeric,
  budget_used_percent numeric,
  net_operating_position numeric,
  awaiting_confirmation_count integer,
  property_count integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result record;
begin
  if not public.has_org_role(p_org_id, 'viewer') then
    raise exception 'Caller does not have access to this organization''s financial summary';
  end if;

  with month_bounds as (
    select
      date_trunc('month', p_month)::date as month_start,
      (date_trunc('month', p_month) + interval '1 month')::date as month_end
  ),
  org_properties as (
    select id from public.properties where org_id = p_org_id
  ),
  -- Archived properties keep contributing to the MONEY figures below (rent and expenses that
  -- really happened before archival must not vanish from a month's totals), but they must not
  -- inflate the portfolio COUNT -- see property_count at the end of this query.
  active_org_properties as (
    select id from public.properties where org_id = p_org_id and status <> 'archived'
  ),
  schedules as (
    select rs.id, rs.lease_id, rs.due_date, rs.amount
    from public.rent_schedules rs
    join public.leases l on l.id = rs.lease_id
    join public.units u on u.id = l.unit_id
    cross join month_bounds mb
    where u.property_id in (select id from org_properties)
      and rs.due_date >= mb.month_start
      and rs.due_date < mb.month_end
  ),
  collected as (
    select coalesce(sum(ip.amount), 0) as total
    from public.invoice_payments ip
    join public.invoices i on i.id = ip.invoice_id
    join schedules rs on rs.lease_id = i.lease_id and rs.due_date = i.period
    where ip.reversed_at is null
  ),
  expenses_scope as (
    select e.category_code, e.amount
    from public.expenses e
    cross join month_bounds mb
    where e.property_id in (select id from org_properties)
      and e.status <> 'void'
      and e.invoice_date is not null
      and e.invoice_date >= mb.month_start
      and e.invoice_date < mb.month_end
  ),
  expense_totals as (
    select
      coalesce(sum(amount) filter (where category_code = 'water'), 0) as water,
      coalesce(sum(amount) filter (where category_code = 'electricity'), 0) as electricity,
      coalesce(sum(amount) filter (where category_code = 'rates_taxes'), 0) as rates_taxes,
      coalesce(sum(amount) filter (where category_code = 'levies'), 0) as levies,
      coalesce(sum(amount) filter (
        where category_code not in ('water', 'electricity', 'rates_taxes', 'levies')
      ), 0) as other,
      coalesce(sum(amount), 0) as total
    from expenses_scope
  ),
  budgets as (
    select coalesce(sum(pb.planned_amount), 0) as total
    from public.property_budgets pb
    cross join month_bounds mb
    where pb.property_id in (select id from org_properties)
      and pb.month = mb.month_start
  ),
  awaiting as (
    select count(*) as cnt
    from public.payment_reports pr
    cross join month_bounds mb
    where pr.property_id in (select id from org_properties)
      and pr.status = 'reported'
      and pr.payment_date >= mb.month_start
      and pr.payment_date < mb.month_end
  )
  select
    coalesce((select sum(amount) from schedules), 0) as rent_planned,
    (select total from collected) as rent_collected,
    coalesce((select sum(amount) from schedules), 0) - (select total from collected) as rent_outstanding,
    (select water from expense_totals) + (select electricity from expense_totals) as utilities_expense,
    (select water from expense_totals) as water_expense,
    (select electricity from expense_totals) as electricity_expense,
    (select rates_taxes from expense_totals) + (select levies from expense_totals) as rates_and_levies_expense,
    (select rates_taxes from expense_totals) as rates_taxes_expense,
    (select levies from expense_totals) as levies_expense,
    (select other from expense_totals) as other_expenses,
    (select total from expense_totals) as total_expenses,
    (select total from budgets) as budget_planned,
    (select total from expense_totals) as budget_actual,
    (select total from budgets) - (select total from expense_totals) as budget_remaining,
    case
      when (select total from budgets) = 0 then null
      else round(((select total from expense_totals) / (select total from budgets)) * 100, 1)
    end as budget_used_percent,
    (select total from collected) - (select total from expense_totals) as net_operating_position,
    (select cnt from awaiting)::integer as awaiting_confirmation_count,
    (select count(*) from active_org_properties)::integer as property_count
  into v_result;

  return query select
    v_result.rent_planned, v_result.rent_collected, v_result.rent_outstanding,
    v_result.utilities_expense, v_result.water_expense, v_result.electricity_expense,
    v_result.rates_and_levies_expense, v_result.rates_taxes_expense, v_result.levies_expense,
    v_result.other_expenses, v_result.total_expenses,
    v_result.budget_planned, v_result.budget_actual, v_result.budget_remaining, v_result.budget_used_percent,
    v_result.net_operating_position, v_result.awaiting_confirmation_count, v_result.property_count;
end;
$$;

create or replace function public.budget_vs_actual(p_property_id uuid, p_month date)
returns table (
  budget_id uuid,
  planned_amount numeric,
  actual_amount numeric,
  remaining_amount numeric,
  variance_amount numeric,
  percent_used numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.properties where id = p_property_id;
  if v_org_id is null then
    raise exception 'Property not found';
  end if;
  if not public.has_org_role(v_org_id, 'viewer') then
    raise exception 'Caller does not have access to this organization''s budget';
  end if;

  return query
  with normalized as (
    select date_trunc('month', p_month)::date as month_start
  ),
  budget as (
    select pb.id, pb.planned_amount
    from public.property_budgets pb, normalized n
    where pb.property_id = p_property_id and pb.month = n.month_start
  ),
  actual as (
    select coalesce(sum(e.amount), 0) as total
    from public.expenses e, normalized n
    where e.property_id = p_property_id
      and e.status <> 'void'
      and date_trunc('month', e.invoice_date)::date = n.month_start
  )
  select
    b.id,
    b.planned_amount,
    a.total,
    b.planned_amount - a.total,
    a.total - b.planned_amount,
    case when b.planned_amount = 0 then null else round((a.total / b.planned_amount) * 100, 1) end
  from budget b, actual a;
end;
$$;
