-- Web financials V1 pass, part 2 (WORKLOG.md this date): the previous pass's own final report
-- disclosed that `owner_financial_summary()`/`owner_portfolio_financial_summary()` (migrations
-- 166/167) bucket expenses via case-insensitive free-text matching on `expenses.category` --
-- reliable only when someone happens to type one of a fixed list of strings, and unable to
-- distinguish "rates & taxes" from "levies" (both matched into one combined
-- `rates_and_levies_expense`). This migration introduces a real, DB-enforced canonical
-- classification, independent of whatever free text a user types, and re-derives both RPCs from it.
--
-- Design: `expenses.category` remains exactly what it always was -- a free-text, human-readable
-- label (NOT NULL, unchanged, no existing row touched). A NEW, separate `category_code` column
-- (a real Postgres enum, so an unrecognised value is rejected by the type system itself, not just
-- application code) becomes the one and only thing financial bucketing ever reads -- never a
-- string-equality/ILIKE match against `category` or `notes` again. Additive only: new enum type,
-- new nullable-then-backfilled column, a `BEFORE INSERT OR UPDATE` trigger that infers a code from
-- the free-text category ONLY when the caller didn't supply one explicitly (so every existing row,
-- and every future INSERT from a caller that hasn't been updated yet -- e.g. this migration's own
-- pre-existing pgTAP fixtures, which insert only `category` -- keeps working exactly as before,
-- while the updated web expense-entry form now supplies category_code explicitly going forward).
-- Local/test migration only -- not applied to any production database by this session.

create type public.expense_category_code as enum (
  'rates_taxes',
  'levies',
  'water',
  'electricity',
  'maintenance',
  'security',
  'insurance',
  'cleaning',
  'management',
  'other'
);

-- Deliberately covers exactly the same free-text strings the two RPCs' own (now-removed) matching
-- CTEs used for water/electricity/rates/levies, split so "rates" and "levy/levies" land in their
-- own distinct codes instead of one combined bucket -- plus a few unambiguous, single-word matches
-- for the other five categories. Anything not recognised falls to 'other', same as the old
-- free-text matching's own fallback -- never silently mis-classified as something specific.
create or replace function public.infer_expense_category_code(p_category text)
returns public.expense_category_code
language sql
immutable
as $$
  select case lower(trim(p_category))
    when 'water' then 'water'::public.expense_category_code
    when 'electricity' then 'electricity'::public.expense_category_code
    when 'power' then 'electricity'::public.expense_category_code
    when 'rates_and_taxes' then 'rates_taxes'::public.expense_category_code
    when 'rates and taxes' then 'rates_taxes'::public.expense_category_code
    when 'rates & taxes' then 'rates_taxes'::public.expense_category_code
    when 'rates' then 'rates_taxes'::public.expense_category_code
    when 'municipal rates' then 'rates_taxes'::public.expense_category_code
    when 'levy' then 'levies'::public.expense_category_code
    when 'levies' then 'levies'::public.expense_category_code
    when 'maintenance' then 'maintenance'::public.expense_category_code
    when 'security' then 'security'::public.expense_category_code
    when 'insurance' then 'insurance'::public.expense_category_code
    when 'cleaning' then 'cleaning'::public.expense_category_code
    when 'management' then 'management'::public.expense_category_code
    when 'management fee' then 'management'::public.expense_category_code
    else 'other'::public.expense_category_code
  end
$$;

comment on function public.infer_expense_category_code(text) is
  'Best-effort mapping from a free-text expenses.category label to a canonical
   expense_category_code, used ONLY as a fallback (see expenses_infer_category_code trigger) when a
   caller inserts/updates a row without explicitly setting category_code -- e.g. the pre-existing
   pgTAP fixtures and any not-yet-updated caller. Never used by the financial-summary RPCs
   themselves, which read category_code directly.';

alter table public.expenses add column category_code public.expense_category_code;

create or replace function public.set_expense_category_code_default()
returns trigger
language plpgsql
as $$
begin
  if new.category_code is null then
    new.category_code := public.infer_expense_category_code(new.category);
  end if;
  return new;
end;
$$;

create trigger expenses_infer_category_code
  before insert or update on public.expenses
  for each row execute function public.set_expense_category_code_default();

comment on trigger expenses_infer_category_code on public.expenses is
  'Populates category_code from the free-text category label whenever a caller does not supply one
   explicitly -- never overwrites an explicitly-set category_code. Keeps every pre-existing insert
   path (including the pgTAP fixtures in supabase/tests/) working unchanged while the updated web
   expense form now sets category_code directly from its canonical dropdown.';

-- Backfill every existing row (there is no other way to populate category_code for rows that
-- predate this migration -- the trigger only fires on a future insert/update).
update public.expenses set category_code = public.infer_expense_category_code(category)
where category_code is null;

alter table public.expenses alter column category_code set not null;

comment on column public.expenses.category_code is
  'Canonical expense classification (rates_taxes/levies/water/electricity/maintenance/security/
   insurance/cleaning/management/other) -- the ONLY field owner_financial_summary()/
   owner_portfolio_financial_summary() read to bucket an expense. Independent of the free-text
   category label: two rows can share the same category_code with completely different category
   text, and changing category text alone never changes category_code (see
   expenses_infer_category_code trigger -- it only fills a NULL category_code, never overwrites an
   explicit one).';

-- ============================================================
-- Re-derive owner_financial_summary()/owner_portfolio_financial_summary() from category_code.
-- RETURNS TABLE column lists are being extended (4 new columns each: water_expense,
-- electricity_expense, rates_taxes_expense, levies_expense) -- Postgres does not allow
-- CREATE OR REPLACE to change a function's return type, including adding table-returning columns,
-- so both are explicitly dropped and recreated. The pre-existing utilities_expense/
-- rates_and_levies_expense/other_expenses/total_expenses columns are KEPT, with unchanged meaning
-- (utilities_expense = water + electricity; rates_and_levies_expense = rates_taxes + levies) --
-- every existing caller reading those specific named fields (both API routes, both existing pgTAP
-- test files, Android's FinancialSummaryDto) continues to work unchanged. New callers read the four
-- new split fields directly.
-- ============================================================

drop function if exists public.owner_financial_summary(uuid, date);

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

comment on function public.owner_financial_summary(uuid, date) is
  'Server-authoritative one-call owner financial summary for one property+month: rent
   planned/collected/outstanding (rent_schedules + invoice_payments), and expenses bucketed by
   expenses.category_code (never free-text category matching) into water/electricity (+ their
   utilities_expense sum) and rates_taxes/levies (+ their rates_and_levies_expense sum), plus other
   and total. Android Home and the web Reports page both call this instead of composing the same
   figures from several independent queries.';

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
    (select count(*) from org_properties)::integer as property_count
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
   operating position, and payments awaiting confirmation. Requires has_org_role(org_id, ''viewer'').';
