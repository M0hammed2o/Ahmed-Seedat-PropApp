-- Shared-access architecture pass (WORKLOG.md this date), Phase 3: the "ALL PROPERTIES vs
-- SELECTED PROPERTIES" switch the staff-scoping UI needs. Today every active org member is
-- auto-granted 'administrator' property_access on every property (20260101000063/064 triggers) --
-- deliberately, as a zero-regression bridge until this exact feature existed. This migration adds
-- the off-switch without changing that default: property_access_mode defaults to 'all', so no
-- existing member's access changes when this ships. An admin narrows a specific member to
-- 'selected' through the new set_member_property_access_mode() RPC below, then uses the
-- already-existing grant_property_access()/revoke_property_access() (20260101000063) to curate
-- exactly which properties/roles that member holds.

create type public.property_access_mode as enum ('all', 'selected');

alter table public.organization_members
  add column property_access_mode public.property_access_mode not null default 'all';

comment on column public.organization_members.property_access_mode is
  '''all'' (default, preserves pre-existing behaviour): this member is auto-granted administrator
   access to every current and future property in the org. ''selected'': the two auto-grant
   triggers skip this member entirely -- their property_access rows are curated one at a time via
   grant_property_access()/revoke_property_access().';

-- Both auto-grant triggers now skip a 'selected'-mode member -- the only behavioural change this
-- migration makes, and only for members an admin has deliberately opted in to narrowing.
create or replace function public.grant_org_members_property_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.property_access (property_id, user_id, property_role, granted_by)
  select new.id, om.user_id, 'administrator', coalesce(auth.uid(), om.user_id)
  from public.organization_members om
  where om.org_id = new.org_id and om.status = 'active' and om.property_access_mode = 'all'
  on conflict (property_id, user_id) do nothing;
  return new;
end;
$$;

create or replace function public.grant_new_member_property_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and new.property_access_mode = 'all'
     and (tg_op = 'INSERT' or old.status is distinct from 'active' or old.property_access_mode is distinct from 'all') then
    insert into public.property_access (property_id, user_id, property_role, granted_by)
    select p.id, new.user_id, 'administrator', coalesce(auth.uid(), new.user_id)
    from public.properties p
    where p.org_id = new.org_id
    on conflict (property_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.grant_new_member_property_access() is
  'Fires on INSERT, on reactivation (status -> active), and on mode -> all -- the last case is what
   lets an admin switch a narrowed member back to "all properties" and have it take effect
   immediately, matching the UI action "Access: All properties" being a single toggle, not a
   47-property multi-select.';

-- Explicit RPC, not a bare client UPDATE on organization_members -- same "who can change access
-- belongs in one trusted place" reasoning grant_property_access() itself already documents.
-- Setting mode to 'selected' does NOT retroactively revoke existing grants (an admin narrowing a
-- trusted long-time member should not instantly lock them out of everything they were already
-- using -- they curate deliberately afterward via revoke_property_access()); setting mode to
-- 'all' DOES immediately (re-)grant administrator everywhere, via the trigger above.
create or replace function public.set_member_property_access_mode(
  p_org_id uuid,
  p_user_id uuid,
  p_mode public.property_access_mode
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'set_member_property_access_mode requires an authenticated user';
  end if;
  if not public.has_org_role(p_org_id, 'manager') then
    raise exception 'Only manager+ org members may change a member''s property access mode';
  end if;

  update public.organization_members
  set property_access_mode = p_mode
  where org_id = p_org_id and user_id = p_user_id;

  if not found then
    raise exception 'Membership not found';
  end if;
end;
$$;

comment on function public.set_member_property_access_mode(uuid, uuid, public.property_access_mode) is
  'Manager+ only. Switches a member between all-properties and selected-properties access. The
   grant_new_member_property_access trigger reacts to the mode -> all transition; narrowing to
   selected leaves existing grants in place for the admin to curate explicitly.';

-- property_owners write cutover: ownership editing is sensitive (Stage-brief: "ownership.manage...
-- may require separate permissions") -- today it only requires generic org agent+, same as
-- editing a unit label. Requires an elevated property_role (owner or administrator), same
-- shape as every other property-scoped write policy this codebase already established
-- (properties/units/leases/documents/maintenance_tickets). SELECT stays org-viewer-scoped
-- (ownership.view is not being restricted further here -- unchanged).
drop policy if exists "property_owners_write_agent_plus" on public.property_owners;

create policy "property_owners_write_agent_plus_and_property_access"
  on public.property_owners for all
  using (
    exists (
      select 1 from public.owners o
      where o.id = property_owners.owner_id
        and public.has_org_role(o.org_id, 'agent')
        and (public.has_property_access(property_owners.property_id, 'owner') or public.has_property_access(property_owners.property_id, 'administrator'))
    )
  )
  with check (
    exists (
      select 1 from public.owners o
      where o.id = property_owners.owner_id
        and public.has_org_role(o.org_id, 'agent')
        and (public.has_property_access(property_owners.property_id, 'owner') or public.has_property_access(property_owners.property_id, 'administrator'))
    )
  );

-- applications RLS cutover -- never gated on property_access before this (grepped and confirmed:
-- only has_org_role, unlike leases/units it directly created leases for). Same shape as
-- leases_access_cutover (20260101000066): agent+ org role AND property_manager/owner property
-- role for writes; viewer + read_only for select, with the same owner-portal OR-branch
-- 20260101000072 already added to every sibling table (a real owner should be able to see
-- applications against their own property, not just leases/units/documents).
drop policy if exists "applications_select_org_member" on public.applications;
drop policy if exists "applications_write_agent_plus" on public.applications;

create policy "applications_select_staff_or_owner"
  on public.applications for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'))
    or public.has_property_access(property_id, 'owner')
  );

create policy "applications_write_agent_plus_and_property_access"
  on public.applications for all
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  );

-- activate_lease()/end_lease() (20260101000078) are security definer -- they bypass leases' own
-- RLS write policy entirely, so they need their own explicit has_property_access check to actually
-- enforce property isolation once staff narrowing (this migration) is a real, reachable state.
-- Not a behavioural change for anyone still in 'all' mode (has_property_access already returns
-- true for them on every property in their org).
create or replace function public.activate_lease(p_lease_id uuid)
returns public.leases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease public.leases%rowtype;
  v_property_id uuid;
  v_tenant_count integer;
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

  if exists (
    select 1 from public.leases
    where unit_id = v_lease.unit_id and status = 'active' and id <> p_lease_id
  ) then
    raise exception 'This unit already has another active lease';
  end if;

  update public.leases set status = 'active' where id = p_lease_id
  returning * into v_lease;

  perform public.generate_rent_schedules_for_lease(p_lease_id);

  return v_lease;
end;
$$;

comment on function public.activate_lease(uuid) is
  'Validates (org role, property-level role, tenant assigned, rent > 0, start_date set, no other
   active lease on the unit) then flips a draft lease to active and generates its first
   rent-schedule pass. Idempotent re-call on an already-active lease is a no-op. Security definer
   solely to reach the service-role-locked generate_rent_schedules_for_lease() for this one
   caller-scoped lease.';

create or replace function public.end_lease(p_lease_id uuid, p_status public.lease_status)
returns public.leases
language plpgsql
as $$
declare
  v_lease public.leases%rowtype;
  v_property_id uuid;
begin
  if p_status not in ('expired', 'terminated') then
    raise exception 'end_lease can only set status to expired or terminated (got %)', p_status;
  end if;

  select * into v_lease from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Lease not found (or not visible to the caller)';
  end if;

  select property_id into v_property_id from public.units where id = v_lease.unit_id;

  if not public.has_org_role(v_lease.org_id, 'agent') then
    raise exception 'Caller does not have permission to end this lease';
  end if;
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'Caller does not have property-level permission to end this lease';
  end if;

  if v_lease.status <> 'active' then
    raise exception 'Only an active lease can be ended (current status: %)', v_lease.status;
  end if;

  update public.leases set status = p_status where id = p_lease_id
  returning * into v_lease;

  return v_lease;
end;
$$;

comment on function public.end_lease(uuid, public.lease_status) is
  'Validated draft-free transition from active to expired/terminated, gated on both org role and
   property-level role. Not security definer for the update itself -- the caller''s own agent+ RLS
   rights on leases already cover the write; the explicit checks above exist because end_lease()
   is still the trusted decision point regardless.';
