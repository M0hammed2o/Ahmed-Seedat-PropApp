-- Property lifecycle symmetry pass (WORKLOG.md this date): archive_unit()/restore_unit()
-- (migration 20260101000148) moved unit archiving into proper SECURITY DEFINER RPCs with the
-- business-rule guard (block if active lease) enforced in SQL. Property archiving stayed as
-- inline TypeScript logic in DELETE /api/v1/properties/:id (the pre-existing archive endpoint),
-- duplicating the same guard shape in a different layer and leaving it untestable via a direct RPC
-- integration test the way every other lifecycle function in this pass is tested. This migration
-- makes property archiving symmetric with unit archiving: one authoritative SQL guard, the route
-- becomes a thin wrapper (same shape hard_delete_property/restore_unit already are). The exact
-- user-facing message format ("<nickname> cannot be archived because Unit <label> has an active
-- lease...") is preserved byte-for-byte from the route logic it replaces.

create or replace function public.archive_property(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status public.property_status;
  v_nickname text;
  v_unit_labels text;
begin
  select org_id, status, nickname into v_org_id, v_status, v_nickname
  from public.properties where id = p_property_id;
  if v_org_id is null then
    raise exception 'not_found: Property not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'insufficient_permission: You do not have permission to archive this property.';
  end if;
  if not (
    public.has_property_access(p_property_id, 'property_manager')
    or public.has_property_access(p_property_id, 'owner')
  ) then
    raise exception 'insufficient_permission: You do not have property-level permission to archive this property.';
  end if;

  if v_status = 'archived' then
    return;
  end if;

  select string_agg(u.unit_label, ', ' order by u.unit_label)
  into v_unit_labels
  from public.leases l
  join public.units u on u.id = l.unit_id
  where u.property_id = p_property_id and l.status = 'active';

  if v_unit_labels is not null then
    raise exception 'property_has_active_leases: % cannot be archived because Unit % has an active lease. End the tenancy before archiving the property.',
      v_nickname, v_unit_labels;
  end if;

  update public.properties set status = 'archived' where id = p_property_id;
end;
$$;

comment on function public.archive_property(uuid) is
  'Archives a property (never a hard delete) after checking agent+/property_manager-or-owner
   access and blocking on any unit with an active lease. Property/unit lifecycle pass,
   WORKLOG.md this date.';

create or replace function public.restore_property(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status public.property_status;
begin
  select org_id, status into v_org_id, v_status from public.properties where id = p_property_id;
  if v_org_id is null then
    raise exception 'not_found: Property not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'insufficient_permission: You do not have permission to restore this property.';
  end if;
  if not (
    public.has_property_access(p_property_id, 'property_manager')
    or public.has_property_access(p_property_id, 'owner')
  ) then
    raise exception 'insufficient_permission: You do not have property-level permission to restore this property.';
  end if;
  if v_status <> 'archived' then
    raise exception 'property_not_archived: This property is not archived.';
  end if;
  update public.properties set status = 'active' where id = p_property_id;
end;
$$;

comment on function public.restore_property(uuid) is
  'Restores an archived property back to active. Property/unit lifecycle pass, WORKLOG.md this date.';
