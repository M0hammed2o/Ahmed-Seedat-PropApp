-- Provisioned-staff account model (this date, following the "Proplyst Provisioned Staff Account
-- Audit"). Adds a dedicated, admin-initiated staff-provisioning path alongside the existing
-- self-service organization_invites flow -- that flow is NOT touched, NOT deprecated, and remains
-- fully functional for any already-pending invitation and for owner/tenant invitations (separate
-- tables entirely, untouched by this migration).
--
-- Design rationale (audit's own conclusion): the self-service model is a genuine UX/reliability
-- mismatch for staff specifically -- an employee should never be routed through the full
-- customer-signup journey (confirmation email -> consent -> profile -> invitation redemption).
-- The Principal/manager now provisions the account directly from Organization -> Staff; the new
-- identity (when one is needed) is created via Supabase's own admin.generateLink({type:'invite'})
-- mechanism (called from application code, not SQL -- Postgres cannot call the GoTrue Admin API),
-- never a Proplyst-generated plaintext password.

create type public.staff_provision_status as enum (
  'pending',              -- DB row created; GoTrue admin call not yet attempted (or in flight)
  'pending_send_failed',  -- GoTrue/email dispatch failed -- retryable via resend
  'awaiting_activation',  -- GoTrue identity created/reused, activation email sent
  'activated',            -- employee set their password (or was an existing user) and joined
  'revoked'               -- cancelled by a manager+ before activation, or staff access removed
);

-- Token stored HASHED, matching owner_invitations/tenant_invitations' established pattern --
-- explicitly NOT the older organization_invites.token plaintext design (that file's own comment
-- already discloses the plaintext token as "a pre-existing, different design"; this is the more
-- secure precedent, not a regression).
create table public.organization_staff_provisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email citext not null,
  full_name text,
  role public.organization_member_role not null,
  property_access_mode public.property_access_mode not null default 'all',
  invited_by uuid not null references auth.users(id),
  -- Nullable: only ever set once a real GoTrue identity is associated (new-email branch, or the
  -- recoverable-orphan branch below) -- an existing, already-active customer never gets a token
  -- at all (no activation step; see activate-vs-provision split in the RPC below).
  token_hash text,
  auth_user_id uuid references auth.users(id),
  status public.staff_provision_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  activated_at timestamptz,
  resend_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organization_staff_provisions_org_idx
  on public.organization_staff_provisions (org_id, status);
create index organization_staff_provisions_email_idx
  on public.organization_staff_provisions (email);
create index organization_staff_provisions_auth_user_idx
  on public.organization_staff_provisions (auth_user_id) where auth_user_id is not null;
-- At most one row per (org, email) that is still genuinely "in flight" -- prevents duplicate
-- pending provisions for the same person/org (test scenario D, "repeated provision request").
-- Partial unique index, not a plain unique constraint: a person can be legitimately
-- provisioned-then-revoked-then-re-provisioned for the SAME org over time, which must not collide
-- with old, terminal rows.
create unique index organization_staff_provisions_org_email_inflight_idx
  on public.organization_staff_provisions (org_id, email)
  where status in ('pending', 'pending_send_failed', 'awaiting_activation');

create trigger organization_staff_provisions_set_updated_at
  before update on public.organization_staff_provisions
  for each row execute function public.set_updated_at();

-- Selected-property scoping for a pending provision -- mirrors organization_invite_properties
-- exactly (same shape, same reasoning), copied into public.property_access only once activation
-- actually happens (activate_staff_provision() below), never before.
create table public.organization_staff_provision_properties (
  provision_id uuid not null references public.organization_staff_provisions(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  property_role public.property_role not null default 'read_only',
  primary key (provision_id, property_id)
);

alter table public.organization_staff_provisions enable row level security;
alter table public.organization_staff_provision_properties enable row level security;

-- No direct INSERT/UPDATE policy for `authenticated` on either table -- every write goes through
-- provision_staff_member()/activate_staff_provision() below, both `security definer`, matching
-- organization_members' own established "RPC-only mutation" convention (unlike
-- organization_invites, which still permits a direct client INSERT today). SELECT is still needed
-- for the Staff UI's own listing query.
create policy "organization_staff_provisions_select_same_org"
  on public.organization_staff_provisions for select
  using (public.has_org_role(org_id, 'agent'));

create policy "organization_staff_provision_properties_select_same_org"
  on public.organization_staff_provision_properties for select
  using (
    provision_id in (
      select id from public.organization_staff_provisions
      where public.has_org_role(org_id, 'agent')
    )
  );

-- ============================================================================================
-- provision_staff_member(): the single entry point Organization -> Staff -> "Add staff member"
-- calls. Runs entirely in Postgres -- the caller (TypeScript route) still owns the GoTrue Admin
-- API call afterward, since Postgres cannot reach it. Branches on whether the email already has a
-- REAL, password-capable auth.users identity:
--
--   - No auth.users row, OR one exists but has never had a password set (encrypted_password is
--     null/empty -- GoTrue's own representation of "identity exists, e.g. from a previous
--     interrupted provisioning attempt, but was never actually activated"): creates a `pending`
--     organization_staff_provisions row only. No membership, no seat consumed yet -- consumed at
--     activate_staff_provision() time. The caller then calls admin.generateLink({type:'invite'}),
--     which is safe to call whether this is a brand-new email or a passwordless leftover identity
--     (GoTrue reuses the existing user rather than erroring) -- this is the explicit,
--     server-verified recovery path for orphan scenario B/C from the audit's own test matrix,
--     not a vague "retry will self-heal" hope.
--   - A REAL existing password-capable identity: this IS the activation moment. Locks the org row,
--     re-checks seat capacity authoritatively, upserts organization_members directly (status
--     'active'), applies property access immediately. No provisions row survives in an
--     in-flight state; email dispatch (a plain "you were added" notification, not an auth link)
--     is the caller's job.
--
-- Principal can never be assigned through this path -- p_role is constrained by the SAME
-- MAX_INVITABLE_ROLE_FOR ceiling the caller already enforces server-side (mirrored here as a
-- second, independent check, matching update_organization_member_role()'s own "RLS/route checks
-- the coarse floor, this function checks the caller-rank-specific ceiling" layering).
-- `p_selected_properties` is a jsonb array of {"propertyId": uuid, "propertyRole": text} objects
-- -- accepted and applied INSIDE this one function (unlike the older invites route, which does a
-- separate follow-up INSERT + manual rollback-on-failure). A bad property id, an RLS surprise, or
-- any other mid-function error rolls back the ENTIRE call -- membership, provisions row, property
-- rows, audit event, all of it -- for free, as one Postgres transaction. This is what
-- "no partial membership/property_access creation on failure" means in practice here.
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
  if v_caller_role is null or v_caller_role not in ('manager', 'principal') then
    raise exception 'Only manager+ org members may provision staff';
  end if;
  if v_caller_role = 'manager' and p_role in ('manager', 'principal') then
    raise exception 'A manager cannot provision a member with the manager or principal role';
  end if;

  if not public.org_commercially_active(p_org_id) then
    raise exception 'org_not_commercially_active: this organization has not completed billing setup yet';
  end if;

  -- Serialize against any other concurrent provision/activation for this same org before
  -- resolving identity or counting seats -- identical lock-the-parent-row pattern already proven
  -- in accept_organization_invite() (migration 20260101000123).
  perform 1 from public.organizations where id = p_org_id for update;

  select id, (encrypted_password is not null and encrypted_password <> '')
    into v_target_auth_id, v_target_has_password
    from auth.users where email = p_email;

  v_seat_limit := public.org_staff_seat_limit(p_org_id);
  v_current_count := public.org_active_billable_staff_count(p_org_id);

  if v_target_auth_id is not null and v_target_has_password then
    -- Existing, real, password-capable identity -- provisioning IS activation.
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

    -- A record of this provisioning event still exists for audit/history/UI-listing purposes,
    -- created already-activated -- never left in an in-flight status (the partial unique index
    -- above only covers in-flight statuses, so this never collides with a later re-provision).
    insert into public.organization_staff_provisions (
      org_id, email, full_name, role, property_access_mode, invited_by, auth_user_id, status, activated_at
    )
    values (p_org_id, p_email, p_full_name, p_role, p_property_access_mode, auth.uid(), v_target_auth_id, 'activated', now())
    returning id into v_provision_id;

    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (p_org_id, auth.uid(), 'user', 'staff.provisioned_existing_user', 'organization_members', v_target_auth_id,
      jsonb_build_object('role', p_role, 'propertyAccessMode', p_property_access_mode));

    return query select true, v_target_auth_id, v_provision_id, true;
  else
    -- New email, or a passwordless leftover identity from an interrupted prior attempt -- no seat
    -- is consumed here; only a fast existence check (fail fast on a plan that's already visibly
    -- full), never the authoritative one -- that happens at activate_staff_provision() time.
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

    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (p_org_id, auth.uid(), 'user', 'staff.provision_created', 'organization_staff_provisions', v_provision_id,
      jsonb_build_object('email', p_email, 'role', p_role, 'propertyAccessMode', p_property_access_mode));

    return query select false, v_target_auth_id, v_provision_id, false;
  end if;
end;
$function$;

-- ============================================================================================
-- activate_staff_provision(): called by the NEWLY-authenticated employee themselves (after
-- verifyOtp(type='invite') + updateUser({password}) have already established a real session and
-- legal-consent/profile-completion are already satisfied -- app-layer gates, same as
-- accept_organization_invite()'s own callers). Operates on auth.uid() alone -- no client-supplied
-- id/token of any kind, so nothing here can ever be redirected at the wrong org/role/property set
-- by a tampered parameter. Picks the caller's own most-recently-created awaiting_activation row,
-- matching destinationResolver.ts's own "most recent wins" convention for multiple pending items.
create or replace function public.activate_staff_provision()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_provision public.organization_staff_provisions%rowtype;
  v_seat_limit integer;
  v_current_count integer;
begin
  if auth.uid() is null then
    raise exception 'activate_staff_provision requires an authenticated user';
  end if;

  select * into v_provision
    from public.organization_staff_provisions
    where auth_user_id = auth.uid()
      and status = 'awaiting_activation'
      and expires_at > now()
    order by created_at desc
    limit 1
    for update;

  if not found then
    raise exception 'No pending staff activation found for this account, or it has expired.';
  end if;

  -- Same org-row-lock + authoritative-recheck pattern as accept_organization_invite() /
  -- provision_staff_member()'s own existing-user branch -- this IS the seat-consuming moment for
  -- the new-identity path, so it gets the SAME authoritative check, not the earlier fast one.
  perform 1 from public.organizations where id = v_provision.org_id for update;

  v_seat_limit := public.org_staff_seat_limit(v_provision.org_id);
  if v_seat_limit is not null then
    v_current_count := public.org_active_billable_staff_count(v_provision.org_id);
    if v_current_count >= v_seat_limit then
      raise exception 'staff_seat_limit_reached: this organization has no remaining staff seats available.';
    end if;
  end if;

  insert into public.organization_members (
    org_id, user_id, role, status, joined_at, invited_by, property_access_mode
  )
  values (
    v_provision.org_id, auth.uid(), v_provision.role, 'active', now(), v_provision.invited_by,
    v_provision.property_access_mode
  )
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = 'active', joined_at = now(),
        property_access_mode = excluded.property_access_mode;

  if v_provision.property_access_mode = 'selected' then
    insert into public.property_access (property_id, user_id, property_role, granted_by)
    select ospp.property_id, auth.uid(), ospp.property_role, v_provision.invited_by
    from public.organization_staff_provision_properties ospp
    where ospp.provision_id = v_provision.id
    on conflict (property_id, user_id) do update
      set property_role = excluded.property_role, updated_at = now();
  end if;

  update public.organization_staff_provisions
    set status = 'activated', activated_at = now()
    where id = v_provision.id;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (v_provision.org_id, auth.uid(), 'user', 'staff.activated', 'organization_staff_provisions', v_provision.id,
    jsonb_build_object('role', v_provision.role, 'propertyAccessMode', v_provision.property_access_mode));

  return v_provision.org_id;
end;
$function$;
