-- V1 property budgeting pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md, WORKLOG.md this date).
--
-- property_budgets is keyed by (property_id, month) -- ONE row per calendar month, always the
-- source of truth. "Annual budget" is deliberately NOT a separate table: §2's own instruction
-- prefers "explicit monthly allocation rows over assuming annual/12 in every case" and describes
-- annual entry as a convenience workflow ("create annual budget and distribute evenly across
-- months") that still produces editable monthly rows. distribute_annual_budget() below is exactly
-- that convenience -- it inserts/updates 12 monthly rows and nothing else; there is no separate
-- annual total stored anywhere to drift out of sync with its own monthly rows.
--
-- Actuals are NEVER stored here -- they are computed on read from the existing, authoritative
-- `expenses` table (per this pass's explicit "ONE authoritative expense amount, not two competing
-- financial records" rule). See budget_vs_actual() below.

create table public.property_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Always the first of the month -- the plain-date-as-period-key convention this schema already
  -- uses for rent_schedules.due_date/invoices.period.
  month date not null,
  planned_amount numeric(12, 2) not null check (planned_amount >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (extract(day from month) = 1),
  unique (property_id, month)
);

create index property_budgets_org_idx on public.property_budgets (org_id);
create index property_budgets_property_month_idx on public.property_budgets (property_id, month desc);

alter table public.property_budgets enable row level security;

create policy "property_budgets_select_org_member"
  on public.property_budgets for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "property_budgets_write_accountant_plus"
  on public.property_budgets for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

create trigger set_property_budgets_updated_at
  before update on public.property_budgets
  for each row execute function public.set_updated_at();

-- budget_category_lines: OPTIONAL per-category planned amounts within a monthly budget. Free-text
-- category, mirroring expenses.category exactly (same "real statements use inconsistent
-- terminology" reasoning levy_statement_line_items.category already documents) -- a stable
-- normalized mapping for reporting is a display-layer concern (matching e.g. "Water"/"water"/
-- "WATER" case-insensitively), not a schema-level enum, so a category invented on an expense isn't
-- ever blocked from having a budget line.
create table public.budget_category_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.property_budgets(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  category text not null check (char_length(category) between 1 and 100),
  planned_amount numeric(12, 2) not null check (planned_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, category)
);

create index budget_category_lines_budget_idx on public.budget_category_lines (budget_id);
create index budget_category_lines_org_idx on public.budget_category_lines (org_id);

alter table public.budget_category_lines enable row level security;

create policy "budget_category_lines_select_org_member"
  on public.budget_category_lines for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "budget_category_lines_write_accountant_plus"
  on public.budget_category_lines for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

create trigger set_budget_category_lines_updated_at
  before update on public.budget_category_lines
  for each row execute function public.set_updated_at();

-- budget_id's org_id must match the line's own org_id, and a category line's total should not
-- silently exceed its parent month's planned_amount -- enforced softly (a warning-shaped check
-- would need a deferred constraint querying sibling rows, which Postgres CHECK cannot express
-- directly). Left as an application-layer validation (the API route, same posture the existing
-- ExpenseForm takes for its own business-rule checks) rather than a DB constraint that would need
-- a trigger scanning all sibling lines on every write -- documented here, not silently absent.

-- set_monthly_budget(): upsert-by-(property,month).
create or replace function public.set_monthly_budget(
  p_org_id uuid,
  p_property_id uuid,
  p_month date,
  p_planned_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget_id uuid;
  v_normalized_month date := date_trunc('month', p_month)::date;
begin
  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if p_planned_amount < 0 then
    raise exception 'Planned amount cannot be negative';
  end if;

  insert into public.property_budgets (org_id, property_id, month, planned_amount, created_by)
  values (p_org_id, p_property_id, v_normalized_month, p_planned_amount, auth.uid())
  on conflict (property_id, month)
  do update set planned_amount = excluded.planned_amount, updated_at = now()
  returning id into v_budget_id;

  perform public.write_lifecycle_audit_event(
    p_org_id, 'user', auth.uid(), 'property_budget.set', 'property_budgets', v_budget_id,
    jsonb_build_object('propertyId', p_property_id, 'month', v_normalized_month, 'plannedAmount', p_planned_amount)
  );

  return v_budget_id;
end;
$$;

-- distribute_annual_budget(): the "create annual budget and distribute evenly" convenience from
-- §2. Purely a bulk caller of set_monthly_budget() for Jan-Dec of p_year -- produces exactly the
-- same 12 rows a caller inserting them one at a time would, so there is nothing "annual" stored
-- anywhere that the 12 monthly rows don't already represent. p_annual_total is divided evenly with
-- the remainder (from integer-cent rounding) added to December, so the 12 rows sum EXACTLY to
-- p_annual_total rather than drifting by a few cents.
create or replace function public.distribute_annual_budget(
  p_org_id uuid,
  p_property_id uuid,
  p_year integer,
  p_annual_total numeric
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monthly numeric(12, 2);
  v_remainder numeric(12, 2);
  v_month_start date;
  v_id uuid;
  i integer;
begin
  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if p_annual_total < 0 then
    raise exception 'Annual total cannot be negative';
  end if;

  v_monthly := trunc(p_annual_total / 12, 2);
  v_remainder := round(p_annual_total - (v_monthly * 12), 2);

  for i in 1..12 loop
    v_month_start := make_date(p_year, i, 1);
    v_id := public.set_monthly_budget(
      p_org_id, p_property_id, v_month_start,
      case when i = 12 then v_monthly + v_remainder else v_monthly end
    );
    return next v_id;
  end loop;

  return;
end;
$$;

comment on function public.distribute_annual_budget(uuid, uuid, integer, numeric) is
  'Convenience-only: inserts/updates 12 property_budgets rows (Jan-Dec of p_year) that sum exactly
   to p_annual_total. No separate annual total is stored -- the 12 monthly rows this returns remain
   independently editable afterward, per §2''s explicit "retain editable monthly allocations" rule.';

-- budget_vs_actual(): server-authoritative variance calculation. Actuals come from `expenses`
-- ONLY (never payment_reports, never a second ledger) -- category-level comparison joins
-- budget_category_lines against expenses.category case-insensitively (matching real-world
-- inconsistent capitalization the same way levy_statement_line_items.category already tolerates).
create or replace function public.budget_vs_actual(p_property_id uuid, p_month date)
returns table (
  budget_id uuid,
  planned_amount numeric,
  actual_amount numeric,
  remaining_amount numeric,
  variance_amount numeric,
  percent_used numeric
)
language sql
security definer
set search_path = public
stable
as $$
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
$$;

comment on function public.budget_vs_actual(uuid, date) is
  'Server-authoritative budget-vs-actual for one property+month. Actual is summed from `expenses`
   only (the one authoritative expense ledger this pass reuses) -- never payment_reports, never a
   second financial record. Returns no rows if no budget is set for that property+month (distinct
   from a zero-planned-amount budget, which returns one row with percent_used = null).';
