-- Utilities production-readiness hardening (docs/UTILITIES_SECURITY_FINDINGS.md, docs/UTILITIES_FINANCIAL_VALIDATION.md).
-- Additive and idempotent in effect: functions are replaced, triggers/constraints added. No existing data is changed
-- (on a database with pre-existing overlapping live utility charges the exclusion constraint will refuse to build —
-- by design; no production database holds utility charges yet).

-- ============================================================
-- SEC-01: the utility read/write gates must bind the property to the row's organisation.
-- Without this, a user who is accountant+ in their OWN org and holds an owner grant on another org's property
-- could write rows with (org_id = own org, property_id = victim property).
-- ============================================================

create or replace function public.can_read_property_utilities(p_org_id uuid, p_property_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.properties p where p.id = p_property_id and p.org_id = p_org_id)
    and (
      (public.has_org_role(p_org_id, 'viewer') and public.has_property_access(p_property_id, 'read_only'))
      or public.has_property_access(p_property_id, 'owner')
    );
$$;

create or replace function public.can_write_property_utilities(p_org_id uuid, p_property_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.properties p where p.id = p_property_id and p.org_id = p_org_id)
    and public.has_org_role(p_org_id, 'accountant')
    and (
      public.has_property_access(p_property_id, 'accountant')
      or public.has_property_access(p_property_id, 'property_manager')
      or public.has_property_access(p_property_id, 'owner')
    );
$$;

-- Generic guard for tables whose RLS only checks org_id (migration 163's utility_responsibility_settings).
create or replace function public.validate_row_property_in_org()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Rows without a property (e.g. an organisation-level integration request) have nothing to bind.
  if new.property_id is not null
     and not exists (select 1 from public.properties p where p.id = new.property_id and p.org_id = new.org_id) then
    raise exception 'Property does not belong to this organisation';
  end if;
  return new;
end;
$$;

-- Every utility table that carries both org_id and property_id: the property must belong to that organisation,
-- whichever path writes the row (RLS session, SECURITY DEFINER function or service role).
do $$
declare t text;
begin
  foreach t in array array[
    'utility_responsibility_settings', 'utility_meters', 'utility_tariffs', 'utility_supply_sources', 'utility_source_logs',
    'utility_source_readings', 'utility_billing_arrangements', 'utility_allocation_groups', 'utility_allocation_members',
    'utility_charges', 'utility_charge_adjustments', 'utility_credits', 'utility_statements', 'utility_alerts',
    'meter_integrations', 'meter_telemetry_readings', 'municipal_submission_settings', 'municipal_submission_recipients',
    'municipal_submissions', 'meter_period_snapshots', 'meter_ingest_events', 'meter_integration_requests',
    'municipal_submission_deliveries', 'utility_alert_settings'
  ] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'org_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'property_id') then
      execute format('drop trigger if exists %I on public.%I', t || '_property_in_org', t);
      execute format(
        'create trigger %I before insert or update of org_id, property_id on public.%I for each row execute function public.validate_row_property_in_org()',
        t || '_property_in_org', t);
    end if;
  end loop;
end $$;

-- ============================================================
-- SEC-04: reading evidence must be a document of the same organisation and property as the meter.
-- ============================================================

create or replace function public.validate_utility_reading_document()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.document_id is not null and not exists (
    select 1
      from public.documents d
      join public.utility_meters m on m.id = new.meter_id
     where d.id = new.document_id and d.org_id = m.org_id and d.property_id = m.property_id
  ) then
    raise exception 'Evidence document does not belong to this meter''s property';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_utility_reading_document_trigger on public.utility_readings;
create trigger validate_utility_reading_document_trigger before insert or update of document_id on public.utility_readings
  for each row execute function public.validate_utility_reading_document();

-- ============================================================
-- Scope: tariff units belong to the tariff's property; a source's sensor integration belongs to the same property;
-- a shared-meter group can only split a CONSUMPTION meter (generation, battery, export, pump or source meters are
-- never billable).
-- ============================================================

drop trigger if exists validate_utility_tariffs_scope on public.utility_tariffs;
create trigger validate_utility_tariffs_scope before insert or update on public.utility_tariffs
  for each row execute function public.validate_utility_scope_links();

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
    if not exists (select 1 from public.utility_meters m where m.id = new.meter_id and m.measurement_kind = 'consumption') then
      raise exception 'Only a consumption meter can be shared between units';
    end if;
  elsif tg_table_name = 'utility_allocation_members' then
    if not exists (select 1 from public.utility_allocation_groups g where g.id = new.group_id and g.property_id = new.property_id) then
      raise exception 'Group does not belong to this property';
    end if;
  elsif tg_table_name = 'utility_supply_sources' then
    if new.integration_id is not null and not exists (
      select 1 from public.meter_integrations i where i.id = new.integration_id and i.org_id = new.org_id and i.property_id = new.property_id
    ) then
      raise exception 'Integration does not belong to this property';
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

-- ============================================================
-- FIN-01/FIN-03: never two live charges of the same type for the same unit, utility and overlapping dates —
-- regardless of meter (replacement chains), arrangement (mid-period changes) or lease. Database-enforced so a
-- re-run, a concurrent run or a code path we have not thought of cannot double-bill.
-- ============================================================

create extension if not exists btree_gist with schema extensions;

-- The 178 live-charge key had no segment date, so a period split at a tariff change (two pieces, same meter and
-- lease) collided and the second piece was silently skipped. Include the segment start; overlap is now prevented
-- by the exclusion constraint below.
drop index if exists public.utility_charges_live_unique_idx;
create unique index utility_charges_live_unique_idx on public.utility_charges (
  coalesce(meter_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(arrangement_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(lease_id, '00000000-0000-0000-0000-000000000000'::uuid),
  period_start,
  coalesce(segment_start, period_start),
  charge_type
) where status <> 'void';

alter table public.utility_charges
  add constraint utility_charges_no_overlap exclude using gist (
    unit_id with =,
    utility_type with =,
    charge_type with =,
    daterange(coalesce(segment_start, period_start), coalesce(segment_end, period_end), '[)') with &&
  ) where (status <> 'void' and unit_id is not null);

-- ============================================================
-- FIN-06: voiding or deleting an invoice releases its utility charges back to "approved" (with the invoice link
-- cleared) so they can be corrected or invoiced again; previously they stayed "invoiced" forever.
-- ============================================================

create or replace function public.release_utility_charges_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  v_org_id uuid := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  v_count integer;
begin
  if tg_op = 'UPDATE' and not (old.voided_at is null and new.voided_at is not null) then
    return new;
  end if;
  update public.utility_charges
     set status = 'approved', invoice_id = null
   where invoice_id = v_invoice_id and status = 'invoiced';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.write_lifecycle_audit_event(
      v_org_id, 'system', auth.uid(), 'utility_charges.released_from_invoice', 'invoices', v_invoice_id,
      jsonb_build_object('charges', v_count, 'reason', lower(tg_op))
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists release_utility_charges_on_invoice_void on public.invoices;
create trigger release_utility_charges_on_invoice_void after update of voided_at on public.invoices
  for each row execute function public.release_utility_charges_from_invoice();
drop trigger if exists release_utility_charges_on_invoice_delete on public.invoices;
create trigger release_utility_charges_on_invoice_delete before delete on public.invoices
  for each row execute function public.release_utility_charges_from_invoice();

-- ============================================================
-- JOB-01: reading counts per meter for the "missing readings" alert, computed in SQL. Counting rows through the
-- API was capped at the 1,000-row response limit, so busy meters looked like they were missing readings.
-- ============================================================

create or replace function public.utility_reading_counts_since(p_since timestamptz, p_meter_ids uuid[])
returns table (meter_id uuid, readings bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.meter_id, count(*)
    from public.meter_telemetry_readings t
   where t.meter_id = any (p_meter_ids) and t.read_at >= p_since
   group by t.meter_id;
$$;

revoke all on function public.utility_reading_counts_since(timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.utility_reading_counts_since(timestamptz, uuid[]) to service_role;
