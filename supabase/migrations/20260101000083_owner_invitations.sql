-- Shared-access architecture pass (WORKLOG.md this date), Phase 1: secure owner<->account
-- linking. `owners.user_id` (migration 20260101000022) has existed since before the owner portal
-- was built, but nothing anywhere has ever written to it -- grepped the whole codebase before
-- writing this, confirmed not assumed. This is a deliberate mirror of tenant_invitations
-- (20260101000059)'s exact, already-proven pattern: hashed token, atomic accept RPC, generic
-- (never PII-disclosing) error codes, one active invitation per owner, no email-alone linking.
-- Kept as its own table rather than merged into tenant_invitations or organization_invites --
-- same reasoning tenant_invitations itself documents: an owner invitation links an
-- ALREADY-EXISTING `owners` row to an auth identity (unlike organization_invites, which grants a
-- role to someone who may not exist as a row anywhere yet).

-- 'whatsapp' deliberately omitted, unlike tenant_invitation_delivery_channel -- there is no
-- pre-approved WhatsApp Business template for an owner invitation (tenant_invitation has one).
-- Adding the enum value later is a one-line additive migration once that template exists; email
-- and manual (staff copies the link themselves) cover every real delivery need today.
create type public.owner_invitation_delivery_channel as enum ('email', 'manual');

create table public.owner_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  token_hash text not null unique,
  delivery_channel public.owner_invitation_delivery_channel not null,
  destination_hint text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by_user_id uuid references auth.users(id),
  revoked_at timestamptz,
  created_by_user_id uuid not null references auth.users(id),
  resend_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index owner_invitations_org_idx on public.owner_invitations (org_id);
create index owner_invitations_owner_idx on public.owner_invitations (owner_id);
create index owner_invitations_expires_idx
  on public.owner_invitations (expires_at) where accepted_at is null and revoked_at is null;

create unique index owner_invitations_one_active_per_owner
  on public.owner_invitations (owner_id)
  where accepted_at is null and revoked_at is null;

create or replace function public.check_owner_invitation_org_match()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.owners o where o.id = new.owner_id and o.org_id = new.org_id) then
    raise exception 'owner_invitations.org_id must match owner_invitations.owner_id''s own org_id';
  end if;
  return new;
end;
$$;

create trigger owner_invitations_org_match_check
  before insert or update on public.owner_invitations
  for each row execute function public.check_owner_invitation_org_match();

alter table public.owner_invitations enable row level security;

-- Staff (agent+, same floor as tenant_invitations) manage invitations for their own org's
-- owners. The invitee gets zero direct table access -- acceptance is exclusively through
-- accept_owner_invitation() below.
create policy "owner_invitations_select_staff"
  on public.owner_invitations for select
  using (public.has_org_role(org_id, 'agent'));

create policy "owner_invitations_insert_staff"
  on public.owner_invitations for insert
  with check (public.has_org_role(org_id, 'agent'));

create policy "owner_invitations_update_staff"
  on public.owner_invitations for update
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

create or replace function public.create_owner_invitation(
  p_owner_id uuid,
  p_delivery_channel public.owner_invitation_delivery_channel,
  p_destination_hint text default null
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
  v_token text;
  v_id uuid;
  v_expires_at timestamptz;
begin
  select org_id into v_org_id from public.owners where id = p_owner_id;
  if v_org_id is null then
    raise exception 'Owner not found';
  end if;

  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Only agent-or-above staff can create an owner invitation';
  end if;

  update public.owner_invitations
    set revoked_at = now()
    where owner_id = p_owner_id and accepted_at is null and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires_at := now() + interval '7 days';

  insert into public.owner_invitations (
    org_id, owner_id, token_hash, delivery_channel, destination_hint, expires_at, created_by_user_id
  )
  values (
    v_org_id, p_owner_id, encode(digest(v_token, 'sha256'), 'hex'),
    p_delivery_channel, p_destination_hint, v_expires_at, auth.uid()
  )
  returning id into v_id;

  return query select v_id, v_token, v_expires_at;
end;
$$;

comment on function public.create_owner_invitation(uuid, public.owner_invitation_delivery_channel, text) is
  'Issues (and returns, plaintext, exactly once) a token linking an existing owners row to whoever
   accepts it. Revokes any prior active invitation for the same owner first.';

create or replace function public.regenerate_owner_invitation(
  p_owner_id uuid,
  p_delivery_channel public.owner_invitation_delivery_channel,
  p_destination_hint text default null
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language sql
security definer
set search_path = public, extensions
as $$
  select * from public.create_owner_invitation(p_owner_id, p_delivery_channel, p_destination_hint);
$$;

create or replace function public.revoke_owner_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.owner_invitations where id = p_invitation_id;
  if v_org_id is null then
    raise exception 'Invitation not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Only agent-or-above staff can revoke an owner invitation';
  end if;
  update public.owner_invitations set revoked_at = now() where id = p_invitation_id and revoked_at is null and accepted_at is null;
end;
$$;

-- Atomic, idempotent acceptance -- returns a result row rather than raising for every
-- expected/recoverable failure, same reasoning accept_tenant_invitation() documents (a raised
-- exception rolls back everything in the same call, including any attempt tracking).
--
-- CRITICAL (explicit instruction): matching a caller's email against owners.email is NEVER, by
-- itself, sufficient to link an account -- only possession of the token (delivered out-of-band by
-- staff, exactly like tenant invitations) proves the caller is the intended person. Where the
-- owner record has an on-file email AND the caller's authenticated email differs, acceptance is
-- refused (same "email_mismatch" posture as tenant invitations) -- but a token with no on-file
-- owner email at all is still accepted (an owner captured with no email yet, invited by phone/
-- WhatsApp/in person), since the token itself is already the sole proof of authorization here.
create or replace function public.accept_owner_invitation(
  p_token text
)
returns table (success boolean, error_code text, owner_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.owner_invitations%rowtype;
  v_owner public.owners%rowtype;
  v_org public.organizations%rowtype;
  v_caller_email citext;
begin
  if auth.uid() is null then
    raise exception 'accept_owner_invitation requires an authenticated user';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  select * into v_invite from public.owner_invitations
    where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    for update;

  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;

  if v_invite.revoked_at is not null then
    return query select false, 'revoked'::text, null::uuid;
    return;
  end if;
  if v_invite.expires_at <= now() then
    return query select false, 'expired'::text, null::uuid;
    return;
  end if;

  if v_invite.accepted_at is not null then
    if v_invite.accepted_by_user_id = auth.uid() then
      return query select true, null::text, v_invite.owner_id;
      return;
    end if;
    return query select false, 'already_used'::text, null::uuid;
    return;
  end if;

  select * into v_owner from public.owners where id = v_invite.owner_id;
  select * into v_org from public.organizations where id = v_invite.org_id;

  if v_org.status = 'archived' then
    return query select false, 'org_inactive'::text, null::uuid;
    return;
  end if;
  if v_owner.user_id is not null and v_owner.user_id <> auth.uid() then
    return query select false, 'already_linked'::text, null::uuid;
    return;
  end if;
  if v_owner.email is not null and v_caller_email is not null and v_owner.email <> v_caller_email then
    return query select false, 'email_mismatch'::text, null::uuid;
    return;
  end if;

  update public.owners set user_id = auth.uid() where id = v_invite.owner_id;
  update public.owner_invitations set accepted_at = now(), accepted_by_user_id = auth.uid() where id = v_invite.id;

  -- Grant 'owner' property_access for every property this owner already holds a share in, so
  -- the owner portal works immediately on acceptance -- mirrors the one-time backfill
  -- 20260101000063 did for owners who already had a user_id at that migration's time, now applied
  -- live for this newly-linked one. on conflict do nothing preserves a broader existing grant
  -- (e.g. this same person is also org staff with 'administrator') rather than narrowing it.
  insert into public.property_access (property_id, user_id, property_role, granted_by)
  select po.property_id, auth.uid(), 'owner', auth.uid()
  from public.property_owners po
  where po.owner_id = v_invite.owner_id
  on conflict (property_id, user_id) do nothing;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_invite.org_id, auth.uid(), 'user', 'owner_invitation.accepted', 'owner_invitations', v_invite.id,
    jsonb_build_object('ownerId', v_invite.owner_id, 'deliveryChannel', v_invite.delivery_channel)
  );

  return query select true, null::text, v_invite.owner_id;
end;
$$;

comment on function public.accept_owner_invitation(text) is
  'Atomic, idempotent owner-invitation acceptance. Links owners.user_id to the authenticated
   caller and grants owner-role property_access for every property they already own a share of.
   Never links based on email alone -- token possession is the only proof of authorization.
   error_code values: not_found, expired, revoked, already_used, org_inactive, already_linked,
   email_mismatch.';

-- Ongoing sync (not just at invitation-acceptance time): whenever a property_owners row is
-- inserted for an owner who ALREADY has a linked account (e.g. ownership is added to an
-- already-invited owner later, for a different property), grant them 'owner' property_access on
-- that property too -- without this, only the properties owned AT THE MOMENT of invitation
-- acceptance would ever get a grant.
create or replace function public.sync_owner_property_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id from public.owners where id = new.owner_id;
  if v_user_id is not null then
    insert into public.property_access (property_id, user_id, property_role, granted_by)
    values (new.property_id, v_user_id, 'owner', coalesce(auth.uid(), v_user_id))
    on conflict (property_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.sync_owner_property_access() is
  'Keeps a linked owner''s property_access grants in sync with property_owners going forward --
   companion to accept_owner_invitation()''s own one-time grant at acceptance.';

create trigger sync_owner_property_access_trigger
  after insert on public.property_owners
  for each row execute function public.sync_owner_property_access();
