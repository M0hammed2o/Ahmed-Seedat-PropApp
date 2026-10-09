-- Smart Utility Monitoring, Phase 1 (docs/SMART_UTILITY_ARCHITECTURE.md, WORKLOG.md 2026-10-08).
--
-- Extends migration 163's utility_meters/utility_readings rather than replacing them: the monthly
-- billing-period reading (utility_readings, UNIQUE(meter_id, period_month)) stays exactly as the web
-- panel and the Android capture screens use it. This migration adds:
--   1. an optional building level (property_buildings, units.building_id, utility_meters.building_id);
--   2. smart-meter attributes on utility_meters (role, ownership, device binding, multiplier,
--      rollover digits, health, replacement chain);
--   3. push integrations with hashed inbound tokens (meter_integrations) -- no vendor credential is
--      stored anywhere in Phase 1;
--   4. append-only interval telemetry (meter_telemetry_readings) + an ingestion log;
--   5. rule-based alerts and per-property thresholds;
--   6. municipal reading-submission settings, authorised recipients, submissions and per-recipient
--      deliveries.
--
-- It ALSO closes a real access-control gap in migration 163: utility_meters/utility_readings were
-- org-role-only ("consistent with every other financial table"), but expenses moved to
-- property_access RLS in migration 068 -- so a 'selected'-mode staff member could read every
-- property's meters in the org, and portal owners could read none. Both tables now use the
-- 068/072 owner-portal-aware pattern via the two helpers below. 'all'-mode members are unaffected
-- (migration 084 auto-grants them 'administrator' property_access on every property).
--
-- Rollback (local/test only -- drops data):
--   drop table if exists public.municipal_submission_deliveries, public.municipal_submissions,
--     public.municipal_submission_recipients, public.municipal_submission_settings,
--     public.utility_alerts, public.utility_alert_settings, public.meter_ingest_events,
--     public.meter_telemetry_readings cascade;
--   alter table public.utility_meters drop column ... (each column added in section 2);
--   drop table public.meter_integrations, public.property_buildings cascade;
--   alter table public.units drop column building_id;
--   then re-create migration 163's four original policies and record_utility_reading() body.

-- ============================================================
-- 0. Access helpers
-- ============================================================

create or replace function public.can_read_property_utilities(p_org_id uuid, p_property_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    (public.has_org_role(p_org_id, 'viewer') and public.has_property_access(p_property_id, 'read_only'))
    or public.has_property_access(p_property_id, 'owner');
$$;

create or replace function public.can_write_property_utilities(p_org_id uuid, p_property_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.has_org_role(p_org_id, 'accountant')
    and (
      public.has_property_access(p_property_id, 'accountant')
      or public.has_property_access(p_property_id, 'property_manager')
      or public.has_property_access(p_property_id, 'owner')
    );
$$;

comment on function public.can_read_property_utilities(uuid, uuid) is
  'Owner-portal-aware read gate for every utility/smart-meter table (migrations 068/072 pattern).';
comment on function public.can_write_property_utilities(uuid, uuid) is
  'Write gate for utility/smart-meter configuration: org accountant+ (accountant, manager, principal)
   AND an accountant/property_manager/owner/administrator grant on the property.';

-- ============================================================
-- 1. Optional building level
-- ============================================================

create table public.property_buildings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, name)
);

create index property_buildings_property_idx on public.property_buildings (property_id);

alter table public.property_buildings enable row level security;

create policy "property_buildings_select"
  on public.property_buildings for select
  using (public.can_read_property_utilities(org_id, property_id));

create policy "property_buildings_write"
  on public.property_buildings for all
  using (public.can_write_property_utilities(org_id, property_id))
  with check (public.can_write_property_utilities(org_id, property_id));

create trigger set_property_buildings_updated_at
  before update on public.property_buildings
  for each row execute function public.set_updated_at();

create trigger property_buildings_audit_trigger
  after insert or update or delete on public.property_buildings
  for each row execute function public.log_audit_event_trigger();

alter table public.units
  add column building_id uuid references public.property_buildings(id) on delete set null;

create or replace function public.validate_building_belongs_to_property()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.building_id is not null and not exists (
    select 1 from public.property_buildings b
    where b.id = new.building_id and b.property_id = new.property_id and b.org_id = new.org_id
  ) then
    raise exception 'Building does not belong to this property';
  end if;
  return new;
end;
$$;

create trigger validate_unit_building_trigger
  before insert or update of building_id on public.units
  for each row execute function public.validate_building_belongs_to_property();

-- ============================================================
-- 2. Push integrations (inbound tokens, hashed)
-- ============================================================

create table public.meter_integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  provider text not null check (provider in ('milesight_lorawan', 'shelly_gen2', 'generic_json', 'simulator')),
  name text not null check (char_length(name) between 1 and 100),
  -- Bearer token format: pmi_<token_prefix>_<secret>. Only SHA-256(full token) is stored; the
  -- plaintext is returned exactly once by the create/rotate routes.
  token_prefix text not null unique check (token_prefix ~ '^[a-z0-9]{12}$'),
  token_hash text not null check (char_length(token_hash) = 64),
  previous_token_prefix text,
  previous_token_hash text check (previous_token_hash is null or char_length(previous_token_hash) = 64),
  previous_token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_seen_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meter_integrations_property_idx on public.meter_integrations (property_id);
create unique index meter_integrations_previous_prefix_idx
  on public.meter_integrations (previous_token_prefix) where previous_token_prefix is not null;

alter table public.meter_integrations enable row level security;

create policy "meter_integrations_select"
  on public.meter_integrations for select
  using (public.can_read_property_utilities(org_id, property_id));
-- No client write policy: create/rotate/revoke go through server routes that hash the secret
-- with the service-role client after requirePropertyAccess-style checks.

-- Column-level read restriction: hashes are never readable by API clients, even an org principal.
revoke select on public.meter_integrations from anon, authenticated;
grant select (
  id, org_id, property_id, provider, name, token_prefix, status, last_seen_at, rotated_at,
  revoked_at, previous_token_expires_at, created_by, created_at, updated_at
) on public.meter_integrations to authenticated;

create trigger set_meter_integrations_updated_at
  before update on public.meter_integrations
  for each row execute function public.set_updated_at();
-- Deliberately NO log_audit_event_trigger here: it copies whole rows into audit_events, which
-- would put the token hashes into the audit log. Audited explicitly by the app instead.

-- ============================================================
-- 3. Smart attributes on utility_meters
-- ============================================================

alter table public.utility_meters
  add column building_id uuid references public.property_buildings(id) on delete set null,
  add column meter_role text check (meter_role in ('main', 'submeter', 'check')),
  add column ownership text check (ownership in ('municipal', 'private')),
  add column parent_meter_id uuid references public.utility_meters(id) on delete set null,
  add column manufacturer text check (manufacturer is null or char_length(manufacturer) <= 100),
  add column model text check (model is null or char_length(model) <= 100),
  add column serial_number text check (serial_number is null or char_length(serial_number) <= 100),
  add column connectivity text not null default 'manual'
    check (connectivity in ('manual', 'lorawan', 'wifi', 'modbus_gateway', 'http_push', 'simulator')),
  add column integration_id uuid references public.meter_integrations(id) on delete set null,
  add column external_device_id text check (external_device_id is null or char_length(external_device_id) <= 100),
  add column external_channel text not null default '' check (char_length(external_channel) <= 40),
  -- base units per raw device unit: e.g. 0.5 (L per pulse) for a 0.5 L/pulse water meter, 0.001
  -- (kWh per Wh) for a Shelly EMData Wh counter, 1 for a meter that already reports kWh/L.
  add column multiplier numeric(14, 6) not null default 1 check (multiplier > 0),
  -- base units added after the multiplier: aligns a pulse counter (which starts at 0 when fitted)
  -- with the meter dial, so device-derived readings equal what the dial shows.
  add column value_offset numeric(18, 4) not null default 0 check (value_offset >= 0),
  add column register_digits smallint check (register_digits is null or register_digits between 3 and 12),
  add column expected_interval_minutes integer check (expected_interval_minutes is null or expected_interval_minutes in (15, 60, 1440, 43200)),
  add column tariff_per_unit numeric(12, 4) check (tariff_per_unit is null or tariff_per_unit >= 0),
  add column municipal_account_number text check (municipal_account_number is null or char_length(municipal_account_number) <= 60),
  add column last_reading_at timestamptz,
  add column last_reading_value numeric(18, 4),
  add column last_sync_at timestamptz,
  add column health_status text not null default 'unknown'
    check (health_status in ('unknown', 'online', 'stale', 'offline', 'error')),
  add column replaced_meter_id uuid references public.utility_meters(id) on delete set null,
  add column decommissioned_at timestamptz;

update public.utility_meters
set meter_role = case when unit_id is null then 'main' else 'submeter' end
where meter_role is null;

alter table public.utility_meters alter column meter_role set not null;
alter table public.utility_meters alter column meter_role set default 'submeter';

create unique index utility_meters_device_binding_idx
  on public.utility_meters (integration_id, external_device_id, external_channel)
  where active and integration_id is not null and external_device_id is not null;
create index utility_meters_parent_idx on public.utility_meters (parent_meter_id) where parent_meter_id is not null;

create or replace function public.validate_utility_meter_smart_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.building_id is not null and not exists (
    select 1 from public.property_buildings b
    where b.id = new.building_id and b.property_id = new.property_id
  ) then
    raise exception 'Building does not belong to this property';
  end if;
  if new.parent_meter_id is not null then
    if new.parent_meter_id = new.id then
      raise exception 'A meter cannot be its own parent';
    end if;
    if not exists (
      select 1 from public.utility_meters m
      where m.id = new.parent_meter_id and m.property_id = new.property_id
        and m.utility_type = new.utility_type and m.meter_role in ('main', 'check')
    ) then
      raise exception 'Parent meter must be a main/check meter of the same property and utility type';
    end if;
  end if;
  if new.integration_id is not null and not exists (
    select 1 from public.meter_integrations i
    where i.id = new.integration_id and i.org_id = new.org_id and i.property_id = new.property_id
  ) then
    raise exception 'Integration does not belong to this property';
  end if;
  if new.replaced_meter_id is not null and not exists (
    select 1 from public.utility_meters m
    where m.id = new.replaced_meter_id and m.property_id = new.property_id and m.utility_type = new.utility_type
  ) then
    raise exception 'Replaced meter must be on the same property with the same utility type';
  end if;
  return new;
end;
$$;

create trigger validate_utility_meter_smart_fields_trigger
  before insert or update on public.utility_meters
  for each row execute function public.validate_utility_meter_smart_fields();

-- Configuration changes only: the ingestion path updates last_reading_*/last_sync_at/health_status
-- on every accepted reading, which must not write an audit row per meter reading.
create trigger utility_meters_audit_trigger
  after insert or delete or update of
    property_id, unit_id, building_id, utility_type, meter_number, meter_role, ownership,
    parent_meter_id, manufacturer, model, serial_number, connectivity, integration_id,
    external_device_id, external_channel, multiplier, value_offset, register_digits, expected_interval_minutes,
    tariff_per_unit, municipal_account_number, active, replaced_meter_id, decommissioned_at,
    responsibility_mode, is_prepaid
  on public.utility_meters
  for each row execute function public.log_audit_event_trigger();

-- Gap fix: replace migration 163's org-only policies.
drop policy "utility_meters_select_org_member" on public.utility_meters;
drop policy "utility_meters_write_accountant_plus" on public.utility_meters;

create policy "utility_meters_select"
  on public.utility_meters for select
  using (public.can_read_property_utilities(org_id, property_id));

create policy "utility_meters_write"
  on public.utility_meters for all
  using (public.can_write_property_utilities(org_id, property_id))
  with check (public.can_write_property_utilities(org_id, property_id));

drop policy "utility_readings_select_org_member" on public.utility_readings;
drop policy "utility_readings_insert_accountant_plus" on public.utility_readings;
drop policy "utility_readings_delete_accountant_plus_replace_only" on public.utility_readings;

create policy "utility_readings_select"
  on public.utility_readings for select
  using (exists (
    select 1 from public.utility_meters m
    where m.id = utility_readings.meter_id and public.can_read_property_utilities(m.org_id, m.property_id)
  ));

create policy "utility_readings_insert"
  on public.utility_readings for insert
  with check (exists (
    select 1 from public.utility_meters m
    where m.id = utility_readings.meter_id and m.org_id = utility_readings.org_id
      and public.can_write_property_utilities(m.org_id, m.property_id)
  ));

create policy "utility_readings_delete_replace_only"
  on public.utility_readings for delete
  using (exists (
    select 1 from public.utility_meters m
    where m.id = utility_readings.meter_id and public.can_write_property_utilities(m.org_id, m.property_id)
  ));

-- record_utility_reading(): identical to migration 163's body except the authorisation check,
-- which now also requires property access (it is SECURITY DEFINER, so RLS alone would not apply).
create or replace function public.record_utility_reading(
  p_meter_id uuid,
  p_period_month date,
  p_reading_date date,
  p_reading_value numeric,
  p_unit_of_measure text,
  p_source public.utility_reading_source default 'manual',
  p_document_id uuid default null,
  p_notes text default null,
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
  if not public.can_write_property_utilities(v_meter.org_id, v_meter.property_id) then
    raise exception 'Caller does not have accountant+ rights on this property';
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

-- ============================================================
-- 4. Interval telemetry + ingestion log
-- ============================================================

create table public.meter_telemetry_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  meter_id uuid not null references public.utility_meters(id) on delete cascade,
  read_at timestamptz not null,
  raw_value numeric(18, 4) not null check (raw_value >= 0),
  multiplier numeric(14, 6) not null check (multiplier > 0),
  -- value = raw_value * multiplier + the meter's value_offset at ingestion, in the meter's base unit
  -- (L for water, kWh for electricity). Stored (not generated) so a later multiplier/offset change
  -- never reinterprets history.
  value numeric(18, 4) not null check (value >= 0),
  source text not null check (source in ('device', 'manual', 'simulator', 'estimated')),
  integration_id uuid references public.meter_integrations(id) on delete set null,
  external_event_id text check (external_event_id is null or char_length(external_event_id) <= 200),
  status text not null default 'valid' check (status in ('valid', 'suspect', 'rejected')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 200),
  document_id uuid references public.documents(id) on delete set null,
  recorded_by uuid references auth.users(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 500),
  ingested_at timestamptz not null default now(),
  unique (meter_id, read_at)
);

create unique index meter_telemetry_event_idx
  on public.meter_telemetry_readings (integration_id, external_event_id)
  where integration_id is not null and external_event_id is not null;
create index meter_telemetry_meter_time_idx on public.meter_telemetry_readings (meter_id, read_at desc);
create index meter_telemetry_property_idx on public.meter_telemetry_readings (property_id, read_at desc);

alter table public.meter_telemetry_readings enable row level security;

create policy "meter_telemetry_select"
  on public.meter_telemetry_readings for select
  using (public.can_read_property_utilities(org_id, property_id));
-- No client write policy: device readings arrive via the token-authenticated ingestion route and
-- manual readings via a route that checks can_write_property_utilities first; both insert with
-- the service-role client. Append-only: no update/delete policy for anyone.

create table public.meter_ingest_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  integration_id uuid not null references public.meter_integrations(id) on delete cascade,
  outcome text not null check (outcome in ('accepted', 'partial', 'rejected')),
  accepted_count integer not null default 0,
  duplicate_count integer not null default 0,
  rejected_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  source_ip_hash text,
  received_at timestamptz not null default now()
);

create index meter_ingest_events_integration_idx on public.meter_ingest_events (integration_id, received_at desc);

alter table public.meter_ingest_events enable row level security;

create policy "meter_ingest_events_select"
  on public.meter_ingest_events for select
  using (public.can_read_property_utilities(org_id, property_id));

-- ============================================================
-- 5. Alerts
-- ============================================================

create table public.utility_alert_settings (
  -- id exists for log_audit_event_trigger(), which keys audit rows on an `id` column.
  id uuid not null unique default gen_random_uuid(),
  property_id uuid primary key references public.properties(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  discrepancy_threshold_pct numeric(5, 2) not null default 15 check (discrepancy_threshold_pct between 0 and 100),
  spike_multiple numeric(5, 2) not null default 3 check (spike_multiple >= 1),
  night_flow_litres_per_hour numeric(10, 2) not null default 5 check (night_flow_litres_per_hour >= 0),
  night_base_load_ratio numeric(4, 2) not null default 0.6 check (night_base_load_ratio between 0 and 5),
  vacant_water_litres_per_day numeric(10, 2) not null default 50 check (vacant_water_litres_per_day >= 0),
  vacant_electricity_kwh_per_day numeric(10, 2) not null default 2 check (vacant_electricity_kwh_per_day >= 0),
  updated_at timestamptz not null default now()
);

alter table public.utility_alert_settings enable row level security;

create policy "utility_alert_settings_select"
  on public.utility_alert_settings for select
  using (public.can_read_property_utilities(org_id, property_id));

create policy "utility_alert_settings_write"
  on public.utility_alert_settings for all
  using (public.can_write_property_utilities(org_id, property_id))
  with check (public.can_write_property_utilities(org_id, property_id));

create trigger set_utility_alert_settings_updated_at
  before update on public.utility_alert_settings
  for each row execute function public.set_updated_at();

create table public.utility_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  meter_id uuid references public.utility_meters(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  utility_type public.utility_type not null,
  rule text not null check (rule in (
    'water_continuous_night_flow', 'consumption_spike', 'vacant_unit_consumption',
    'electricity_night_base_load', 'main_submeter_discrepancy', 'meter_offline', 'meter_reset_detected'
  )),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title text not null check (char_length(title) <= 200),
  message text not null check (char_length(message) <= 1000),
  period_start timestamptz,
  period_end timestamptz,
  details jsonb not null default '{}'::jsonb,
  estimated_cost numeric(12, 2),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  dedupe_key text not null unique,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index utility_alerts_property_idx on public.utility_alerts (property_id, created_at desc);

alter table public.utility_alerts enable row level security;

create policy "utility_alerts_select"
  on public.utility_alerts for select
  using (public.can_read_property_utilities(org_id, property_id));
-- Created by the job (service role). Status changes go through PATCH /utility-alerts/:id, which
-- checks can_write_property_utilities and writes with the session client under this policy:
create policy "utility_alerts_update_status"
  on public.utility_alerts for update
  using (public.can_write_property_utilities(org_id, property_id))
  with check (public.can_write_property_utilities(org_id, property_id));

-- ============================================================
-- 6. Municipal reading submissions
-- ============================================================

create table public.municipal_submission_settings (
  id uuid not null unique default gen_random_uuid(),
  property_id uuid primary key references public.properties(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  municipality_code text check (municipality_code is null or municipality_code ~ '^[a-z0-9_]{2,40}$'),
  municipal_account_number text check (municipal_account_number is null or char_length(municipal_account_number) <= 60),
  mode text not null default 'approval_required' check (mode in ('manual', 'approval_required', 'automatic')),
  billing_day smallint not null default 25 check (billing_day between 1 and 28),
  lead_days smallint not null default 5 check (lead_days between 0 and 20),
  include_photos boolean not null default true,
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.municipal_submission_settings enable row level security;

create policy "municipal_submission_settings_select"
  on public.municipal_submission_settings for select
  using (public.can_read_property_utilities(org_id, property_id));

create policy "municipal_submission_settings_write"
  on public.municipal_submission_settings for all
  using (public.can_write_property_utilities(org_id, property_id))
  with check (public.can_write_property_utilities(org_id, property_id));

create trigger set_municipal_submission_settings_updated_at
  before update on public.municipal_submission_settings
  for each row execute function public.set_updated_at();

create table public.municipal_submission_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  label text check (label is null or char_length(label) <= 100),
  recipient_type text not null check (recipient_type in ('municipality', 'managing_agent', 'utility_company', 'accountant', 'custom')),
  -- Explicit owner authorisation (POPIA: a misaddressed pack is an unauthorised disclosure).
  -- Automatic sends go ONLY to recipients with authorised_at set.
  authorised_at timestamptz,
  authorised_by uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index municipal_submission_recipients_unique_idx
  on public.municipal_submission_recipients (property_id, lower(email));

alter table public.municipal_submission_recipients enable row level security;

create policy "municipal_submission_recipients_select"
  on public.municipal_submission_recipients for select
  using (public.can_read_property_utilities(org_id, property_id));

create policy "municipal_submission_recipients_write"
  on public.municipal_submission_recipients for all
  using (public.can_write_property_utilities(org_id, property_id))
  with check (public.can_write_property_utilities(org_id, property_id));

create trigger set_municipal_submission_recipients_updated_at
  before update on public.municipal_submission_recipients
  for each row execute function public.set_updated_at();

create trigger municipal_submission_recipients_audit_trigger
  after insert or update or delete on public.municipal_submission_recipients
  for each row execute function public.log_audit_event_trigger();

create trigger municipal_submission_settings_audit_trigger
  after insert or update or delete on public.municipal_submission_settings
  for each row execute function public.log_audit_event_trigger();

create table public.municipal_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  period_start date not null,
  period_end date not null check (period_end > period_start),
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'sending', 'sent', 'partially_failed', 'failed', 'cancelled'
  )),
  mode text not null check (mode in ('manual', 'approval_required', 'automatic')),
  -- Immutable snapshot of exactly what is/was sent (meters, readings, sources, verification).
  report jsonb not null,
  generated_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  -- Sent != accepted. Only a human sets this, typically after checking the next municipal bill.
  acceptance_status text not null default 'unknown' check (acceptance_status in ('unknown', 'accepted', 'rejected', 'not_applicable')),
  submission_reference text check (submission_reference is null or char_length(submission_reference) <= 100),
  acceptance_notes text check (acceptance_notes is null or char_length(acceptance_notes) <= 1000),
  acceptance_recorded_by uuid references auth.users(id) on delete set null,
  acceptance_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, period_start)
);

create index municipal_submissions_status_idx on public.municipal_submissions (status);

alter table public.municipal_submissions enable row level security;

create policy "municipal_submissions_select"
  on public.municipal_submissions for select
  using (public.can_read_property_utilities(org_id, property_id));
-- Written by server routes/jobs (service role) after can_write_property_utilities checks.

create trigger set_municipal_submissions_updated_at
  before update on public.municipal_submissions
  for each row execute function public.set_updated_at();

create table public.municipal_submission_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  submission_id uuid not null references public.municipal_submissions(id) on delete cascade,
  recipient_id uuid references public.municipal_submission_recipients(id) on delete set null,
  recipient_email text not null,
  recipient_type text not null,
  status text not null default 'pending' check (status in ('pending', 'queued', 'sent', 'delivered', 'failed', 'bounced')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  email_message_id uuid references public.email_messages(id) on delete set null,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, recipient_email)
);

create index municipal_submission_deliveries_due_idx
  on public.municipal_submission_deliveries (next_attempt_at) where status in ('pending', 'failed');

alter table public.municipal_submission_deliveries enable row level security;

create policy "municipal_submission_deliveries_select"
  on public.municipal_submission_deliveries for select
  using (public.can_read_property_utilities(org_id, property_id));

create trigger set_municipal_submission_deliveries_updated_at
  before update on public.municipal_submission_deliveries
  for each row execute function public.set_updated_at();
