-- Owner + staff access completion pass (WORKLOG.md this date), Part 3: staff invitation UI was
-- entirely missing (confirmed by grep: POST /api/v1/organizations/:orgId/invites and
-- accept_organization_invite() -- 20260101000018/021/026 -- have worked end-to-end since before
-- this pass, complete with role-ceiling checks and a real "member_invited" email; nothing in
-- /organization/staff ever called them). This migration only adds what was genuinely missing:
-- letting an invite also carry a property_access_mode/selected-properties choice, applied at
-- acceptance time, using the exact same organization_members.property_access_mode /
-- property_access mechanism 20260101000063/084 already established -- not a second RBAC system.

alter table public.organization_invites
  add column property_access_mode public.property_access_mode not null default 'all',
  add column revoked_at timestamptz,
  -- Display-only (the invite/membership are keyed by email, never by name) -- lets the Staff
  -- panel and the invitation email greet a pending invite by name before the invitee has an
  -- account at all. Never used in any authorization decision.
  add column invitee_name text;

-- organization_invites had create+accept but no cancel path at all (confirmed by grep before
-- writing this) -- the Staff panel's "Cancel invitation" action needs one. Manager+, same floor
-- as invite creation itself.
create policy "organization_invites_update_manager_plus"
  on public.organization_invites for update
  using (public.has_org_role(org_id, 'manager'))
  with check (public.has_org_role(org_id, 'manager'));

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
end;
$$;

comment on function public.revoke_organization_invite(uuid) is
  'Manager+ only. Cancels a pending (not yet accepted) organization invite -- a no-op if already
   accepted or already revoked.';

-- Selected-properties choices captured at invite time, applied once the invite is accepted.
-- Deliberately not property_access itself (the invitee has no user_id yet at invite time).
create table public.organization_invite_properties (
  invite_id uuid not null references public.organization_invites(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  property_role public.property_role not null default 'read_only',
  primary key (invite_id, property_id)
);

alter table public.organization_invite_properties enable row level security;

create policy "organization_invite_properties_select_staff"
  on public.organization_invite_properties for select
  using (
    exists (
      select 1 from public.organization_invites oi
      where oi.id = organization_invite_properties.invite_id
        and public.has_org_role(oi.org_id, 'manager')
    )
  );

create policy "organization_invite_properties_insert_staff"
  on public.organization_invite_properties for insert
  with check (
    exists (
      select 1 from public.organization_invites oi
      join public.properties p on p.org_id = oi.org_id
      where oi.id = organization_invite_properties.invite_id
        and p.id = organization_invite_properties.property_id
        and public.has_org_role(oi.org_id, 'manager')
    )
  );

create policy "organization_invite_properties_delete_staff"
  on public.organization_invite_properties for delete
  using (
    exists (
      select 1 from public.organization_invites oi
      where oi.id = organization_invite_properties.invite_id
        and public.has_org_role(oi.org_id, 'manager')
    )
  );

-- accept_organization_invite() now also applies the invite's stored property_access_mode/selected
-- properties. Re-created with the SAME signature (accept_organization_invite(uuid)) so this is a
-- plain CREATE OR REPLACE, not a new overload.
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

  -- 'all' mode is handled entirely by the existing grant_new_member_property_access_trigger
  -- (fires on this exact insert). 'selected' mode has no trigger coverage by design (that's what
  -- "selected" means) -- apply the invite's own curated list directly. security definer, so this
  -- bypasses grant_property_access()'s manager+ caller check deliberately: the accepting user is
  -- not a manager, they're the invitee gaining exactly the access the inviting manager already
  -- authorized when they created organization_invite_properties (itself manager+-gated at
  -- creation time).
  if v_invite.property_access_mode = 'selected' then
    insert into public.property_access (property_id, user_id, property_role, granted_by)
    select oip.property_id, auth.uid(), oip.property_role, v_invite.invited_by
    from public.organization_invite_properties oip
    where oip.invite_id = v_invite.id
    on conflict (property_id, user_id) do update
      set property_role = excluded.property_role, updated_at = now();
  end if;

  update public.organization_invites set accepted_at = now() where id = v_invite.id;

  return v_invite.org_id;
end;
$$;

comment on function public.accept_organization_invite(uuid) is
  'Validates an invite token against the signed-in user''s own email (never against a
   client-supplied email — otherwise user A could accept an invite addressed to user B by
   guessing/leaking a token) and creates the membership row, applying whatever
   property_access_mode/selected-properties the inviting manager configured at invite time.';

-- Principal safety (explicit instruction): a Principal should normally always retain
-- all-properties access. Without this guard, the existing StaffAccessPanel UI lets a manager+
-- (including the Principal themselves) narrow ANY member -- including a Principal -- to
-- 'selected', which could leave an org's top-level administrator seeing zero properties if no
-- grants are curated afterward. Recoverable in principle (they still hold org 'principal' role
-- and could switch back), but confusing/risky enough to guard against outright rather than rely
-- on manual recovery.
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
declare
  v_target_role public.organization_member_role;
begin
  if auth.uid() is null then
    raise exception 'set_member_property_access_mode requires an authenticated user';
  end if;
  if not public.has_org_role(p_org_id, 'manager') then
    raise exception 'Only manager+ org members may change a member''s property access mode';
  end if;

  select role into v_target_role
  from public.organization_members
  where org_id = p_org_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Membership not found';
  end if;

  if v_target_role = 'principal' and p_mode = 'selected' then
    raise exception 'A Principal always retains all-properties access and cannot be restricted to selected properties';
  end if;

  update public.organization_members
  set property_access_mode = p_mode
  where org_id = p_org_id and user_id = p_user_id;
end;
$$;

comment on function public.set_member_property_access_mode(uuid, uuid, public.property_access_mode) is
  'Manager+ only. Switches a member between all-properties and selected-properties access.
   Refuses to narrow a Principal (organization safety: a Principal always retains all-properties
   access). Setting mode to selected does not retroactively revoke existing grants; setting mode
   to all immediately (re-)grants administrator everywhere, via the existing trigger.';
