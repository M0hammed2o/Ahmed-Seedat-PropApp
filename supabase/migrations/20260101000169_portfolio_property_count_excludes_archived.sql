-- V1 release-gate UAT pass: owner_portfolio_financial_summary().property_count counted EVERY
-- property in the org, including archived ones, while GET /api/v1/properties (and every listing UI
-- built on it) shows active properties only. An owner who archived a property therefore saw a
-- Dashboard reading "11 properties" beside a Properties screen listing 10 -- a plain contradiction
-- between two screens of the same app, and exactly the sort of inconsistency that ruins a demo take.
--
-- Found when the demo seed archived a renamed property and the two counts then disagreed
-- (10 active vs 11 reported).
--
-- Deliberately narrow: only the COUNT changes. The money CTEs still span every property in the org,
-- because rent collected and expenses incurred before a property was archived genuinely happened and
-- must not disappear from that month's totals. A new active_org_properties CTE feeds property_count
-- alone; org_properties continues to feed every financial aggregate unchanged.
--
-- Local/test migration only -- not applied to any production database by this session.

drop function if exists public.owner_portfolio_financial_summary(uuid, date);

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

comment on function public.owner_portfolio_financial_summary(uuid, date) is
  'Server-authoritative, LIVE portfolio-wide owner financial summary for one org+month -- rent
   planned/collected/outstanding, expenses bucketed by expenses.category_code into
   water/electricity/rates_taxes/levies (+ their utilities_expense/rates_and_levies_expense sums,
   kept for backward compatibility) plus other/total, budget planned/actual/remaining/% used, net
   operating position, and payments awaiting confirmation. property_count reflects NON-ARCHIVED
   properties only, matching what the Properties list shows; the financial aggregates still span
   every property so pre-archival activity is not erased. Requires has_org_role(org_id, ''viewer'').';
