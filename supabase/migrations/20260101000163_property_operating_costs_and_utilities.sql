-- V1 utilities/rates/levies pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md, WORKLOG.md this date).
-- Reuses the org-role RLS shape already established by expenses/levy_statements/owner_statements
-- (has_org_role(org_id, 'viewer') to read, has_org_role(org_id, 'accountant') to write) rather than
-- property_access -- consistent with every other financial/accounting table in this schema.
--
-- Four independent, additive concepts:
--   1. recurring_property_costs -- effective-dated rates/taxes and levy CONFIGURATION (the
--      recurring expected monthly amount), property OR unit scoped. This is planning data, not a
--      transaction -- it never itself posts to accounting. Turning "R1,500/month rates is
--      configured" into an actual expenses row for a given month is a separate, explicit action
--      (deliberately not automated in this migration -- see this file's own comment on
--      generate_expected_operating_costs() below for why).
--   2. utility_responsibility_settings -- who is financially responsible for water/electricity,
--      property OR unit scoped. Decoupled from utility_meters (below) because responsibility is
--      meaningful even when no meter is tracked (TENANT_PAID_DIRECT, TENANT_PREPAID,
--      INCLUDED_IN_RENT need no owner-tracked meter at all).
--   3. utility_meters -- an optional physical/measurement record, only needed when consumption is
--      actually tracked (typically OWNER_PAID or COMMON_AREA_OWNER).
--   4. utility_readings -- historical, append-only readings against a meter. Never overwritten;
--      corrections are new rows, per this migration's own comment on that table.
--
-- Explicitly OUT OF SCOPE (documented, not silently skipped): shared-meter tenant allocation
-- formulas, automated tariff/municipal-account scraping, meter reset/rollover handling (a reading
-- lower than the previous one is accepted as-is, not rejected -- see utility_readings comment).

-- ============================================================
-- 1. recurring_property_costs
-- ============================================================

create type public.recurring_cost_type as enum ('rates_and_taxes', 'levy');

create table public.recurring_property_costs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Scope: null unit_id = property-level (whole-building ownership); non-null = unit-level
  -- (sectional-title). Never both required, matching §1D's "never require both simultaneously"
  -- rule for meters -- the same scope rule applies here.
  unit_id uuid references public.units(id) on delete cascade,
  cost_type public.recurring_cost_type not null,
  amount numeric(12, 2) not null check (amount >= 0),
  -- Effective dating: a rate increase is a NEW row with a later effective_from, never an update to
  -- the old row's amount -- so a past period's expected-cost figure never silently changes.
  -- effective_to is null while the row is the current one; superseded rows get effective_to set to
  -- the day before the new row's effective_from (enforced by set_recurring_cost_effective_to()
  -- below, not left to the caller to get right).
  effective_from date not null,
  effective_to date,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index recurring_property_costs_org_idx on public.recurring_property_costs (org_id);
create index recurring_property_costs_property_idx on public.recurring_property_costs (property_id);
create index recurring_property_costs_unit_idx on public.recurring_property_costs (unit_id) where unit_id is not null;
-- At most one CURRENT (effective_to is null) row per scope+cost_type -- this is what makes "the
-- current expected amount" an unambiguous lookup rather than a query that has to reason about
-- overlapping date ranges.
create unique index recurring_property_costs_current_property_idx
  on public.recurring_property_costs (property_id, cost_type)
  where unit_id is null and effective_to is null;
create unique index recurring_property_costs_current_unit_idx
  on public.recurring_property_costs (unit_id, cost_type)
  where unit_id is not null and effective_to is null;

alter table public.recurring_property_costs enable row level security;

create policy "recurring_property_costs_select_org_member"
  on public.recurring_property_costs for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "recurring_property_costs_write_accountant_plus"
  on public.recurring_property_costs for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

-- unit_id, when set, must actually belong to property_id -- a plain CHECK can't do a cross-table
-- lookup, so this is a trigger, matching how this codebase already validates cross-table scope
-- elsewhere (e.g. caller_is_tenant_of_lease() being used inside RLS predicates for the same kind of
-- "this child actually belongs to that parent" check, just enforced here at write-time instead).
create or replace function public.validate_recurring_cost_unit_property()
returns trigger
language plpgsql
as $$
begin
  if new.unit_id is not null then
    if not exists (
      select 1 from public.units u where u.id = new.unit_id and u.property_id = new.property_id
    ) then
      raise exception 'unit_id does not belong to property_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_recurring_cost_unit_property_trigger
  before insert or update on public.recurring_property_costs
  for each row execute function public.validate_recurring_cost_unit_property();

create trigger set_recurring_property_costs_updated_at
  before update on public.recurring_property_costs
  for each row execute function public.set_updated_at();

-- set_recurring_property_cost(): the one write entry point for setting/replacing the CURRENT
-- expected amount for a scope+cost_type. Closes out the previous current row (effective_to =
-- p_effective_from - 1) and inserts the new one, in a single transaction, so a caller can never
-- leave two "current" rows overlapping (which the partial unique indexes above would reject
-- anyway, but this gives a clean error path instead of a raw constraint violation). Passing
-- p_amount = null retires the cost entirely (e.g. levy stopped applying) without leaving a bogus
-- zero-amount row -- matches §1B's explicit "never force a bogus zero/placeholder amount" rule.
create or replace function public.set_recurring_property_cost(
  p_org_id uuid,
  p_property_id uuid,
  p_unit_id uuid,
  p_cost_type public.recurring_cost_type,
  p_amount numeric,
  p_effective_from date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
  v_current_id uuid;
begin
  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if p_unit_id is not null and not exists (
    select 1 from public.units u where u.id = p_unit_id and u.property_id = p_property_id
  ) then
    raise exception 'unit_id does not belong to property_id';
  end if;

  select id into v_current_id
  from public.recurring_property_costs
  where property_id = p_property_id
    and cost_type = p_cost_type
    and effective_to is null
    and ((p_unit_id is null and unit_id is null) or (unit_id = p_unit_id));

  if v_current_id is not null then
    update public.recurring_property_costs
    set effective_to = p_effective_from - 1
    where id = v_current_id;
  end if;

  if p_amount is null then
    -- Retiring the cost -- no new row, the scope now has no current recurring_property_costs row
    -- for this cost_type, which set_recurring_property_costs_summary() below treats as "not
    -- applicable", not zero.
    return null;
  end if;

  insert into public.recurring_property_costs
    (org_id, property_id, unit_id, cost_type, amount, effective_from, notes, created_by)
  values (p_org_id, p_property_id, p_unit_id, p_cost_type, p_amount, p_effective_from, p_notes, auth.uid())
  returning id into v_new_id;

  perform public.write_lifecycle_audit_event(
    p_org_id, 'user', auth.uid(), 'recurring_property_cost.set', 'recurring_property_costs', v_new_id,
    jsonb_build_object('costType', p_cost_type, 'amount', p_amount, 'effectiveFrom', p_effective_from)
  );

  return v_new_id;
end;
$$;

comment on function public.set_recurring_property_cost(uuid, uuid, uuid, public.recurring_cost_type, numeric, date, text) is
  'Sets the current expected monthly rates/taxes or levy amount for a property or unit, closing out
   the previous current row (effective dating -- never overwrites history). p_amount = null retires
   the cost (never a bogus zero row). This is CONFIGURATION only -- it never posts to expenses.';

-- ============================================================
-- 2. utility_responsibility_settings
-- ============================================================

create type public.utility_type as enum ('water', 'electricity');

-- Naming deliberately follows this codebase's existing enum-label style (snake_case, not the
-- SCREAMING_CASE the audit's own §1C example used) -- e.g. payment_report_status's
-- 'reported'/'confirmed'/'rejected'.
create type public.utility_responsibility_mode as enum (
  'owner_paid',
  'tenant_paid_direct',
  'tenant_prepaid',
  'included_in_rent',
  'common_area_owner'
);

create table public.utility_responsibility_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- null unit_id = property-level (required for common_area_owner; also used for whole-building
  -- water/electricity that isn't unit-metered at all).
  unit_id uuid references public.units(id) on delete cascade,
  utility_type public.utility_type not null,
  responsibility_mode public.utility_responsibility_mode not null,
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- common_area_owner is inherently property-level (communal gardens/pumps/passages, §1C) -- a
  -- unit can't be "the common area".
  check (responsibility_mode <> 'common_area_owner' or unit_id is null)
);

create index utility_responsibility_settings_org_idx on public.utility_responsibility_settings (org_id);
create index utility_responsibility_settings_property_idx on public.utility_responsibility_settings (property_id);
-- One active setting per scope+utility_type -- matches recurring_property_costs' "one current row"
-- shape, but responsibility mode is a live toggle (not effective-dated history) since §1C never
-- asked for historical responsibility tracking, only for cost effective-dating.
create unique index utility_responsibility_settings_property_idx_unique
  on public.utility_responsibility_settings (property_id, utility_type)
  where unit_id is null and active;
create unique index utility_responsibility_settings_unit_idx_unique
  on public.utility_responsibility_settings (unit_id, utility_type)
  where unit_id is not null and active;

alter table public.utility_responsibility_settings enable row level security;

create policy "utility_responsibility_settings_select_org_member"
  on public.utility_responsibility_settings for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "utility_responsibility_settings_write_accountant_plus"
  on public.utility_responsibility_settings for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

create trigger validate_utility_responsibility_unit_property_trigger
  before insert or update on public.utility_responsibility_settings
  for each row execute function public.validate_recurring_cost_unit_property();

create trigger set_utility_responsibility_settings_updated_at
  before update on public.utility_responsibility_settings
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. utility_meters
-- ============================================================

create table public.utility_meters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- null = property-level meter (typically common-area); non-null = a specific unit's own meter.
  unit_id uuid references public.units(id) on delete cascade,
  utility_type public.utility_type not null,
  meter_number text check (meter_number is null or char_length(meter_number) <= 100),
  -- Denormalized copy of the current responsibility_mode at meter-creation time, per §1D's own
  -- field list ("responsibility mode" is named as a required meter column). Query convenience only
  -- -- utility_responsibility_settings (above) remains the authoritative, editable setting; this
  -- column is not kept in sync automatically if responsibility later changes, since a meter's
  -- physical existence and who currently pays for it are genuinely different facts that can drift
  -- (e.g. a unit is re-let under a new lease with different responsibility terms).
  responsibility_mode public.utility_responsibility_mode not null,
  is_prepaid boolean not null default false,
  active boolean not null default true,
  installed_date date,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index utility_meters_org_idx on public.utility_meters (org_id);
create index utility_meters_property_idx on public.utility_meters (property_id);
create index utility_meters_unit_idx on public.utility_meters (unit_id) where unit_id is not null;

alter table public.utility_meters enable row level security;

create policy "utility_meters_select_org_member"
  on public.utility_meters for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "utility_meters_write_accountant_plus"
  on public.utility_meters for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

create trigger validate_utility_meter_unit_property_trigger
  before insert or update on public.utility_meters
  for each row execute function public.validate_recurring_cost_unit_property();

create trigger set_utility_meters_updated_at
  before update on public.utility_meters
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. utility_readings
-- ============================================================

create type public.utility_reading_source as enum ('actual', 'estimated', 'manual');

create table public.utility_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  meter_id uuid not null references public.utility_meters(id) on delete cascade,
  -- First-of-month convention, matching this codebase's existing rent_schedules.due_date/
  -- invoices.period style of using a plain date to key a billing period.
  period_month date not null,
  reading_date date not null,
  reading_value numeric(12, 2) not null check (reading_value >= 0),
  -- Stored, not purely derived -- §1E's own instruction: "prioritize auditability and historical
  -- correctness" over avoiding a redundant column. Computed by record_utility_reading() below from
  -- the previous reading for the same meter; never recomputed retroactively if an earlier reading
  -- is later corrected (a correction is a new row for its own period, per this migration's header
  -- comment -- it does not rewrite consumption on rows that came after it).
  consumption numeric(12, 2),
  unit_of_measure text not null check (unit_of_measure in ('L', 'kWh')),
  source public.utility_reading_source not null default 'manual',
  recorded_by uuid references auth.users(id) on delete set null,
  document_id uuid references public.documents(id),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  -- One reading per meter per billing period -- §1E's explicit duplicate-prevention rule. A
  -- genuine correction replaces nothing (this table is append-only, per the header comment) --
  -- correcting a period's reading is therefore only possible via record_utility_reading()'s own
  -- p_replace_period_month path (below), which deletes-and-reinserts inside one transaction rather
  -- than ever running a bare UPDATE on a historical reading.
  unique (meter_id, period_month)
);

create index utility_readings_org_idx on public.utility_readings (org_id);
create index utility_readings_meter_period_idx on public.utility_readings (meter_id, period_month desc);

alter table public.utility_readings enable row level security;

create policy "utility_readings_select_org_member"
  on public.utility_readings for select
  using (public.has_org_role(org_id, 'viewer'));

-- No blanket UPDATE/DELETE policy -- readings are corrected only via
-- record_utility_reading()'s replace path (SECURITY DEFINER), same immutability posture
-- invoice_payments takes (reversal-only, no direct UPDATE policy).
create policy "utility_readings_insert_accountant_plus"
  on public.utility_readings for insert
  with check (public.has_org_role(org_id, 'accountant'));

create policy "utility_readings_delete_accountant_plus_replace_only"
  on public.utility_readings for delete
  using (public.has_org_role(org_id, 'accountant'));

-- record_utility_reading(): the one write entry point. Computes consumption from the immediately
-- preceding period's reading for the same meter (never trusts a client-supplied consumption
-- figure). A current reading lower than the previous one is ACCEPTED, not rejected -- meter
-- reset/rollover handling is explicitly deferred (§1E: "document it as future scope rather than
-- implementing unsafe assumptions") -- consumption is simply stored as the (possibly negative) raw
-- difference, and callers/UI should treat a negative consumption value as a data-quality signal to
-- show, not something the database silently "corrects".
create or replace function public.record_utility_reading(
  p_meter_id uuid,
  p_period_month date,
  p_reading_date date,
  p_reading_value numeric,
  p_unit_of_measure text,
  p_source public.utility_reading_source default 'manual',
  p_document_id uuid default null,
  p_notes text default null,
  -- When true, an existing row for this meter+period is deleted and replaced instead of raising a
  -- duplicate-period error -- the one sanctioned correction path (§1E: "never overwrite historical
  -- readings when a newer reading arrives" refers to READINGS FOR LATER PERIODS, not a same-period
  -- correction, which this flag exists for).
  p_replace_existing boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meter public.utility_meters%rowtype;
  v_previous_value numeric(12, 2);
  v_consumption numeric(12, 2);
  v_reading_id uuid;
begin
  select * into v_meter from public.utility_meters where id = p_meter_id;
  if not found then
    raise exception 'Meter not found';
  end if;
  if not public.has_org_role(v_meter.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if p_reading_value < 0 then
    raise exception 'Reading value cannot be negative';
  end if;
  if v_meter.utility_type = 'water' and p_unit_of_measure <> 'L' then
    raise exception 'Water readings must be recorded in litres (L)';
  end if;
  if v_meter.utility_type = 'electricity' and p_unit_of_measure <> 'kWh' then
    raise exception 'Electricity readings must be recorded in kWh';
  end if;

  if p_replace_existing then
    delete from public.utility_readings where meter_id = p_meter_id and period_month = p_period_month;
  elsif exists (select 1 from public.utility_readings where meter_id = p_meter_id and period_month = p_period_month) then
    raise exception 'A reading already exists for this meter and period -- use p_replace_existing to correct it';
  end if;

  select reading_value into v_previous_value
  from public.utility_readings
  where meter_id = p_meter_id and period_month < p_period_month
  order by period_month desc
  limit 1;

  v_consumption := case when v_previous_value is null then null else p_reading_value - v_previous_value end;

  insert into public.utility_readings
    (org_id, meter_id, period_month, reading_date, reading_value, consumption, unit_of_measure, source, recorded_by, document_id, notes)
  values
    (v_meter.org_id, p_meter_id, p_period_month, p_reading_date, p_reading_value, v_consumption, p_unit_of_measure, p_source, auth.uid(), p_document_id, p_notes)
  returning id into v_reading_id;

  perform public.write_lifecycle_audit_event(
    v_meter.org_id, 'user', auth.uid(), 'utility_reading.recorded', 'utility_readings', v_reading_id,
    jsonb_build_object('meterId', p_meter_id, 'periodMonth', p_period_month, 'readingValue', p_reading_value, 'consumption', v_consumption)
  );

  return v_reading_id;
end;
$$;

comment on function public.record_utility_reading(uuid, date, date, numeric, text, public.utility_reading_source, uuid, text, boolean) is
  'The one write entry point for utility_readings. Computes consumption from the prior period''s
   reading server-side (never trusts a client-supplied value). Meter reset/rollover is NOT handled
   -- a lower-than-previous reading is stored as-is (a negative consumption value), deferred to
   future scope per the V1 gap audit rather than guessing a reset heuristic.';
