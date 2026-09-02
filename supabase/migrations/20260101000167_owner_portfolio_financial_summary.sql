-- Portfolio-wide owner financial summary (continuation pass, WORKLOG.md this date).
--
-- ARCHITECTURE DECISION, documented per the task's own instruction to record why:
--
-- owner_property_summaries (migration 20260101000107) was considered and REJECTED as the home for
-- this. It is a periodic SNAPSHOT -- getOrCreateOwnerMonthlySummary() (apps/admin/lib/
-- ownerSummary.ts) returns the EXISTING row for a given owner+period if one exists and never
-- recomputes it; a new row is only created once per owner per calendar month (on the owner's
-- preferred day, or the first time the summary is viewed that month). That is exactly right for
-- its actual job (a WhatsApp-dispatched monthly report that must read the same 20 minutes after
-- send as it did when sent), but wrong for a live Home screen an owner checks daily expecting
-- today's real numbers -- extending it with utilities/budget fields would just add more stale
-- figures alongside the already-stale rent figures Android's DashboardScreen currently reads from
-- it (OwnerSummaryRepository.getMySummaries()).
--
-- Chosen instead: a new, LIVE, server-authoritative aggregation (this migration), computed fresh on
-- every call -- the same posture owner_financial_summary()/budget_vs_actual() (migrations 164/166)
-- already established for a single property, generalized here to every property in an org the
-- caller has access to. DashboardViewModel is being switched to call this SAME function for the
-- rent figures too (not just the new expense/budget ones) -- this is a deliberate side effect, not
-- scope creep: it resolves the task's own "never mix client-side and server-side definitions of
-- monetary truth" instruction by giving Home exactly ONE live source for every figure on it,
-- and it fixes the pre-existing staleness of the rent hero card as a natural consequence.
-- owner_property_summaries/OwnerSummaryListScreen ("Monthly summary", reachable via More) are left
-- completely untouched -- they still serve their own distinct purpose (the WhatsApp report, and
-- maintenance/lease-expiry counts this function does not compute).

create or replace function public.owner_portfolio_financial_summary(p_org_id uuid, p_month date)
returns table (
  rent_planned numeric,
  rent_collected numeric,
  rent_outstanding numeric,
  utilities_expense numeric,
  rates_and_levies_expense numeric,
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
    select e.category, e.amount
    from public.expenses e
    cross join month_bounds mb
    where e.property_id in (select id from org_properties)
      and e.invoice_date is not null
      and e.invoice_date >= mb.month_start
      and e.invoice_date < mb.month_end
  ),
  expense_totals as (
    select
      coalesce(sum(amount) filter (
        where lower(category) in ('water', 'electricity', 'electricity ', 'power')
      ), 0) as utilities,
      coalesce(sum(amount) filter (
        where lower(category) in (
          'rates_and_taxes', 'rates and taxes', 'rates & taxes', 'rates', 'municipal rates',
          'levy', 'levies'
        )
      ), 0) as rates_levies,
      coalesce(sum(amount) filter (
        where lower(category) not in (
          'water', 'electricity', 'electricity ', 'power',
          'rates_and_taxes', 'rates and taxes', 'rates & taxes', 'rates', 'municipal rates',
          'levy', 'levies'
        )
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
    (select utilities from expense_totals) as utilities_expense,
    (select rates_levies from expense_totals) as rates_and_levies_expense,
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
    (select count(*) from org_properties)::integer as property_count
  into v_result;

  return query select
    v_result.rent_planned, v_result.rent_collected, v_result.rent_outstanding,
    v_result.utilities_expense, v_result.rates_and_levies_expense, v_result.other_expenses, v_result.total_expenses,
    v_result.budget_planned, v_result.budget_actual, v_result.budget_remaining, v_result.budget_used_percent,
    v_result.net_operating_position, v_result.awaiting_confirmation_count, v_result.property_count;
end;
$$;

comment on function public.owner_portfolio_financial_summary(uuid, date) is
  'Server-authoritative, LIVE (never cached/snapshotted) portfolio-wide owner financial summary for
   one org+month -- rent planned/collected/outstanding, expenses split into utilities/rates &
   levies/other, budget planned/actual/remaining/% used (summed across every property with a budget
   set for that month), net operating position (rent collected - total expenses -- never labelled
   "profit"), and the count of payments awaiting confirmation. Requires has_org_role(org_id,
   ''viewer''). Chosen over extending owner_property_summaries -- see this migration''s header
   comment for why.';

-- Budget-used-% here is a PORTFOLIO aggregate (total actual / total planned across every property
-- that has a budget set), not an average of each property's own %, matching how a single combined
-- "how much of my total budget have I used" figure is meant to read on Home -- a property with no
-- budget set for the month simply does not contribute to either side of that ratio, exactly like
-- budget_vs_actual()'s own "no rows = no budget set" semantics at the single-property level.
