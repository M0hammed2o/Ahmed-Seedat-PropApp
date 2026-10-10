-- Hybrid Water & Electricity Management, Phase 2 (docs/HYBRID_UTILITIES_ARCHITECTURE.md, 2026-10-10).
-- Additive only: no table or column is dropped, no existing row is rewritten except new defaults.
--
--   1. Supply sources (grid, Eskom, prepaid, solar, battery, generator, municipal/borehole/rain/tank/tanker water)
--      at property / building / unit scope; source level readings and operating logs.
--   2. Meter measurement kinds + supply-source links (energy/water balance without double counting).
--   3. Tariff engine v2 columns: kinds, seasons, TOU, VAT rate, unit-specific assignment, review flags; append-only
--      once used.
--   4. Billing arrangements, shared-meter allocation groups, move-in/out readings, charge types, VAT split,
--      disputes, adjustments, utility credits, immutable approved charges.
--   5. Utility statements (tenant / owner).
--   6. More alert rules. Tenant read access to their OWN invoiced charges and approved statements.
--
-- Rollback (local/test only): drop the new tables; drop the added columns; restore utility_tariffs_blocks check
-- (array of 1..10), utility_alerts_rule_check (migration 175 list), utility_charges_meter_period_idx, and
-- utility_charges.meter_id NOT NULL.

-- ============================================================
-- 1. Supply sources
-- ============================================================

create table public.utility_supply_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  building_id uuid references public.property_buildings(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  utility_type public.utility_type not null,
  source_type text not null,
  name text not null check (char_length(name) between 1 and 100),
  capacity_value numeric(14, 3) check (capacity_value is null or capacity_value >= 0),
  capacity_unit text check (capacity_unit is null or capacity_unit in ('kWp', 'kWh', 'kVA', 'kW', 'litres', 'kL_per_hour')),
  fuel_type text check (fuel_type is null or fuel_type in ('diesel', 'petrol', 'gas', 'other')),
  billing_grade boolean not null default false,
  -- optional level sensor (tank level / battery SoC / fuel level) bound to a push integration
  integration_id uuid references public.meter_integrations(id) on delete set null,
  external_device_id text check (external_device_id is null or char_length(external_device_id) <= 100),
  external_channel text not null default '' check (char_length(external_channel) <= 40),
  level_metric text check (level_metric is null or level_metric in ('tank_level_litres', 'tank_level_pct', 'battery_soc_pct', 'fuel_level_pct')),
  low_level_pct numeric(5, 2) not null default 20 check (low_level_pct between 0 and 100),
  high_level_pct numeric(5, 2) not null default 98 check (high_level_pct between 0 and 100),
  expected_daily_run_hours numeric(6, 2) check (expected_daily_run_hours is null or expected_daily_run_hours >= 0),
  active boolean not null default true,
  commissioned_on date,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_supply_sources_type_check check (
    (utility_type = 'electricity' and source_type in ('municipal_grid', 'eskom_direct', 'prepaid', 'solar_pv', 'battery', 'generator', 'other'))
    or (utility_type = 'water' and source_type in ('municipal', 'borehole', 'rainwater', 'storage_tank', 'tanker', 'other'))
  )
);

create index utility_supply_sources_property_idx on public.utility_supply_sources (property_id);
create unique index utility_supply_sources_sensor_idx
  on public.utility_supply_sources (integration_id, external_device_id, external_channel)
  where active and integration_id is not null and external_device_id is not null;

alter table public.utility_supply_sources enable row level security;
create policy "utility_supply_sources_select" on public.utility_supply_sources for select
  using (public.can_read_property_utilities(org_id, property_id));
create policy "utility_supply_sources_write" on public.utility_supply_sources for all
  using (public.can_write_property_utilities(org_id, property_id))
  with check (public.can_write_property_utilities(org_id, property_id));
create trigger set_utility_supply_sources_updated_at before update on public.utility_supply_sources
  for each row execute function public.set_updated_at();
create trigger utility_supply_sources_audit_trigger after insert or update or delete on public.utility_supply_sources
  for each row execute function public.log_audit_event_trigger();

-- Shared by tables with and without a building_id column, so optional columns are read via jsonb.
create or replace function public.validate_utility_scope_links()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_unit uuid := nullif(v_row ->> 'unit_id', '')::uuid;
  v_building uuid := nullif(v_row ->> 'building_id', '')::uuid;
  v_property uuid := (v_row ->> 'property_id')::uuid;
begin
  if v_unit is not null and not exists (
    select 1 from public.units u where u.id = v_unit and u.property_id = v_property
  ) then
    raise exception 'Unit does not belong to this property';
  end if;
  if v_building is not null and not exists (
    select 1 from public.property_buildings b where b.id = v_building and b.property_id = v_property
  ) then
    raise exception 'Building does not belong to this property';
  end if;
  return new;
end;
$$;

create trigger validate_utility_supply_sources_scope before insert or update on public.utility_supply_sources
  for each row execute function public.validate_utility_scope_links();

-- Instant / level readings (NOT cumulative consumption): tank level, battery SoC, fuel level, run-hour counters.
create table public.utility_source_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  source_id uuid not null references public.utility_supply_sources(id) on delete cascade,
  metric text not null check (metric in ('tank_level_litres', 'tank_level_pct', 'battery_soc_pct', 'fuel_level_pct', 'run_hours')),
  read_at timestamptz not null,
  value numeric(14, 3) not null check (value >= 0),
  source text not null check (source in ('device', 'manual', 'simulator')),
  integration_id uuid references public.meter_integrations(id) on delete set null,
  external_event_id text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_id, metric, read_at)
);
create index utility_source_readings_source_idx on public.utility_source_readings (source_id, metric, read_at desc);
alter table public.utility_source_readings enable row level security;
create policy "utility_source_readings_select" on public.utility_source_readings for select
  using (public.can_read_property_utilities(org_id, property_id));
-- server-written only (device ingestion / routes after permission checks)

-- Operating logs: fuel, tanker deliveries, maintenance, run hours, with costs.
create table public.utility_source_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  source_id uuid not null references public.utility_supply_sources(id) on delete cascade,
  log_type text not null check (log_type in ('fuel_purchase', 'fuel_added', 'tanker_delivery', 'maintenance', 'run_hours', 'service', 'other')),
  occurred_at timestamptz not null,
  quantity numeric(14, 3) check (quantity is null or quantity >= 0),
  quantity_unit text check (quantity_unit is null or quantity_unit in ('litres', 'kL', 'hours', 'kWh')),
  cost_amount numeric(12, 2) check (cost_amount is null or cost_amount >= 0),
  cost_vat_inclusive boolean not null default true,
  document_id uuid references public.documents(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index utility_source_logs_source_idx on public.utility_source_logs (source_id, occurred_at desc);
alter table public.utility_source_logs enable row level security;
create policy "utility_source_logs_select" on public.utility_source_logs for select
  using (public.can_read_property_utilities(org_id, property_id));
create policy "utility_source_logs_write" on public.utility_source_logs for all
  using (public.can_write_property_utilities(org_id, property_id))
  with check (public.can_write_property_utilities(org_id, property_id));
create trigger utility_source_logs_audit_trigger after insert or update or delete on public.utility_source_logs
  for each row execute function public.log_audit_event_trigger();

-- ============================================================
-- 2. Meter measurement kinds
-- ============================================================

alter table public.utility_meters
  add column measurement_kind text not null default 'consumption'
    check (measurement_kind in ('consumption', 'grid_import', 'grid_export', 'generation', 'battery_charge', 'battery_discharge',
                                'generator_output', 'pump_energy', 'transfer', 'source_supply', 'tank_inflow', 'tank_outflow')),
  add column supply_source_id uuid references public.utility_supply_sources(id) on delete set null,
  add constraint utility_meters_measurement_kind_utility check (
    (utility_type = 'electricity' and measurement_kind in ('consumption', 'grid_import', 'grid_export', 'generation', 'battery_charge',
                                                            'battery_discharge', 'generator_output', 'pump_energy', 'transfer'))
    or (utility_type = 'water' and measurement_kind in ('consumption', 'source_supply', 'tank_inflow', 'tank_outflow', 'transfer'))
  );

create or replace function public.validate_meter_supply_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.supply_source_id is not null and not exists (
    select 1 from public.utility_supply_sources s
    where s.id = new.supply_source_id and s.property_id = new.property_id
      -- a pump-energy meter is an electricity meter attached to a WATER source (e.g. borehole pump)
      and (s.utility_type = new.utility_type or new.measurement_kind = 'pump_energy')
  ) then
    raise exception 'Supply source must belong to this property and match the meter utility';
  end if;
  return new;
end;
$$;

create trigger validate_meter_supply_source_trigger before insert or update of supply_source_id, measurement_kind on public.utility_meters
  for each row execute function public.validate_meter_supply_source();

alter table public.meter_telemetry_readings
  add column reading_purpose text not null default 'routine' check (reading_purpose in ('routine', 'move_in', 'move_out', 'billing')),
  add column lease_id uuid references public.leases(id) on delete set null;

-- ============================================================
-- 3. Tariff engine v2
-- ============================================================

alter table public.utility_tariffs drop constraint utility_tariffs_blocks_check;
alter table public.utility_tariffs
  add constraint utility_tariffs_blocks_check check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 10),
  add column unit_id uuid references public.units(id) on delete cascade,
  add column supply_source_type text,
  add column tariff_kind text not null default 'block'
    check (tariff_kind in ('block', 'tou', 'flat', 'fixed_only', 'cost_recovery', 'prepaid_passthrough')),
  add column vat_rate numeric(5, 2) not null default 15 check (vat_rate between 0 and 100),
  add column seasons jsonb not null default '[]'::jsonb check (jsonb_typeof(seasons) = 'array'),
  add column tou_periods jsonb not null default '[]'::jsonb check (jsonb_typeof(tou_periods) = 'array'),
  add column customer_class text check (customer_class is null or char_length(customer_class) <= 100),
  add column municipality_code text,
  add column prorate_blocks boolean not null default true,
  add column requires_review boolean not null default false,
  add column review_reason text check (review_reason is null or char_length(review_reason) <= 500),
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column reviewed_at timestamptz,
  add column source_reference text check (source_reference is null or char_length(source_reference) <= 300);

-- Rate-based kinds still need rates: blocks, or seasonal definitions (validated in the engine); TOU needs periods.
alter table public.utility_tariffs
  add constraint utility_tariffs_rates_present check (
    (tariff_kind not in ('block', 'flat', 'cost_recovery') or jsonb_array_length(blocks) >= 1 or jsonb_array_length(seasons) >= 1)
    and (tariff_kind <> 'tou' or jsonb_array_length(tou_periods) >= 1 or jsonb_array_length(seasons) >= 1)
  );

create index utility_tariffs_unit_idx on public.utility_tariffs (unit_id, utility_type, effective_from desc) where unit_id is not null;

-- Append-only once used: a tariff referenced by any charge cannot change its rates; only effective_to and review
-- fields may change (a new version is a new row).
create or replace function public.protect_used_utility_tariff()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.utility_charges c where c.tariff_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'Tariff % is used by charges and cannot be deleted', old.id;
    end if;
    if (new.blocks, new.fixed_charge, new.vat_inclusive, new.vat_rate, new.seasons, new.tou_periods, new.tariff_kind,
        new.effective_from, new.utility_type, new.unit_id, new.supply_source_type, new.prorate_blocks)
       is distinct from
       (old.blocks, old.fixed_charge, old.vat_inclusive, old.vat_rate, old.seasons, old.tou_periods, old.tariff_kind,
        old.effective_from, old.utility_type, old.unit_id, old.supply_source_type, old.prorate_blocks) then
      raise exception 'Tariff % is used by charges; create a new version instead of editing it', old.id;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger protect_used_utility_tariff_trigger before update or delete on public.utility_tariffs
  for each row execute function public.protect_used_utility_tariff();

-- ============================================================
-- 4. Billing arrangements, allocation, charges v2
-- ============================================================

create table public.utility_allocation_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  meter_id uuid not null references public.utility_meters(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  method text not null check (method in ('equal', 'floor_area', 'occupancy', 'percentage')),
  -- share of the shared meter that is NOT recovered (e.g. common area kept by the landlord), 0..100
  landlord_share_pct numeric(5, 2) not null default 0 check (landlord_share_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.utility_allocation_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.utility_allocation_groups(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  percentage numeric(7, 4) check (percentage is null or (percentage >= 0 and percentage <= 100)),
  occupants integer check (occupants is null or occupants >= 0),
  unique (group_id, unit_id)
);

create table public.utility_billing_arrangements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  utility_type public.utility_type not null,
  arrangement text not null check (arrangement in ('metered_recharge', 'shared_allocation', 'landlord_paid', 'included_in_rent', 'fixed_allowance', 'tenant_direct')),
  invoice_mode text not null default 'separate_invoice' check (invoice_mode in ('separate_invoice', 'with_draft_invoice')),
  allocation_group_id uuid references public.utility_allocation_groups(id) on delete set null,
  fixed_amount numeric(12, 2) check (fixed_amount is null or fixed_amount >= 0),
  allowance_quantity numeric(14, 3) check (allowance_quantity is null or allowance_quantity >= 0),
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to >= effective_from),
  contract_reference text check (contract_reference is null or char_length(contract_reference) <= 200),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_billing_arrangements_group check (arrangement <> 'shared_allocation' or allocation_group_id is not null),
  constraint utility_billing_arrangements_fixed check (arrangement <> 'fixed_allowance' or fixed_amount is not null)
);
create unique index utility_billing_arrangements_open_idx
  on public.utility_billing_arrangements (unit_id, utility_type) where effective_to is null;

do $$
declare t text;
begin
  foreach t in array array['utility_allocation_groups', 'utility_allocation_members', 'utility_billing_arrangements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s_select" on public.%I for select using (public.can_read_property_utilities(org_id, property_id))', t, t);
    execute format('create policy "%s_write" on public.%I for all using (public.can_write_property_utilities(org_id, property_id)) with check (public.can_write_property_utilities(org_id, property_id))', t, t);
    execute format('create trigger %s_audit_trigger after insert or update or delete on public.%I for each row execute function public.log_audit_event_trigger()', t, t);
  end loop;
end $$;

create trigger validate_allocation_member_scope before insert or update on public.utility_allocation_members
  for each row execute function public.validate_utility_scope_links();
create trigger validate_billing_arrangement_scope before insert or update on public.utility_billing_arrangements
  for each row execute function public.validate_utility_scope_links();

-- Cross-row links must stay inside one property (RLS checks only the row's own org/property columns).
create or replace function public.validate_utility_allocation_links()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'utility_allocation_groups' then
    if not exists (select 1 from public.utility_meters m where m.id = new.meter_id and m.property_id = new.property_id) then
      raise exception 'Meter does not belong to this property';
    end if;
  elsif tg_table_name = 'utility_allocation_members' then
    if not exists (select 1 from public.utility_allocation_groups g where g.id = new.group_id and g.property_id = new.property_id) then
      raise exception 'Group does not belong to this property';
    end if;
  elsif tg_table_name = 'utility_supply_sources' then
    if new.integration_id is not null and not exists (
      select 1 from public.meter_integrations i where i.id = new.integration_id and i.org_id = new.org_id
    ) then
      raise exception 'Integration does not belong to this organisation';
    end if;
  elsif tg_table_name = 'utility_billing_arrangements' then
    if new.allocation_group_id is not null and not exists (
      select 1 from public.utility_allocation_groups g where g.id = new.allocation_group_id and g.property_id = new.property_id
    ) then
      raise exception 'Group does not belong to this property';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_allocation_group_links before insert or update on public.utility_allocation_groups
  for each row execute function public.validate_utility_allocation_links();
create trigger validate_allocation_member_links before insert or update on public.utility_allocation_members
  for each row execute function public.validate_utility_allocation_links();
create trigger validate_billing_arrangement_links before insert or update on public.utility_billing_arrangements
  for each row execute function public.validate_utility_allocation_links();
create trigger validate_supply_source_links before insert or update on public.utility_supply_sources
  for each row execute function public.validate_utility_allocation_links();

-- Charges v2
drop index public.utility_charges_meter_period_idx;
alter table public.utility_charges alter column meter_id drop not null;
alter table public.utility_charges
  add column charge_type text not null default 'consumption'
    check (charge_type in ('consumption', 'allocation', 'fixed', 'allowance_fee', 'excess', 'credit_applied')),
  add column supply_source_id uuid references public.utility_supply_sources(id) on delete set null,
  add column arrangement_id uuid references public.utility_billing_arrangements(id) on delete set null,
  add column allocation_group_id uuid references public.utility_allocation_groups(id) on delete set null,
  add column allocation_share numeric(9, 6),
  add column segment_start date,
  add column segment_end date,
  add column proration_factor numeric(9, 6),
  add column amount_excl_vat numeric(12, 2),
  add column vat_amount numeric(12, 2),
  add column calculation jsonb,
  add column review_flags jsonb not null default '[]'::jsonb,
  add column adjustment_total numeric(12, 2) not null default 0,
  add column credit_applied numeric(12, 2) not null default 0 check (credit_applied >= 0),
  add column dispute_status text not null default 'none' check (dispute_status in ('none', 'open', 'resolved')),
  add column dispute_reason text check (dispute_reason is null or char_length(dispute_reason) <= 1000),
  add column dispute_resolution text check (dispute_resolution is null or char_length(dispute_resolution) <= 1000),
  add column disputed_at timestamptz,
  add column dispute_resolved_at timestamptz;

-- Double-billing guard: one live charge per meter/source/arrangement, period, type and lease.
create unique index utility_charges_live_unique_idx on public.utility_charges (
  coalesce(meter_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(arrangement_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(lease_id, '00000000-0000-0000-0000-000000000000'::uuid),
  period_start,
  charge_type
) where status <> 'void';

-- Approved/invoiced charges are immutable apart from workflow fields.
create or replace function public.protect_approved_utility_charge()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('approved', 'invoiced') and
     (new.total_amount, new.usage_amount, new.fixed_amount, new.consumption, new.calculation, new.tariff_snapshot,
      new.amount_excl_vat, new.vat_amount, new.period_start, new.period_end, new.lease_id, new.tenant_id, new.adjustment_total)
     is distinct from
     (old.total_amount, old.usage_amount, old.fixed_amount, old.consumption, old.calculation, old.tariff_snapshot,
      old.amount_excl_vat, old.vat_amount, old.period_start, old.period_end, old.lease_id, old.tenant_id, old.adjustment_total) then
    raise exception 'An approved or invoiced utility charge cannot be changed; void it and recalculate, or record a credit';
  end if;
  return new;
end;
$$;

create trigger protect_approved_utility_charge_trigger before update on public.utility_charges
  for each row execute function public.protect_approved_utility_charge();

create table public.utility_charge_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  charge_id uuid not null references public.utility_charges(id) on delete cascade,
  amount numeric(12, 2) not null check (amount <> 0),
  reason text not null check (char_length(reason) between 3 and 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.utility_credits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  lease_id uuid not null references public.leases(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  source_charge_id uuid references public.utility_charges(id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  remaining numeric(12, 2) not null check (remaining >= 0),
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'applied', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['utility_charge_adjustments', 'utility_credits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s_select" on public.%I for select using (public.can_read_property_utilities(org_id, property_id))', t, t);
    execute format('create trigger %s_audit_trigger after insert or update or delete on public.%I for each row execute function public.log_audit_event_trigger()', t, t);
  end loop;
end $$;
-- adjustments and credits are server-written (routes check can_write_property_utilities)

-- Tenants read their OWN invoiced charges (never drafts or other leases).
create policy "utility_charges_select_tenant_self" on public.utility_charges for select
  using (status = 'invoiced' and lease_id is not null and public.caller_is_tenant_of_lease(lease_id));

-- ============================================================
-- 5. Statements
-- ============================================================

create table public.utility_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  audience text not null check (audience in ('tenant', 'owner')),
  lease_id uuid references public.leases(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  period_start date not null,
  period_end date not null check (period_end > period_start),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'void')),
  snapshot jsonb not null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  sent_to text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_statements_tenant_has_lease check (audience <> 'tenant' or lease_id is not null)
);
create unique index utility_statements_unique_idx on public.utility_statements (
  property_id, audience, coalesce(lease_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start
) where status <> 'void';

alter table public.utility_statements enable row level security;
create policy "utility_statements_select" on public.utility_statements for select
  using (public.can_read_property_utilities(org_id, property_id));
create policy "utility_statements_select_tenant_self" on public.utility_statements for select
  using (audience = 'tenant' and status in ('approved', 'sent') and lease_id is not null and public.caller_is_tenant_of_lease(lease_id));
create trigger set_utility_statements_updated_at before update on public.utility_statements
  for each row execute function public.set_updated_at();
create trigger utility_statements_audit_trigger after insert or update or delete on public.utility_statements
  for each row execute function public.log_audit_event_trigger();

-- Approved statements are immutable (only send/void workflow fields change).
create or replace function public.protect_approved_utility_statement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('approved', 'sent') and new.snapshot is distinct from old.snapshot then
    raise exception 'An approved utility statement cannot be changed; void it and regenerate';
  end if;
  return new;
end;
$$;
create trigger protect_approved_utility_statement_trigger before update on public.utility_statements
  for each row execute function public.protect_approved_utility_statement();

-- ============================================================
-- 6. Alerts
-- ============================================================

alter table public.utility_alerts drop constraint utility_alerts_rule_check;
alter table public.utility_alerts add constraint utility_alerts_rule_check check (rule in (
  'water_continuous_night_flow', 'consumption_spike', 'vacant_unit_consumption', 'electricity_night_base_load',
  'main_submeter_discrepancy', 'meter_offline', 'meter_reset_detected',
  'tank_low', 'tank_overflow', 'generator_abnormal', 'pump_abnormal', 'solar_issue', 'battery_issue',
  'reconciliation_gap', 'charges_awaiting_approval', 'utility_invoice_unpaid', 'missing_readings'
));
alter table public.utility_alerts add column supply_source_id uuid references public.utility_supply_sources(id) on delete cascade;
