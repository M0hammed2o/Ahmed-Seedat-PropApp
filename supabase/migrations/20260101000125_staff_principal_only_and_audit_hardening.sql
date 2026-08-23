-- Staff security + audit hardening pass (this date), following a real production walkthrough
-- that exposed a Manager reaching /organization/staff and administering staff there -- not
-- permitted under the V1 permission model. Staff & Property Access and Billing & Subscription
-- must both be Principal-only. Billing was already principal-only end-to-end (every
-- .../billing/* route already uses has_billing_principal_access()) -- this migration closes the
-- SAME gap for staff administration, at every layer the audit found it: RPC floor, RLS policy,
-- and (application-layer, see the accompanying TypeScript changes) route/page/nav.
--
-- Does NOT touch: organization_members' own general "viewer can see the roster" SELECT policy
-- (organization_members_select_same_org) -- seeing who's on the team is a normal, broad,
-- pre-existing capability unrelated to staff ADMINISTRATION, and several legitimate features
-- (e.g. assignee pickers) may depend on it; narrowing it was not asked for and risks an
-- unintended regression. Does NOT touch property_access/organization_invites SELECT beyond what's
-- explicitly named below. Does NOT touch accept_organization_invite() (the invitee accepting
-- their OWN invite) or activate_staff_provision() (the employee activating their OWN account) --
-- both operate on the caller's own identity via auth.uid() alone, not "administering staff".

-- ============================================================================================
-- 1) RPC floor: manager+ -> principal-only, for every STAFF-ADMINISTRATION RPC.
-- ============================================================================================

create or replace function public.provision_staff_member(
  p_org_id uuid,
  p_email citext,
  p_full_name text,
  p_role public.organization_member_role,
  p_property_access_mode public.property_access_mode,
  p_selected_properties jsonb default '[]'::jsonb
)
returns table (
  is_existing_active_user boolean,
  auth_user_id uuid,
  provision_id uuid,
  membership_activated boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role public.organization_member_role;
  v_target_auth_id uuid;
  v_target_has_password boolean;
  v_seat_limit integer;
  v_current_count integer;
  v_provision_id uuid;
begin
  if auth.uid() is null then
    raise exception 'provision_staff_member requires an authenticated user';
  end if;
  if p_role = 'principal' then
    raise exception 'Principal cannot be assigned through staff provisioning';
  end if;
  if p_property_access_mode = 'selected' and jsonb_array_length(p_selected_properties) = 0 then
    raise exception 'Select at least one property, or choose All properties.';
  end if;

  select role into v_caller_role from public.organization_members
    where org_id = p_org_id and user_id = auth.uid() and status = 'active';
  -- Staff security hardening (this date): the manager+ ceiling logic this used to have (a manager
  -- could provision agent/accountant/viewer but not manager/principal) is now moot -- staff
  -- administration is principal-only, full stop, not a ranked ceiling. A Manager's own operational
  -- abilities elsewhere (properties/tenants/leases, via property_access) are entirely unaffected.
  if v_caller_role is null or v_caller_role <> 'principal' then
    raise exception 'Only the organization principal may provision staff';
  end if;

  if not public.org_commercially_active(p_org_id) then
    raise exception 'org_not_commercially_active: this organization has not completed billing setup yet';
  end if;

  perform 1 from public.organizations where id = p_org_id for update;

  select id, (encrypted_password is not null and encrypted_password <> '')
    into v_target_auth_id, v_target_has_password
    from auth.users where email = p_email;

  v_seat_limit := public.org_staff_seat_limit(p_org_id);
  v_current_count := public.org_active_billable_staff_count(p_org_id);

  if v_target_auth_id is not null and v_target_has_password then
    if v_seat_limit is not null and v_current_count >= v_seat_limit then
      raise exception 'staff_seat_limit_reached: this organization has no remaining staff seats available.';
    end if;

    insert into public.organization_members (
      org_id, user_id, role, status, joined_at, invited_by, property_access_mode
    )
    values (p_org_id, v_target_auth_id, p_role, 'active', now(), auth.uid(), p_property_access_mode)
    on conflict (org_id, user_id) do update
      set role = excluded.role, status = 'active', joined_at = now(),
          property_access_mode = excluded.property_access_mode;

    if p_property_access_mode = 'selected' then
      insert into public.property_access (property_id, user_id, property_role, granted_by)
      select (elem->>'propertyId')::uuid, v_target_auth_id, (elem->>'propertyRole')::public.property_role, auth.uid()
      from jsonb_array_elements(p_selected_properties) as elem
      on conflict (property_id, user_id) do update
        set property_role = excluded.property_role, updated_at = now();
    end if;

    insert into public.organization_staff_provisions (
      org_id, email, full_name, role, property_access_mode, invited_by, auth_user_id, status, activated_at
    )
    values (p_org_id, p_email, p_full_name, p_role, p_property_access_mode, auth.uid(), v_target_auth_id, 'activated', now())
    returning id into v_provision_id;

    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after, actor_role)
    values (p_org_id, auth.uid(), 'user', 'staff.provisioned_existing_user', 'organization_members', v_target_auth_id,
      jsonb_build_object('role', p_role, 'propertyAccessMode', p_property_access_mode), v_caller_role);

    return query select true, v_target_auth_id, v_provision_id, true;
  else
    if v_seat_limit is not null and v_current_count >= v_seat_limit then
      raise exception 'staff_seat_limit_reached: this organization has no remaining staff seats available.';
    end if;

    insert into public.organization_staff_provisions (
      org_id, email, full_name, role, property_access_mode, invited_by, auth_user_id, status
    )
    values (p_org_id, p_email, p_full_name, p_role, p_property_access_mode, auth.uid(), v_target_auth_id, 'pending')
    returning id into v_provision_id;

    if p_property_access_mode = 'selected' then
      insert into public.organization_staff_provision_properties (provision_id, property_id, property_role)
      select v_provision_id, (elem->>'propertyId')::uuid, (elem->>'propertyRole')::public.property_role
      from jsonb_array_elements(p_selected_properties) as elem;
    end if;

    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after, actor_role)
    values (p_org_id, auth.uid(), 'user', 'staff.provision_created', 'organization_staff_provisions', v_provision_id,
      jsonb_build_object('email', p_email, 'role', p_role, 'propertyAccessMode', p_property_access_mode), v_caller_role);

    return query select false, v_target_auth_id, v_provision_id, false;
  end if;
end;
$function$;

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
  if not public.has_org_role(v_org_id, 'principal') then
    raise exception 'Only the organization principal may revoke an organization invite';
  end if;
  update public.organization_invites
  set revoked_at = now()
  where id = p_invite_id and accepted_at is null and revoked_at is null;

  if found then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after, actor_role)
    values (v_org_id, auth.uid(), 'user', 'organization_invite.revoked', 'organization_invites', p_invite_id, null, 'principal');
  end if;
end;
$$;

comment on function public.revoke_organization_invite(uuid) is
  'Principal-only (staff security hardening, this date -- was manager+). Cancels a pending (not
   yet accepted) organization invite -- a no-op if already accepted or already revoked.';

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
  if v_caller_role is null or v_caller_role <> 'principal' then
    raise exception 'Only the organization principal may change another member''s role';
  end if;

  -- Principal row safety (this date): the Principal's own row is not an ordinary editable staff
  -- row -- no self-service demotion via this generic role-change action. A future explicit
  -- ownership-transfer workflow is a separate, deliberate feature, not this one.
  if p_user_id = auth.uid() then
    raise exception 'Use a dedicated ownership-transfer workflow to change your own role';
  end if;

  select role into v_target_current_role from public.organization_members
    where org_id = p_org_id and user_id = p_user_id;
  if v_target_current_role is null then
    raise exception 'Membership not found';
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

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after, actor_role)
  values (
    p_org_id, auth.uid(), 'user', 'staff.role_changed', 'organization_members', p_user_id,
    jsonb_build_object('role', v_target_current_role), jsonb_build_object('role', p_role), v_caller_role
  );
end;
$$;

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
  v_caller_role public.organization_member_role;
  v_target_role public.organization_member_role;
begin
  if auth.uid() is null then
    raise exception 'revoke_organization_member requires an authenticated user';
  end if;

  select role into v_caller_role from public.organization_members
    where org_id = p_org_id and user_id = auth.uid() and status = 'active';
  if v_caller_role is null or v_caller_role <> 'principal' then
    raise exception 'Only the organization principal may remove a staff member';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Use a dedicated ownership-transfer workflow to remove your own access';
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

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after, actor_role)
  values (
    p_org_id, auth.uid(), 'user', 'staff.removed', 'organization_members', p_user_id,
    jsonb_build_object('previousRole', v_target_role), v_caller_role
  );
end;
$$;

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
  if not public.has_org_role(p_org_id, 'principal') then
    raise exception 'Only the organization principal may change a member''s property access mode';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Principal property access cannot be changed via this action';
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

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after, actor_role)
  values (p_org_id, auth.uid(), 'user', 'staff.property_access_mode_changed', 'organization_members', p_user_id,
    jsonb_build_object('mode', p_mode), 'principal');
end;
$$;

create or replace function public.grant_property_access(
  p_property_id uuid,
  p_user_id uuid,
  p_property_role public.property_role
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_access_id uuid;
begin
  if auth.uid() is null then
    raise exception 'grant_property_access requires an authenticated user';
  end if;

  select org_id into v_org_id from public.properties where id = p_property_id;
  if v_org_id is null then
    raise exception 'Property not found';
  end if;

  if not public.has_org_role(v_org_id, 'principal') then
    raise exception 'Only the organization principal may grant property access';
  end if;

  insert into public.property_access (property_id, user_id, property_role, granted_by)
  values (p_property_id, p_user_id, p_property_role, auth.uid())
  on conflict (property_id, user_id) do update
    set property_role = excluded.property_role, granted_by = excluded.granted_by, updated_at = now()
  returning id into v_access_id;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after, actor_role, property_id)
  values (v_org_id, auth.uid(), 'user', 'staff.property_access_granted', 'property_access', v_access_id,
    jsonb_build_object('userId', p_user_id, 'propertyRole', p_property_role), 'principal', p_property_id);

  return v_access_id;
end;
$$;

create or replace function public.revoke_property_access(
  p_property_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'revoke_property_access requires an authenticated user';
  end if;

  select org_id into v_org_id from public.properties where id = p_property_id;
  if v_org_id is null then
    raise exception 'Property not found';
  end if;

  if not public.has_org_role(v_org_id, 'principal') then
    raise exception 'Only the organization principal may revoke property access';
  end if;

  delete from public.property_access where property_id = p_property_id and user_id = p_user_id;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, actor_role, property_id)
  values (v_org_id, auth.uid(), 'user', 'staff.property_access_revoked', 'property_access', p_user_id, 'principal', p_property_id);
end;
$$;

-- ============================================================================================
-- 2) RLS: staff-provisioning-record tables/policies, manager+/any-member -> principal-only.
-- ============================================================================================

drop policy if exists organization_invites_insert_manager_plus on public.organization_invites;
create policy organization_invites_insert_manager_plus on public.organization_invites
  for insert
  with check (
    has_org_role(org_id, 'principal'::organization_member_role)
    and (available_staff_seats(org_id) is null or available_staff_seats(org_id) > 0)
    and org_commercially_active(org_id)
  );

drop policy if exists "organization_invites_update_manager_plus" on public.organization_invites;
create policy "organization_invites_update_manager_plus"
  on public.organization_invites for update
  using (public.has_org_role(org_id, 'principal'))
  with check (public.has_org_role(org_id, 'principal'));

-- Was "any active member" (no role check at all) -- staff invitation records are staff
-- administration records, not general team-roster visibility (organization_members' own
-- broader SELECT policy is untouched).
drop policy if exists "organization_invites_select_same_org" on public.organization_invites;
create policy "organization_invites_select_same_org"
  on public.organization_invites for select
  using (public.has_org_role(org_id, 'principal'));

drop policy if exists "organization_staff_provisions_select_same_org" on public.organization_staff_provisions;
create policy "organization_staff_provisions_select_same_org"
  on public.organization_staff_provisions for select
  using (public.has_org_role(org_id, 'principal'));

drop policy if exists "organization_staff_provision_properties_select_same_org" on public.organization_staff_provision_properties;
create policy "organization_staff_provision_properties_select_same_org"
  on public.organization_staff_provision_properties for select
  using (
    provision_id in (
      select id from public.organization_staff_provisions
      where public.has_org_role(org_id, 'principal')
    )
  );

-- ============================================================================================
-- 3) audit_events schema extension (reuse/extend, not a duplicate audit system): a few nullable
-- columns supporting the new Organisation -> Activity page and richer forensic detail, additive
-- and fully backward-compatible with every existing writer.
-- ============================================================================================

alter table public.audit_events
  add column property_id uuid references public.properties(id),
  add column actor_role public.organization_member_role,
  add column actor_display_name text,
  add column correlation_id uuid;

comment on column public.audit_events.property_id is
  'The property this action concerns, when applicable (e.g. property_access grants, property/
   unit/lease/maintenance mutations). Null for org-level or non-property-scoped actions.';
comment on column public.audit_events.actor_role is
  'Snapshot of the actor''s organization_members.role AT THE TIME of the action -- never
   re-derived from the current role, which may have changed since (e.g. the actor was later
   demoted or removed). Null for system/api/ai_assisted actors.';
comment on column public.audit_events.actor_display_name is
  'Snapshot of the actor''s profiles.display_name AT THE TIME of the action, for the same reason
   as actor_role -- an audit trail must not silently change what it says a past event showed
   because someone later renamed their account. Resolved best-effort by writeAuditEvent(); a null
   value falls back to a live profiles lookup at read time.';
comment on column public.audit_events.correlation_id is
  'Optional per-request correlation id (matches the correlationId already used in this
   codebase''s security-sensitive route logging, e.g. app/api/v1/auth/confirm) -- lets a support
   investigation tie an audit_events row back to the exact request/log lines that produced it.';

create index audit_events_org_created_idx on public.audit_events (org_id, created_at desc);
create index audit_events_org_property_idx on public.audit_events (org_id, property_id) where property_id is not null;
create index audit_events_org_actor_idx on public.audit_events (org_id, actor_user_id) where actor_user_id is not null;

-- ============================================================================================
-- 4) Audit coverage extension: reuse the EXISTING generic log_audit_event_trigger() (migration
-- 20260101000074, already proven on owner_statements/cash_receipts/maintenance_tickets) rather
-- than hand-wiring writeAuditEvent() into dozens of individual property/unit/tenant/lease route
-- files -- a real, comprehensive audit of every mutating route (background agent, this date)
-- found create/update/archive for these four entities completely unaudited anywhere (no RPC-side
-- insert, no TS-side call, no trigger). All four have a direct, NOT NULL org_id column, so the
-- existing trigger function attaches cleanly with zero route changes and zero risk of drifting
-- out of sync with whichever code path performs the actual write (RPC or direct table access,
-- present or future). Inspections and accounting-period close/reopen were also found completely
-- unaudited and get the same treatment. bank_transactions is NOT included here: it has no direct
-- org_id column (only bank_account_id -> bank_accounts.org_id), so the generic trigger would
-- write a null-org_id row invisible to audit_events_select_org_member -- extending it correctly
-- needs either a denormalised org_id or a bespoke trigger, deliberately left as a disclosed,
-- separate follow-up rather than shipping a silently-broken audit row for it.
create or replace function public.log_audit_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_entity_id uuid;
  v_property_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_org_id := (to_jsonb(OLD)->>'org_id')::uuid;
    v_entity_id := (to_jsonb(OLD)->>'id')::uuid;
    -- Best-effort property_id snapshot for tables that have one (e.g. units, leases-via-unit
    -- would need a join and are deliberately left null here -- only a DIRECT property_id column
    -- is captured, never inferred). Absent on tables without the column -- ->> on a missing key
    -- returns null, not an error.
    v_property_id := nullif(to_jsonb(OLD)->>'property_id', '')::uuid;
  else
    v_org_id := (to_jsonb(NEW)->>'org_id')::uuid;
    v_entity_id := (to_jsonb(NEW)->>'id')::uuid;
    v_property_id := nullif(to_jsonb(NEW)->>'property_id', '')::uuid;
  end if;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after, property_id)
  values (
    v_org_id,
    auth.uid(),
    (case when auth.uid() is null then 'system' else 'user' end)::public.audit_actor_type,
    TG_TABLE_NAME || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    v_entity_id,
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
    v_property_id
  );

  return coalesce(NEW, OLD);
end;
$$;

create trigger properties_audit_trigger
  after insert or update or delete on public.properties
  for each row execute function public.log_audit_event_trigger();

create trigger units_audit_trigger
  after insert or update or delete on public.units
  for each row execute function public.log_audit_event_trigger();

create trigger tenants_audit_trigger
  after insert or update or delete on public.tenants
  for each row execute function public.log_audit_event_trigger();

create trigger leases_audit_trigger
  after insert or update or delete on public.leases
  for each row execute function public.log_audit_event_trigger();

create trigger inspections_audit_trigger
  after insert or update or delete on public.inspections
  for each row execute function public.log_audit_event_trigger();

create trigger accounting_periods_audit_trigger
  after insert or update or delete on public.accounting_periods
  for each row execute function public.log_audit_event_trigger();
