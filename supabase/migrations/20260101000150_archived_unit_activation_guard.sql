-- Final local hardening pass (WORKLOG.md this date), Objective 2 P0 finding: the original
-- Phase H architecture added 'archived' as a real unit_status value but never taught the
-- tenancy-creation pipeline about it -- activate_lease() had no check at all, meaning a lease
-- could be activated (and rent schedules generated) against a unit that is currently archived.
-- Confirmed empirically before this fix (read the function body directly, no such check existed).
-- This migration closes that gap in the one place that actually creates real occupancy --
-- activation, not application creation (guarded separately, at the TypeScript route layer, since
-- application creation has no equivalent SECURITY DEFINER RPC to extend).

create or replace function public.activate_lease(p_lease_id uuid)
returns leases
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_lease public.leases%rowtype;
  v_property_id uuid;
  v_unit_status public.unit_status;
  v_tenant_count integer;
  v_prep public.lease_preparations%rowtype;
begin
  select * into v_lease from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Lease not found (or not visible to the caller)';
  end if;

  select property_id, status into v_property_id, v_unit_status from public.units where id = v_lease.unit_id;

  if not public.has_org_role(v_lease.org_id, 'agent') then
    raise exception 'Caller does not have permission to activate this lease';
  end if;
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'Caller does not have property-level permission to activate this lease';
  end if;

  if v_lease.status = 'active' then
    return v_lease;
  end if;

  -- Archived-unit guard (WORKLOG.md this date): an archived unit is not available for new
  -- tenancy -- restore it first. Checked after the already-active idempotency escape above so a
  -- lease that was legitimately activated before its unit was later archived never breaks on a
  -- harmless repeat call.
  -- No code: prefix here -- activate_lease()'s route (POST /api/v1/leases/:id/activate) passes
  -- error.message straight through unwrapped, same as this function's sibling messages below
  -- ("This unit already has another active lease", "Assign a tenant..."), by established
  -- convention (its own exceptions are already friendly domain text, not safeErrorMessage-wrapped).
  if v_unit_status = 'archived' then
    raise exception 'This unit is archived and is not available for a new tenancy. Restore the unit before activating this lease.';
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

comment on function public.activate_lease(uuid) is
  'Activates a draft lease (tenant assigned, rent > 0, start date set, application-sourced leases
   sent+acknowledged, unit not archived, no other active lease on the unit), generating rent
   schedules. Final local hardening pass, WORKLOG.md this date: added the archived-unit guard.';
