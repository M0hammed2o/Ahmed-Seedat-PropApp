-- ROLLBACK of utilities migrations 175–183 (docs/UTILITIES_STAGING_DEPLOYMENT_PLAN.md §2).
-- NOT a migration: run by hand, as one transaction (psql -1 -v ON_ERROR_STOP=1 -f ...), only on a database where
-- 175–183 were applied and something forces going back. Rehearsed on a disposable copy of representative data:
-- schema after rollback = schema at 174 (pg_dump diff empty), data fingerprint of pre-existing tables unchanged.
--
-- It REFUSES to run when real utility data exists (charges, statements, municipal packs, device/manual telemetry
-- other than mirrored monthly readings, supply sources, tariffs). Dropping those tables would destroy customer
-- records: restore from backup/PITR instead. Override ONLY on a throw-away database:
--   set proplyst.rollback_discard_utility_data = 'yes';
--
-- Pre-existing objects that 175/179 altered are put back exactly as they were at 174 (policies on utility_meters and
-- utility_readings, record_utility_reading()); utility_meters / units keep all their original columns and rows.

do $$
declare
  v_discard boolean := coalesce(current_setting('proplyst.rollback_discard_utility_data', true), '') = 'yes';
  v_rows bigint;
begin
  select (select count(*) from public.utility_charges)
       + (select count(*) from public.utility_statements)
       + (select count(*) from public.municipal_submissions)
       + (select count(*) from public.utility_tariffs)
       + (select count(*) from public.utility_supply_sources)
       + (select count(*) from public.meter_telemetry_readings where external_event_id is null or external_event_id not like 'utility_reading:%')
    into v_rows;
  if v_rows > 0 and not v_discard then
    raise exception 'Rollback refused: % utility rows exist (charges/statements/packs/tariffs/sources/telemetry). Restore from backup instead.', v_rows;
  end if;
end $$;

-- ------------------------------------------------------------------ 181
drop trigger if exists mirror_utility_reading_insert on public.utility_readings;
drop trigger if exists mirror_utility_reading_delete on public.utility_readings;
drop function if exists public.mirror_utility_reading_to_telemetry();
drop function if exists public.downsample_meter_telemetry(timestamptz, integer);
drop function if exists public.ingest_telemetry_batch(jsonb);
-- (utility_credits_one_true_up and the 'true_up' charge type go with their tables below)

-- ------------------------------------------------------------------ 180 (new function; nothing to restore)
drop function if exists public.portfolio_intelligence_candidate_orgs();

-- ------------------------------------------------------------------ 182 (default/value of the column below) + 179
alter table public.organizations drop column if exists utilities_enabled;
drop function if exists public.utility_reading_counts_since(timestamptz, uuid[]);
drop trigger if exists release_utility_charges_on_invoice_void on public.invoices;
drop trigger if exists release_utility_charges_on_invoice_delete on public.invoices;
drop function if exists public.release_utility_charges_from_invoice();
drop trigger if exists validate_utility_reading_document_trigger on public.utility_readings;
drop function if exists public.validate_utility_reading_document();
drop trigger if exists utility_responsibility_settings_property_in_org on public.utility_responsibility_settings;
drop trigger if exists utility_meters_property_in_org on public.utility_meters;

-- ------------------------------------------------------------------ 178 / 176 / 175 new tables (data guarded above)
drop table if exists
  public.utility_statements,
  public.utility_credits,
  public.utility_charge_adjustments,
  public.utility_charges,
  public.utility_billing_arrangements,
  public.utility_allocation_members,
  public.utility_allocation_groups,
  public.utility_source_logs,
  public.utility_source_readings,
  public.utility_tariffs,
  public.meter_period_snapshots,
  public.meter_integration_requests,
  public.municipal_submission_deliveries,
  public.municipal_submissions,
  public.municipal_submission_recipients,
  public.municipal_submission_settings,
  public.utility_alerts,
  public.utility_alert_settings,
  public.meter_ingest_events,
  public.meter_telemetry_readings
  cascade;

-- utility_meters: drop the triggers, policies and columns 175/177/178 added (rows and original columns stay)
drop trigger if exists validate_meter_supply_source_trigger on public.utility_meters;
drop trigger if exists validate_utility_meter_smart_fields_trigger on public.utility_meters;
drop trigger if exists utility_meters_audit_trigger on public.utility_meters;
drop policy if exists "utility_meters_select" on public.utility_meters;
drop policy if exists "utility_meters_write" on public.utility_meters;
alter table public.utility_meters
  drop constraint if exists utility_meters_measurement_kind_utility,
  drop column if exists supply_source_id,
  drop column if exists measurement_kind,
  drop column if exists location,
  drop column if exists building_id,
  drop column if exists meter_role,
  drop column if exists ownership,
  drop column if exists parent_meter_id,
  drop column if exists manufacturer,
  drop column if exists model,
  drop column if exists serial_number,
  drop column if exists connectivity,
  drop column if exists integration_id,
  drop column if exists external_device_id,
  drop column if exists external_channel,
  drop column if exists multiplier,
  drop column if exists value_offset,
  drop column if exists register_digits,
  drop column if exists expected_interval_minutes,
  drop column if exists tariff_per_unit,
  drop column if exists municipal_account_number,
  drop column if exists last_reading_at,
  drop column if exists last_reading_value,
  drop column if exists last_sync_at,
  drop column if exists health_status,
  drop column if exists replaced_meter_id,
  drop column if exists decommissioned_at;

drop policy if exists "utility_readings_select" on public.utility_readings;
drop policy if exists "utility_readings_insert" on public.utility_readings;
drop policy if exists "utility_readings_delete_replace_only" on public.utility_readings;

drop table if exists public.utility_supply_sources cascade;
drop trigger if exists validate_unit_building_trigger on public.units;
alter table public.units drop column if exists building_id;
drop table if exists public.meter_integrations, public.property_buildings cascade;

drop function if exists public.validate_meter_supply_source();
drop function if exists public.validate_utility_scope_links();
drop function if exists public.validate_utility_allocation_links();
drop function if exists public.protect_used_utility_tariff();
drop function if exists public.protect_approved_utility_charge();
drop function if exists public.protect_approved_utility_statement();
drop function if exists public.validate_row_property_in_org();
drop function if exists public.validate_utility_meter_smart_fields();
drop function if exists public.validate_building_belongs_to_property();

-- ------------------------------------------------------------------ restore the 174 definitions
-- utility_meters / utility_readings policies exactly as at migration 174 (migration 163's org-role policies)
CREATE POLICY utility_meters_select_org_member ON public.utility_meters FOR SELECT USING (public.has_org_role(org_id, 'viewer'::public.organization_member_role));
CREATE POLICY utility_meters_write_accountant_plus ON public.utility_meters USING (public.has_org_role(org_id, 'accountant'::public.organization_member_role)) WITH CHECK (public.has_org_role(org_id, 'accountant'::public.organization_member_role));
CREATE POLICY utility_readings_delete_accountant_plus_replace_only ON public.utility_readings FOR DELETE USING (public.has_org_role(org_id, 'accountant'::public.organization_member_role));
CREATE POLICY utility_readings_insert_accountant_plus ON public.utility_readings FOR INSERT WITH CHECK (public.has_org_role(org_id, 'accountant'::public.organization_member_role));
CREATE POLICY utility_readings_select_org_member ON public.utility_readings FOR SELECT USING (public.has_org_role(org_id, 'viewer'::public.organization_member_role));

-- record_utility_reading() exactly as at migration 174 (pg_dump of the 174 schema)
CREATE OR REPLACE FUNCTION public.record_utility_reading(p_meter_id uuid, p_period_month date, p_reading_date date, p_reading_value numeric, p_unit_of_measure text, p_source public.utility_reading_source DEFAULT 'manual'::public.utility_reading_source, p_document_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_replace_existing boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

COMMENT ON FUNCTION public.record_utility_reading(p_meter_id uuid, p_period_month date, p_reading_date date, p_reading_value numeric, p_unit_of_measure text, p_source public.utility_reading_source, p_document_id uuid, p_notes text, p_replace_existing boolean) IS 'The one write entry point for utility_readings. Computes consumption from the prior period''s
   reading server-side (never trusts a client-supplied value). Meter reset/rollover is NOT handled
   -- a lower-than-previous reading is stored as-is (a negative consumption value), deferred to
   future scope per the V1 gap audit rather than guessing a reset heuristic.';

-- 183's set-based helpers and 175's access helpers are unused once the policies above are back
drop function if exists public.utility_read_property_ids();
drop function if exists public.utility_write_property_ids();
drop function if exists public.utility_candidate_property_ids();
drop function if exists public.can_read_property_utilities(uuid, uuid);
drop function if exists public.can_write_property_utilities(uuid, uuid);
-- btree_gist was installed by 179 only for utility_charges_no_overlap (gone with the table).
drop extension if exists btree_gist;

-- Forget 175–183 in the migration history so `supabase db push` applies them again after a fix.
delete from supabase_migrations.schema_migrations where version between '20260101000175' and '20260101000183';
