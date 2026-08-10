-- Owner + staff access completion pass (WORKLOG.md this date), Part 3 continued: the Staff panel
-- had no way to change a member's role or remove them at all (confirmed by grep: no route, no
-- RPC, despite organization_member_status already having a 'revoked' value since
-- 20260101000016 -- the schema anticipated this, nothing ever implemented it).

create or replace function public.update_organization_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role public.organization_member_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role public.organization_member_role;
  v_target_current_role public.organization_member_role;
begin
  if auth.uid() is null then
    raise exception 'update_organization_member_role requires an authenticated user';
  end if;

  select role into v_caller_role from public.organization_members
    where org_id = p_org_id and user_id = auth.uid() and status = 'active';
  if v_caller_role is null or v_caller_role not in ('manager', 'principal') then
    raise exception 'Only manager+ org members may change another member''s role';
  end if;

  -- Same role ceiling as create_organization_invite's app-layer MAX_INVITABLE_ROLE_FOR
  -- (PERMISSIONS.md: "manager: invite/manage agent/accountant/viewer only") -- enforced here too
  -- since editing an existing member's role is the same kind of privilege grant as inviting one.
  if v_caller_role = 'manager' and p_role in ('manager', 'principal') then
    raise exception 'A manager cannot assign the manager or principal role';
  end if;

  select role into v_target_current_role from public.organization_members
    where org_id = p_org_id and user_id = p_user_id;
  if v_target_current_role is null then
    raise exception 'Membership not found';
  end if;
  if v_caller_role = 'manager' and v_target_current_role in ('manager', 'principal') then
    raise exception 'A manager cannot change the role of a manager or principal';
  end if;

  -- Never leave an org with zero active principals.
  if v_target_current_role = 'principal' and p_role <> 'principal' then
    if (
      select count(*) from public.organization_members
      where org_id = p_org_id and role = 'principal' and status = 'active'
    ) <= 1 then
      raise exception 'This organization must always have at least one Principal';
    end if;
  end if;

  update public.organization_members set role = p_role
  where org_id = p_org_id and user_id = p_user_id;
end;
$$;

comment on function public.update_organization_member_role(uuid, uuid, public.organization_member_role) is
  'Manager+ only, with the same role-ceiling rule invite creation already enforces (a manager may
   not grant, or edit the role of, another manager or principal). Refuses to demote the last
   active Principal in an org.';

create or replace function public.revoke_organization_member(
  p_org_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role public.organization_member_role;
begin
  if auth.uid() is null then
    raise exception 'revoke_organization_member requires an authenticated user';
  end if;
  if not public.has_org_role(p_org_id, 'manager') then
    raise exception 'Only manager+ org members may remove a staff member';
  end if;

  select role into v_target_role from public.organization_members
  where org_id = p_org_id and user_id = p_user_id and status = 'active';
  if v_target_role is null then
    raise exception 'Active membership not found';
  end if;

  if v_target_role = 'principal' then
    if (
      select count(*) from public.organization_members
      where org_id = p_org_id and role = 'principal' and status = 'active'
    ) <= 1 then
      raise exception 'This organization must always have at least one Principal';
    end if;
  end if;

  update public.organization_members set status = 'revoked'
  where org_id = p_org_id and user_id = p_user_id;

  -- has_org_role() already blocks this member everywhere the instant status <> 'active' (its own
  -- WHERE clause requires it), so this is hygiene rather than the enforcement point itself --
  -- clears stale property_access rows rather than leaving them to accumulate, and means a later
  -- re-invite starts from a clean slate instead of silently inheriting old grants.
  delete from public.property_access
  where user_id = p_user_id
    and property_id in (select id from public.properties where org_id = p_org_id);
end;
$$;

comment on function public.revoke_organization_member(uuid, uuid) is
  'Manager+ only. Sets the member''s status to revoked (immediately blocking every
   has_org_role()-gated check) and clears their property_access grants in this org. Refuses to
   remove the last active Principal.';
