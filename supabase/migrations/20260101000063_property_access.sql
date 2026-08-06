-- Commercial-launch execution plan, Stage 1 (WORKLOG.md/DECISIONS.md this date): the foundational
-- authorization primitive for property-level permissions. Deliberately additive-only, matching
-- this codebase's own established expand/contract pattern (20260101000022's own comment on why:
-- risk being managed is blast radius, not data loss) — nothing in this migration changes what any
-- existing table's RLS policy actually checks. `properties_select_org_member`
-- (20260101000023) still grants every org member viewer+ full visibility of every property in
-- their org after this migration runs, exactly as it does today. The actual RLS cutover (gating
-- properties/units/leases/documents/expenses/journal_entries/owner_statements/maintenance_tickets
-- on has_property_access(), table by table, with adversarial verification at each step) is
-- deliberately its own follow-up unit of work, not bundled in here — this migration only makes
-- that cutover possible later without a data-migration problem when it happens.
--
-- Role semantics (Mohammed's exact six-role list, 2026-08-05 instruction): 'read_only' is the
-- universal minimum, satisfied by any granted role. 'administrator' is the superset role,
-- satisfying every other minimum — the "no additional restriction beyond org role" grant used by
-- the backfill below. 'owner', 'property_manager', 'accountant', 'maintenance_manager' are
-- siblings, not ranked against each other (same non-total-order reasoning has_org_role() documents
-- for 'accountant'/'agent') — each is satisfied by itself or by 'administrator'. This is a
-- judgment call, not a confirmed product decision; it lives entirely in one SQL function body
-- (below) specifically so it's cheap to revise once real usage (the assignment UI, Phase 4/5)
-- shows it wrong, rather than baked into the table shape.

create type public.property_role as enum (
  'owner', 'property_manager', 'accountant', 'maintenance_manager', 'administrator', 'read_only'
);

create table public.property_access (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  property_role public.property_role not null,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per (property, user): a user's access to a given property is a single role, not a
  -- set to union — matching organization_members' unique (org_id, user_id) precedent.
  unique (property_id, user_id)
);

create index property_access_user_idx on public.property_access (user_id);
create index property_access_property_idx on public.property_access (property_id, property_role);

create trigger set_property_access_updated_at
  before update on public.property_access
  for each row execute function public.set_updated_at();

alter table public.property_access enable row level security;

-- A user can always see their own grants (needed for the owner portal / "which properties can I
-- access" — Phase 5); org manager+ can see every grant for properties in their org, to administer
-- access. No select-by-property-access-itself here (would be circular — this table IS the access
-- list, not something gated by it).
create policy "property_access_select_self_or_org_manager"
  on public.property_access for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.properties p
      where p.id = property_access.property_id and public.has_org_role(p.org_id, 'manager')
    )
  );

-- No direct insert/update/delete policy: same reasoning as organization_members
-- (20260101000021's comment) — "who can grant/revoke access to what" is real authorization logic
-- that belongs in one place (the RPCs below), not reconstructed per-policy or left to a bare
-- client UPDATE.

create or replace function public.has_property_access(
  target_property_id uuid,
  min_role public.property_role default 'read_only'
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.property_access pa
    where pa.property_id = target_property_id
      and pa.user_id = auth.uid()
      and (
        case min_role
          when 'read_only' then true
          when 'owner' then pa.property_role in ('owner', 'administrator')
          when 'property_manager' then pa.property_role in ('property_manager', 'administrator')
          when 'accountant' then pa.property_role in ('accountant', 'administrator')
          when 'maintenance_manager' then pa.property_role in ('maintenance_manager', 'administrator')
          when 'administrator' then pa.property_role = 'administrator'
        end
      )
  );
$$;

comment on function public.has_property_access(uuid, public.property_role) is
  'True if the calling authenticated user holds a property_access grant on target_property_id at
   or above min_role, per the role semantics documented in this migration. Not yet referenced by
   any existing table policy — this is the primitive, not the cutover.';

-- Grant/revoke go through org manager+ only, same authorization level required to change org
-- membership roles (20260101000021) — property-level access is still an org-administered
-- resource, not something a property_access holder can extend to others themselves.
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

  if not public.has_org_role(v_org_id, 'manager') then
    raise exception 'Only manager+ org members may grant property access';
  end if;

  insert into public.property_access (property_id, user_id, property_role, granted_by)
  values (p_property_id, p_user_id, p_property_role, auth.uid())
  on conflict (property_id, user_id) do update
    set property_role = excluded.property_role, granted_by = excluded.granted_by, updated_at = now()
  returning id into v_access_id;

  return v_access_id;
end;
$$;

comment on function public.grant_property_access(uuid, uuid, public.property_role) is
  'Grants or updates p_user_id''s property_role on p_property_id. Caller must hold manager+ org
   role on the property''s own org — deliberately not delegable to a lower-privileged
   property_access holder, even an "administrator" one, to avoid a privilege-escalation path
   where property-level access could be used to grant further property-level access.';

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

  if not public.has_org_role(v_org_id, 'manager') then
    raise exception 'Only manager+ org members may revoke property access';
  end if;

  delete from public.property_access where property_id = p_property_id and user_id = p_user_id;
end;
$$;

-- Backfill: grants 'administrator' (the no-additional-restriction role) to every currently-active
-- org member, for every property in their org — this is a deliberate, transitional bridge, not
-- the desired end state. Its only purpose is making sure that WHENEVER a future migration actually
-- cuts any table's RLS over to require has_property_access(), nobody who can see a property today
-- (properties_select_org_member grants viewer+ full org-wide visibility, unconditionally, right
-- now) loses access as a side effect of infrastructure that hasn't even been wired in yet. Real,
-- deliberately-scoped per-property assignment (narrowing specific staff to specific properties) is
-- the Phase 4 assignment-UI's job, done afterward, on top of this safe starting point — not
-- something this migration attempts to guess.
insert into public.property_access (property_id, user_id, property_role, granted_by)
select p.id, om.user_id, 'administrator', om.user_id
from public.properties p
join public.organization_members om on om.org_id = p.org_id and om.status = 'active'
on conflict (property_id, user_id) do nothing;

-- Additionally pre-populate 'owner' grants for owners who already have a portal login
-- (owners.user_id set) and a real ownership share (property_owners) — this is not preserving
-- existing access (the owner portal doesn't exist yet, Phase 5), it's correctly seeding the grant
-- an owner will need the moment that portal ships, from data that already exists today. Uses
-- `do nothing` on conflict so an owner who is *also* org staff keeps their broader
-- 'administrator' grant from above rather than being narrowed to 'owner'.
insert into public.property_access (property_id, user_id, property_role, granted_by)
select po.property_id, o.user_id, 'owner', o.user_id
from public.property_owners po
join public.owners o on o.id = po.owner_id
where o.user_id is not null
on conflict (property_id, user_id) do nothing;
