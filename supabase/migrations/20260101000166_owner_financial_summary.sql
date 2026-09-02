-- Owner financial summary RPC (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §6, §16/§17's explicit
-- "avoid N+1" / "server-authoritative calculations" rules, WORKLOG.md this date).
--
-- ONE server-authoritative call for the figures Owner Home (Android) and the web Reports page both
-- need: rent planned/collected/outstanding (from rent_schedules + invoice_payments -- the same
-- authoritative sources §7's ledger fix now keeps in sync), and expenses split into
-- utilities/rates & levies/other (from `expenses` only -- never a second ledger).
--
-- Category matching is case-insensitive free-text matching, NOT an enum join -- `expenses.category`
-- is deliberately free text (20260101000037's own comment), and §2 of this pass explicitly says
-- "do not unnecessarily lock category values... provide a stable normalized mapping for financial
-- reporting" rather than forcing a schema change. The canonical suggested category strings
-- ('Water', 'Electricity', 'Rates and taxes', 'Levies') are what the web/Android expense forms will
-- offer going forward (see UTILITIES_RATES_BUDGET_IMPLEMENTATION.md) -- older freely-typed rows are
-- still matched via this list, documented here as a known V1 limitation: an expense typed with an
-- unrecognised category name lands in "other" rather than "utilities"/"rates & levies" until its
-- category is corrected or the mapping list below is extended.
create or replace function public.owner_financial_summary(p_property_id uuid, p_month date)
returns table (
  rent_planned numeric,
  rent_collected numeric,
  rent_outstanding numeric,
  utilities_expense numeric,
  rates_and_levies_expense numeric,
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
  -- SECURITY DEFINER bypasses RLS on every table this queries -- this check is what stands in for
  -- it. viewer is the same floor expenses_select_org_member/property_budgets_select_org_member
  -- already use for the underlying data this aggregates.
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
    select e.category, e.amount
    from public.expenses e
    cross join month_bounds mb
    where e.property_id = p_property_id
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
    (select utilities from expense_totals),
    (select rates_levies from expense_totals),
    (select other from expense_totals),
    (select total from expense_totals),
    (select cnt from awaiting)::integer;
end;
$$;

comment on function public.owner_financial_summary(uuid, date) is
  'Server-authoritative one-call owner financial summary for one property+month: rent
   planned/collected/outstanding (rent_schedules + invoice_payments, kept in sync by migration
   165''s ledger fix) and expenses split into utilities/rates & levies/other (expenses only, never a
   second ledger). Android Home and the web Reports page both call this instead of composing the
   same figures from several independent queries.';

-- ============================================================
-- Security correction: budget_vs_actual() (migration 20260101000164) is SECURITY DEFINER but had
-- no explicit authorization check of its own -- it bypasses RLS on property_budgets/expenses
-- entirely, so ANY authenticated caller could pass any property_id and read another organization's
-- budget and expense totals. Found and fixed in this same pass, before this migration set ever
-- ships, by adding the identical has_org_role(org_id, 'viewer') check owner_financial_summary()
-- above now has. Same signature, so this is a plain create-or-replace, not a new function.
-- ============================================================

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

comment on function public.budget_vs_actual(uuid, date) is
  'Server-authoritative budget-vs-actual for one property+month. Actual is summed from `expenses`
   only (the one authoritative expense ledger this pass reuses) -- never payment_reports, never a
   second financial record. Returns no rows if no budget is set for that property+month (distinct
   from a zero-planned-amount budget, which returns one row with percent_used = null). Requires
   has_org_role(org_id, ''viewer'') -- see this migration''s security-correction header comment.';
