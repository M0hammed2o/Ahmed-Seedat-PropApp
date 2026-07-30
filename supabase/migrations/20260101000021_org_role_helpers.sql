-- Org-role-rank helper, mirroring the is_admin() pattern from 20260101000003_admin_users.sql:
-- security definer so it can read organization_members without the caller needing their own
-- SELECT policy on every row, while still requiring the caller to actually hold that
-- membership (checked via auth.uid()) for the check to return true. See PERMISSIONS.md §2 for
-- the role-rank semantics this encodes.

create or replace function public.has_org_role(target_org_id uuid, min_role public.organization_member_role default 'viewer')
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.org_id = target_org_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and (
        case min_role
          when 'viewer' then true
          when 'accountant' then om.role in ('accountant', 'manager', 'principal')
          when 'agent' then om.role in ('agent', 'manager', 'principal')
          when 'manager' then om.role in ('manager', 'principal')
          when 'principal' then om.role = 'principal'
        end
      )
  );
$$;

comment on function public.has_org_role(uuid, public.organization_member_role) is
  'True if the calling authenticated user holds an active membership in target_org_id at or
   above min_role. Note "accountant" and "agent" are siblings, not ranked against each other
   (PERMISSIONS.md §2 table) — each min_role check lists exactly the roles the calling code
   actually intends to allow, not a single total order. Used by API route handlers and by RLS
   policies that need role granularity beyond plain org membership (e.g. only accountant+ can
   post journal entries).';

-- Deferred from 20260101000017_organizations.sql: only principal/manager may update the
-- compliance profile, and this policy could not exist until has_org_role() (and the
-- organization_members table it reads) existed.
create policy "organizations_update_manager_plus"
  on public.organizations for update
  using (public.has_org_role(id, 'manager'))
  with check (public.has_org_role(id, 'manager'));

-- Org creation RPC: creates the organizations row and the creator's principal membership row
-- in one transaction, so an organizations row can never exist with zero members (the invariant
-- DATABASE.md §2 relies on). Security definer because the creating user has no organization_members
-- row yet at the moment of the call — a plain client INSERT under RLS couldn't satisfy the
-- eventual "organizations_select_member" policy on its own row until after this function runs.
create or replace function public.create_organization(
  p_legal_name text,
  p_org_type public.organization_type default 'owner_managed'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'create_organization requires an authenticated user';
  end if;

  insert into public.organizations (legal_name, org_type)
  values (p_legal_name, p_org_type)
  returning id into v_org_id;

  insert into public.organization_members (org_id, user_id, role, status, joined_at)
  values (v_org_id, auth.uid(), 'principal', 'active', now());

  return v_org_id;
end;
$$;

comment on function public.create_organization(text, public.organization_type) is
  'Atomically creates an organization and its first (principal) member — the only sanctioned
   way to create an organizations row. Never insert into organizations directly from a client.';

-- Invite-acceptance RPC: the accepting user is, by definition, not yet a member of the org at
-- the moment they call this, so membership-row creation must be security-definer here too.
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
    and expires_at > now()
    and email = v_user_email
  for update;

  if not found then
    raise exception 'Invite not found, expired, or does not match the signed-in user''s email';
  end if;

  insert into public.organization_members (org_id, user_id, role, status, joined_at, invited_by)
  values (v_invite.org_id, auth.uid(), v_invite.role, 'active', now(), v_invite.invited_by)
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = 'active', joined_at = now();

  update public.organization_invites set accepted_at = now() where id = v_invite.id;

  return v_invite.org_id;
end;
$$;

comment on function public.accept_organization_invite(uuid) is
  'Validates an invite token against the signed-in user''s own email (never against a
   client-supplied email — otherwise user A could accept an invite addressed to user B by
   guessing/leaking a token) and creates the membership row.';
