-- Owner + staff access completion pass (WORKLOG.md this date), Part 1: secure self-linking.
--
-- Root cause of the reported bug: owner_invitations (20260101000083) links an owner record to
-- whoever holds its token, but a token/email invitation was never the right mechanism for
-- "I am the Principal who set up this org, and I'm also one of the owners" -- there is no one to
-- email, and requiring an owner to invite themselves is exactly the workflow defect reported.
-- owners.email is frequently null for precisely this case (the "Add an owner" form's email field
-- is optional, and a Principal adding themselves as an owner while setting up a property has no
-- reason to fill in their own address there).
--
-- link_owner_to_self() is a deliberate, explicit action (never triggered by email match alone --
-- CRITICAL instruction, same posture as accept_owner_invitation()) gated on:
--   - an authenticated caller (auth.uid() not null)
--   - manager+ org role on the OWNER's OWN org (same floor owners/property_owners write RLS
--     already requires -- self-linking grants no privilege a manager+ doesn't already
--     structurally hold over that org's ownership records, e.g. they could already rename this
--     exact row or reassign its percentage)
--   - the owner not already linked to a different account (atomic `for update` row lock +
--     `where user_id is null` guard -- prevents the same TOCTOU race accept_owner_invitation()
--     already guards against)
--   - if the owner record has an on-file email, it must match the caller's own authenticated
--     email (defense-in-depth beyond the org-role gate: prevents a manager from claiming a
--     specific *other* named owner's record just because that record happens to be unlinked)
--
-- An owner record with no email at all has no email signal to check -- self-linking that one
-- relies on the manager+ gate alone. This is a deliberate, disclosed trade-off, not an oversight:
-- a malicious manager already has unrestricted write access to rename/reassign any owner row in
-- their own org, so this doesn't introduce a new privilege escalation beyond that existing trust
-- boundary.
create or replace function public.link_owner_to_self(p_owner_id uuid)
returns table (success boolean, error_code text, owner_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner public.owners%rowtype;
  v_caller_email citext;
begin
  if auth.uid() is null then
    raise exception 'link_owner_to_self requires an authenticated user';
  end if;

  select * into v_owner from public.owners where id = p_owner_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;

  if not public.has_org_role(v_owner.org_id, 'manager') then
    return query select false, 'forbidden'::text, null::uuid;
    return;
  end if;

  if v_owner.user_id is not null then
    if v_owner.user_id = auth.uid() then
      -- Idempotent: re-clicking after a successful link is a no-op success, not an error.
      return query select true, null::text, v_owner.id;
      return;
    end if;
    return query select false, 'already_linked'::text, null::uuid;
    return;
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  if v_owner.email is not null and (v_caller_email is null or v_owner.email <> v_caller_email) then
    return query select false, 'email_mismatch'::text, null::uuid;
    return;
  end if;

  update public.owners set user_id = auth.uid() where id = p_owner_id and user_id is null;

  -- Same one-time backfill accept_owner_invitation() performs -- grants 'owner' property_access
  -- for every property this owner already holds a share in, so the owner portal (and any
  -- property-scoped-staff-mode narrowing) works immediately, without waiting for the next
  -- property_owners insert to fire sync_owner_property_access_trigger.
  insert into public.property_access (property_id, user_id, property_role, granted_by)
  select po.property_id, auth.uid(), 'owner', auth.uid()
  from public.property_owners po
  where po.owner_id = p_owner_id
  on conflict (property_id, user_id) do nothing;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_owner.org_id, auth.uid(), 'user', 'owner.self_linked', 'owners', p_owner_id,
    jsonb_build_object('ownerId', p_owner_id)
  );

  return query select true, null::text, p_owner_id;
end;
$$;

comment on function public.link_owner_to_self(uuid) is
  'Deliberate, explicit self-service linking of owners.user_id to the calling account -- never
   triggered by email match alone. Requires manager+ org role on the owner''s own org; if the
   owner record has an on-file email it must match the caller''s own authenticated email. Use for
   the case owner_invitations does not cover: an owner (typically the org Principal) who created
   their own org/property and needs no email invitation to prove who they are.';
