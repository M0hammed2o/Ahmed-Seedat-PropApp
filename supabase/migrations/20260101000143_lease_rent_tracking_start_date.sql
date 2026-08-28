-- Landlord/staff launch-hardening pass (WORKLOG.md 2026-08-26), Section 10: a confirmed real bug
-- (not hypothetical) -- generate_rent_schedules_for_lease() always anchors monthly schedule
-- generation to the lease's own historical start_date with no alternate anchor. Importing an
-- existing tenancy whose real lease started years ago and activating it today would silently
-- insert one 'pending' rent_schedules row per month all the way back to that historical date --
-- fabricated arrears for rent the landlord never actually tracked or chased through Proplyst.
--
-- Fix: a new nullable leases.rent_tracking_start_date column. NULL (the default, for every
-- existing and every normal new lease) means "anchor on start_date exactly as before -- zero
-- behaviour change". When set, it overrides start_date as the schedule-generation anchor only --
-- start_date itself is untouched and remains the legal/lease-term date shown everywhere else
-- (lease detail, expiry, reports).
--
-- activate_lease() additionally gets a safety net: activating a MANUAL (not application-approved)
-- lease whose start_date is more than 31 days in the past, with no explicit
-- rent_tracking_start_date already set, defaults the tracking anchor to the first day of the
-- current month (the spec's own "DEFAULT FOR IMPORTED LEASE: Current billing period") instead of
-- silently backdating. A full "record existing lease" form letting staff choose an explicit
-- historical-tracking date (with confirmation) is planned as a follow-up UI pass -- this migration
-- closes the actual data-safety gap now, without needing that UI to exist first: the dangerous
-- default (silent backdating) can never happen even before that form ships.

alter table public.leases add column rent_tracking_start_date date;

comment on column public.leases.rent_tracking_start_date is
  'Overrides start_date as generate_rent_schedules_for_lease()''s anchor, when set. NULL (default)
   means "use start_date exactly as before". Never changes the lease''s own legal start_date.';

create or replace function public.generate_rent_schedules_for_lease(
  p_lease_id uuid,
  p_through date default (current_date + interval '1 month')::date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease public.leases%rowtype;
  v_anchor_date date;
  v_period_count integer;
  v_due_date date;
  v_created integer := 0;
begin
  select * into v_lease from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Lease % not found', p_lease_id;
  end if;

  -- draft/expired/terminated leases never get new schedule rows -- only an active lease is
  -- expected to keep accruing rent due.
  if v_lease.status <> 'active' then
    return 0;
  end if;

  v_anchor_date := coalesce(v_lease.rent_tracking_start_date, v_lease.start_date);

  select count(*) into v_period_count from public.rent_schedules where lease_id = p_lease_id;

  loop
    v_due_date := (v_anchor_date + (v_period_count || ' months')::interval)::date;
    exit when v_due_date > p_through;
    exit when v_lease.end_date is not null and v_due_date >= v_lease.end_date;

    insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
    values (v_lease.org_id, v_lease.id, v_due_date, v_lease.rent_amount, 'pending')
    on conflict (lease_id, due_date) do nothing;

    if found then
      v_created := v_created + 1;
    end if;

    v_period_count := v_period_count + 1;
  end loop;

  return v_created;
end;
$$;

comment on function public.generate_rent_schedules_for_lease(uuid, date) is
  'Idempotently fills in every missing monthly rent_schedules row for one active lease, anchored to
   coalesce(rent_tracking_start_date, start_date), up to p_through and never at/after end_date.
   TASKS.md M10, TD-20. rent_tracking_start_date override added launch-hardening pass 2026-08-26.';

revoke execute on function public.generate_rent_schedules_for_lease(uuid, date) from public;
revoke execute on function public.generate_rent_schedules_for_lease(uuid, date) from anon, authenticated;
grant execute on function public.generate_rent_schedules_for_lease(uuid, date) to service_role;

-- === activate_lease(): safety-net default for a historical manual lease with no explicit anchor ===
create or replace function public.activate_lease(p_lease_id uuid)
returns leases
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_lease public.leases%rowtype;
  v_property_id uuid;
  v_tenant_count integer;
  v_prep public.lease_preparations%rowtype;
begin
  select * into v_lease from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Lease not found (or not visible to the caller)';
  end if;

  select property_id into v_property_id from public.units where id = v_lease.unit_id;

  if not public.has_org_role(v_lease.org_id, 'agent') then
    raise exception 'Caller does not have permission to activate this lease';
  end if;
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'Caller does not have property-level permission to activate this lease';
  end if;

  if v_lease.status = 'active' then
    return v_lease;
  end if;

  if v_lease.status <> 'draft' then
    raise exception 'Only a draft lease can be activated (current status: %)', v_lease.status;
  end if;

  select count(*) into v_tenant_count from public.lease_tenants where lease_id = p_lease_id;
  if v_tenant_count = 0 then
    raise exception 'Assign a tenant to this lease before activating it';
  end if;

  if v_lease.rent_amount <= 0 then
    raise exception 'Lease must have a rent amount greater than zero to activate';
  end if;

  if v_lease.start_date is null then
    raise exception 'Lease must have a start date to activate';
  end if;

  if v_lease.source = 'application_approved' then
    select * into v_prep from public.lease_preparations where lease_id = p_lease_id;
    if not found or v_prep.status <> 'sent' then
      raise exception 'The lease must be sent to the tenant before it can be activated';
    end if;
    if v_prep.tenant_acknowledged_at is null and v_prep.staff_confirmed_signed_at is null then
      raise exception 'The tenant must acknowledge the lease (or staff must record a signed copy) before activation';
    end if;
  end if;

  if exists (
    select 1 from public.leases
    where unit_id = v_lease.unit_id and status = 'active' and id <> p_lease_id
  ) then
    raise exception 'This unit already has another active lease';
  end if;

  -- Safety net (WORKLOG.md 2026-08-26): a manual (imported/existing) lease whose legal start_date
  -- is well in the past, with no explicit rent_tracking_start_date already chosen, must never
  -- silently backdate rent schedules to that historical date -- default the tracking anchor to
  -- the first of the current month instead. application_approved leases are never affected (their
  -- start_date is always the real, freshly-agreed start of a brand-new tenancy).
  if v_lease.source <> 'application_approved'
     and v_lease.rent_tracking_start_date is null
     and v_lease.start_date < (current_date - interval '31 days')::date then
    update public.leases
    set rent_tracking_start_date = date_trunc('month', current_date)::date
    where id = p_lease_id
    returning * into v_lease;
  end if;

  update public.leases set status = 'active' where id = p_lease_id
  returning * into v_lease;

  perform public.generate_rent_schedules_for_lease(p_lease_id);

  perform public.write_lifecycle_audit_event(
    v_lease.org_id, 'user'::public.audit_actor_type, auth.uid(), 'lease.activated', 'leases', v_lease.id,
    jsonb_build_object('unitId', v_lease.unit_id, 'startDate', v_lease.start_date, 'rentTrackingStartDate', v_lease.rent_tracking_start_date));

  return v_lease;
end;
$$;
