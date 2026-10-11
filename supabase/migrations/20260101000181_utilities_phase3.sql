-- Utilities Phase 3 (docs/UTILITIES_PHASE3_COMPLETION_REPORT.md): batch telemetry ingestion, opt-in telemetry
-- retention, legacy monthly readings mirrored into telemetry, estimated consumption with later true-up.
-- Additive. Service-role-only functions are revoked from anon/authenticated.

-- ============================================================
-- TD-53a: batch insert of validated telemetry (one round trip per meter batch instead of one per reading).
-- ON CONFLICT DO NOTHING covers BOTH unique keys (meter_id, read_at) and (integration_id, external_event_id),
-- so replays stay idempotent. Returns the rows actually inserted.
-- ============================================================

create or replace function public.ingest_telemetry_batch(p_rows jsonb)
returns table (id uuid, meter_id uuid, read_at timestamptz, status text)
language sql
security definer
set search_path = public
as $$
  insert into public.meter_telemetry_readings
    (org_id, property_id, meter_id, read_at, raw_value, multiplier, value, source, integration_id, external_event_id, status, status_reason)
  select r.org_id, r.property_id, r.meter_id, r.read_at, r.raw_value, r.multiplier, r.value, r.source, r.integration_id,
         r.external_event_id, r.status, r.status_reason
    from jsonb_to_recordset(p_rows) as r(
      org_id uuid, property_id uuid, meter_id uuid, read_at timestamptz, raw_value numeric, multiplier numeric, value numeric,
      source text, integration_id uuid, external_event_id text, status text, status_reason text)
  on conflict do nothing
  returning meter_telemetry_readings.id, meter_telemetry_readings.meter_id, meter_telemetry_readings.read_at, meter_telemetry_readings.status;
$$;

revoke all on function public.ingest_telemetry_batch(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_batch(jsonb) to service_role;

-- ============================================================
-- TD-53b: telemetry retention by downsampling (opt-in; the job only calls this when
-- SMART_UTILITY_TELEMETRY_RETENTION_DAYS is set, minimum 400). Older than the cutoff, each meter keeps the FIRST and
-- LAST reading of every SAST day (so any day-aligned period can still be recalculated from its boundaries) and every
-- reading a person entered, attached evidence to, or that was flagged — only routine device readings in between go.
-- Bounded per call; idempotent.
-- ============================================================

create or replace function public.downsample_meter_telemetry(p_cutoff timestamptz, p_limit integer default 50000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_cutoff > now() - interval '400 days' then
    raise exception 'Telemetry younger than 400 days is never downsampled (cutoff %)', p_cutoff;
  end if;
  with ranked as (
    select t.id,
           row_number() over (partition by t.meter_id, (t.read_at at time zone 'Africa/Johannesburg')::date order by t.read_at asc) as first_rank,
           row_number() over (partition by t.meter_id, (t.read_at at time zone 'Africa/Johannesburg')::date order by t.read_at desc) as last_rank,
           t.source, t.status, t.document_id
      from public.meter_telemetry_readings t
     where t.read_at < p_cutoff
  ), doomed as (
    select id from ranked
     where first_rank > 1 and last_rank > 1
       and source in ('device', 'simulator') and status = 'valid' and document_id is null
     limit p_limit
  )
  delete from public.meter_telemetry_readings t using doomed where t.id = doomed.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.downsample_meter_telemetry(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.downsample_meter_telemetry(timestamptz, integer) to service_role;

-- ============================================================
-- TD-54: one reading series per meter. Monthly readings captured through the legacy path (Android capture,
-- record_utility_reading(), migration 163) are mirrored into meter_telemetry_readings as unverified manual readings at
-- 12:00 SAST on the reading date, so the Utilities dashboard, municipal packs and billing see them. Corrections
-- (delete + re-insert via p_replace_existing) replace the mirror. Existing readings are backfilled.
-- ============================================================

create or replace function public.mirror_utility_reading_to_telemetry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meter public.utility_meters%rowtype;
begin
  if tg_op = 'DELETE' then
    delete from public.meter_telemetry_readings
     where meter_id = old.meter_id and source = 'manual' and external_event_id = 'utility_reading:' || old.id;
    return old;
  end if;
  select * into v_meter from public.utility_meters where id = new.meter_id;
  if not found or new.reading_value < coalesce(v_meter.value_offset, 0) then
    return new;
  end if;
  insert into public.meter_telemetry_readings
    (org_id, property_id, meter_id, read_at, raw_value, multiplier, value, source, status, verification_status,
     document_id, recorded_by, notes, external_event_id)
  values
    (v_meter.org_id, v_meter.property_id, v_meter.id,
     (new.reading_date + time '12:00') at time zone 'Africa/Johannesburg',
     round((new.reading_value - coalesce(v_meter.value_offset, 0)) / v_meter.multiplier, 4),
     v_meter.multiplier, new.reading_value, 'manual', 'valid', 'unverified',
     new.document_id, new.recorded_by, 'Monthly reading (' || to_char(new.period_month, 'YYYY-MM') || ')',
     'utility_reading:' || new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists mirror_utility_reading_insert on public.utility_readings;
create trigger mirror_utility_reading_insert after insert on public.utility_readings
  for each row execute function public.mirror_utility_reading_to_telemetry();
drop trigger if exists mirror_utility_reading_delete on public.utility_readings;
create trigger mirror_utility_reading_delete after delete on public.utility_readings
  for each row execute function public.mirror_utility_reading_to_telemetry();

insert into public.meter_telemetry_readings
  (org_id, property_id, meter_id, read_at, raw_value, multiplier, value, source, status, verification_status,
   document_id, recorded_by, notes, external_event_id)
select m.org_id, m.property_id, m.id,
       (r.reading_date + time '12:00') at time zone 'Africa/Johannesburg',
       round((r.reading_value - coalesce(m.value_offset, 0)) / m.multiplier, 4),
       m.multiplier, r.reading_value, 'manual', 'valid', 'unverified',
       r.document_id, r.recorded_by, 'Monthly reading (' || to_char(r.period_month, 'YYYY-MM') || ')',
       'utility_reading:' || r.id
  from public.utility_readings r
  join public.utility_meters m on m.id = r.meter_id
 where r.reading_value >= coalesce(m.value_offset, 0)
on conflict do nothing;

-- ============================================================
-- Estimates and true-up: a charge for a period without usable readings may be ESTIMATED (opt-in, flagged); when the
-- readings arrive, a 'true_up' charge (shortfall) or a utility credit (overcharge) settles the difference once —
-- the overlap exclusion constraint allows one live true-up per unit/utility/segment.
-- ============================================================

alter table public.utility_charges drop constraint utility_charges_charge_type_check;
alter table public.utility_charges add constraint utility_charges_charge_type_check
  check (charge_type in ('consumption', 'allocation', 'fixed', 'allowance_fee', 'excess', 'credit_applied', 'true_up'));

-- One true-up credit per estimated charge, even when two charge runs race.
create unique index if not exists utility_credits_one_true_up
  on public.utility_credits (source_charge_id)
  where reason like 'True-up%' and status <> 'cancelled';
