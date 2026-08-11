-- Overnight platform pass (WORKLOG.md this date), Phase 15 (audit/security): four staff/invite
-- RPCs shipped with zero audit_events coverage -- confirmed by grep before writing this, not
-- assumed. Re-created here with the SAME signatures as their originating migrations (089/090),
-- so this is a plain CREATE OR REPLACE, not a new overload; those migrations are not edited
-- in place (already applied to production).

create or replace function public.accept_organization_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.organization_invites%rowtype;
  v_user_email citext;
begin
  if auth.uid() is null then
    raise exception 'accept_organization_invite requires an authenticated user';
  end if;

  select email into v_user_email from auth.users where id = auth.uid();

  select * into v_invite
  from public.organization_invites
  where token = p_token
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
    and email = v_user_email
  for update;

  if not found then
    raise exception 'Invite not found, expired, or does not match the signed-in user''s email';
  end if;

  insert into public.organization_members (
    org_id, user_id, role, status, joined_at, invited_by, property_access_mode
  )
  values (
    v_invite.org_id, auth.uid(), v_invite.role, 'active', now(), v_invite.invited_by,
    v_invite.property_access_mode
  )
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = 'active', joined_at = now(),
        property_access_mode = excluded.property_access_mode;

  if v_invite.property_access_mode = 'selected' then
    insert into public.property_access (property_id, user_id, property_role, granted_by)
    select oip.property_id, auth.uid(), oip.property_role, v_invite.invited_by
    from public.organization_invite_properties oip
    where oip.invite_id = v_invite.id
    on conflict (property_id, user_id) do update
      set property_role = excluded.property_role, updated_at = now();
  end if;

  update public.organization_invites set accepted_at = now() where id = v_invite.id;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_invite.org_id, auth.uid(), 'user', 'organization_invite.accepted', 'organization_invites', v_invite.id,
    jsonb_build_object('role', v_invite.role, 'propertyAccessMode', v_invite.property_access_mode)
  );

  return v_invite.org_id;
end;
$$;

comment on function public.accept_organization_invite(uuid) is
  'Validates an invite token against the signed-in user''s own email (never against a
   client-supplied email — otherwise user A could accept an invite addressed to user B by
   guessing/leaking a token) and creates the membership row, applying whatever
   property_access_mode/selected-properties the inviting manager configured at invite time.';

create or replace function public.revoke_organization_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'revoke_organization_invite requires an authenticated user';
  end if;
  select org_id into v_org_id from public.organization_invites where id = p_invite_id;
  if v_org_id is null then
    raise exception 'Invite not found';
  end if;
  if not public.has_org_role(v_org_id, 'manager') then
    raise exception 'Only manager+ org members may revoke an organization invite';
  end if;
  update public.organization_invites
  set revoked_at = now()
  where id = p_invite_id and accepted_at is null and revoked_at is null;

  if found then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (v_org_id, auth.uid(), 'user', 'organization_invite.revoked', 'organization_invites', p_invite_id, null);
  end if;
end;
$$;

comment on function public.revoke_organization_invite(uuid) is
  'Manager+ only. Cancels a pending (not yet accepted) organization invite -- a no-op if already
   accepted or already revoked.';

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

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after)
  values (
    p_org_id, auth.uid(), 'user', 'staff.role_changed', 'organization_members', p_user_id,
    jsonb_build_object('role', v_target_current_role), jsonb_build_object('role', p_role)
  );
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

  delete from public.property_access
  where user_id = p_user_id
    and property_id in (select id from public.properties where org_id = p_org_id);

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    p_org_id, auth.uid(), 'user', 'staff.removed', 'organization_members', p_user_id,
    jsonb_build_object('previousRole', v_target_role)
  );
end;
$$;

comment on function public.revoke_organization_member(uuid, uuid) is
  'Manager+ only. Sets the member''s status to revoked (immediately blocking every
   has_org_role()-gated check) and clears their property_access grants in this org. Refuses to
   remove the last active Principal.';
