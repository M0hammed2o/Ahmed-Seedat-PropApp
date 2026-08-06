-- Commercial-launch execution plan, Stage 1 cutover, table 1 of 8 (WORKLOG.md this date):
-- `properties` is the first table gated on has_property_access() (20260101000063), chosen because
-- it is the root every other property-scoped table (units/leases/documents/expenses/
-- journal_entries/owner_statements/maintenance_tickets) ultimately joins through — proving the
-- pattern here first, not extending it to all 8 tables blind in one migration. Those 7 remaining
-- tables are NOT touched by this migration and still only check has_org_role() — a real,
-- temporary inconsistency (a user could fail to see a property row directly via `properties` but
-- still see its `units` via units' own still-org-only policy) accepted deliberately for this pass,
-- same "expand one unit of work correctly rather than seven half-finished" reasoning
-- 20260101000023's own comment documents for the org_id cutover.
--
-- Zero-regression design, verified against the ACTUAL API route (apps/admin/app/api/v1/
-- properties/route.ts), not assumed:
--   - POST creates a property, THEN immediately does a SEPARATE follow-up `.update()` call for
--     geocoding (lat/long) as the same user, in a later request -- so the creator needs a
--     property_access grant to exist by the time that second call runs, not just "eventually."
--   - Backfill (20260101000063) only covers properties that already existed at migration time.
--     Newly created properties need the SAME "every active org member gets administrator" grant,
--     applied live -- an AFTER INSERT trigger below, deliberately granting every current active
--     org member (not just the creator), because there is no assignment UI yet (Phase 4/5, not
--     built) for a team to use to share a newly created property with each other. Auto-granting
--     only the creator would make every multi-staff org's "my coworker just added a property and I
--     can't see it" scenario ship immediately, with no way to fix it until that UI exists -- a real
--     regression, not a theoretical one. This trigger keeps today's implicit "everyone in the org
--     sees everything" behavior for NEW properties too, until deliberate narrowing (via
--     revoke_property_access(), already built) becomes a product feature with a UI on top of it.

create or replace function public.grant_org_members_property_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.property_access (property_id, user_id, property_role, granted_by)
  select new.id, om.user_id, 'administrator', coalesce(auth.uid(), om.user_id)
  from public.organization_members om
  where om.org_id = new.org_id and om.status = 'active'
  on conflict (property_id, user_id) do nothing;
  return new;
end;
$$;

comment on function public.grant_org_members_property_access() is
  'Mirrors the one-time backfill in 20260101000063 for properties created AFTER that migration
   ran -- every active org member gets administrator access on a newly created property, same as
   properties_select_org_member already granted them org-wide before this cutover. Intentionally
   NOT creator-only; see this migration''s header comment for why.';

create trigger grant_org_members_property_access_trigger
  after insert on public.properties
  for each row execute function public.grant_org_members_property_access();

-- SELECT: now requires both org membership AND an explicit property_access grant. Every existing
-- property/member combination already has one (the 20260101000063 backfill); every new one gets
-- one automatically (the trigger above) -- so this is not a behavior change today, only an
-- enabling of future, deliberate narrowing via revoke_property_access().
drop policy if exists "properties_select_org_member" on public.properties;

create policy "properties_select_org_member_and_property_access"
  on public.properties for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(id, 'read_only'));

-- Write: split out of the single "for all" policy (20260101000023) because INSERT and
-- UPDATE/DELETE need genuinely different checks. INSERT cannot check has_property_access() at
-- all -- no property_access row can exist for a property that doesn't exist yet -- so insert
-- authorization stays exactly as it was (org agent+), unchanged. UPDATE/DELETE gain the
-- property_access requirement: 'property_manager' or 'owner' specifically (not just any grant) --
-- accountant/maintenance_manager/read_only grants should not be able to edit a property's own
-- core fields (address, nickname, status), only their own domain's tables (a judgment call, not
-- yet exercised by any real UI -- easy to revisit once Phase 4's assignment UI shows it wrong).
drop policy if exists "properties_write_agent_plus" on public.properties;

-- Deliberately no client-facing INSERT policy at all -- same posture organizations
-- (20260101000017's own comment) already takes for the identical reason: a bare client INSERT
-- bypassing create_property() below would create a property with no property_access grants for
-- anyone (nothing populates that automatically outside the trigger this migration wires to
-- create_property()'s own insert), and would also independently hit the RETURNING/RLS timing bug
-- documented above. RLS defaults to deny when no policy matches a command, so this is a real,
-- enforced restriction, not just a convention.

create policy "properties_update_agent_plus_and_property_access"
  on public.properties for update
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(id, 'property_manager') or public.has_property_access(id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(id, 'property_manager') or public.has_property_access(id, 'owner'))
  );

create policy "properties_delete_agent_plus_and_property_access"
  on public.properties for delete
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(id, 'property_manager') or public.has_property_access(id, 'owner'))
  );

-- REVISED after a real local-database check (this migration was not shipped until this was found
-- and fixed, same "verify for real, don't assume" standard as 20260101000023's own revision
-- note): a plain client `INSERT ... RETURNING` against `properties` now FAILS ("new row violates
-- row-level security policy"), even though a plain insert with no RETURNING succeeds and a
-- separate subsequent SELECT correctly sees the row. Root cause, confirmed with a minimal
-- reproduction against this local database: Postgres requires a freshly INSERTed row to satisfy
-- the table's SELECT policy for it to appear in RETURNING -- and the
-- grant_org_members_property_access_trigger above, an AFTER ROW trigger firing during that same
-- INSERT statement, writes to a *different* table (property_access) whose effect is not visible
-- in time for that same statement's own RETURNING evaluation. This is not a theoretical concern:
-- `apps/admin/app/api/v1/properties/route.ts`'s real POST handler is exactly
-- `.insert({...}).select('*').single()`, which compiles to `INSERT ... RETURNING *` -- property
-- creation would have broken in production had this shipped without the dry-run check.
--
-- Fix: route property creation through a security-definer RPC, the same established pattern
-- `create_organization()` (20260101000021) already uses for an identical class of problem (the
-- creator needs to see something that doesn't exist until this exact statement creates it). A
-- security-definer function's own internal queries run as the function owner, which is exempt
-- from RLS entirely (this table was never given FORCE ROW LEVEL SECURITY) -- so its own
-- `INSERT ... RETURNING` never hits the RETURNING/RLS check at all, sidestepping the timing issue
-- completely. The trigger above is UNCHANGED and still does the actual granting -- it fires
-- exactly the same way regardless of whether the INSERT came from a raw client call or from
-- inside this function; only the client-facing insert path moves behind an RPC.
create or replace function public.create_property(
  p_org_id uuid,
  p_nickname text,
  p_address_line1 text,
  p_city text,
  p_country text,
  p_property_type public.property_type,
  p_address_line2 text default null,
  p_suburb text default null,
  p_province text default null,
  p_postal_code text default null,
  p_municipal_account_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id uuid;
begin
  if auth.uid() is null then
    raise exception 'create_property requires an authenticated user';
  end if;

  if not public.has_org_role(p_org_id, 'agent') then
    raise exception 'You do not have permission to add properties to this organization.';
  end if;

  insert into public.properties (
    org_id, nickname, address_line1, address_line2, suburb, city, province, postal_code,
    country, property_type, municipal_account_number, notes
  )
  values (
    p_org_id, p_nickname, p_address_line1, p_address_line2, p_suburb, p_city, p_province,
    p_postal_code, p_country, p_property_type, p_municipal_account_number, p_notes
  )
  returning id into v_property_id;

  return v_property_id;
end;
$$;

comment on function public.create_property(
  uuid, text, text, text, text, public.property_type, text, text, text, text, text, text
) is
  'The only sanctioned way to create a properties row from client code as of this migration --
   never a bare client INSERT. Returns the new property''s id; the caller does a separate,
   ordinary RLS-scoped SELECT afterward to fetch the full row (same two-step pattern
   create_organization() established) -- by that point grant_org_members_property_access_trigger
   has already committed, so the follow-up SELECT succeeds under ordinary RLS with no special
   timing dependency.';

-- Second half of "zero regression from today's actual behavior," found by testing the reverse
-- direction: `grant_org_members_property_access_trigger` above only grants access to members
-- active AT THE MOMENT a property is created -- but today, `properties_select_org_member` is a
-- LIVE check against organization_members, so a member who joins an org AFTER a property already
-- existed sees it immediately anyway, no special timing required. Verified live: without this
-- second trigger, a coworker invited after property creation gets zero property_access rows and
-- would lose visibility into every pre-existing property the moment this cutover shipped --
-- exactly the kind of quiet regression a solo dry-run table is supposed to catch before it reaches
-- the other 7 tables. Mirrors the properties-side trigger, in the other direction: fires when a
-- membership row is created or (re)activated (accept_organization_invite's insert-or-reactivate
-- upsert can hit either the INSERT or UPDATE branch depending on whether a prior revoked/invited
-- row already existed), granting administrator on every existing property in that org.
create or replace function public.grant_new_member_property_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    insert into public.property_access (property_id, user_id, property_role, granted_by)
    select p.id, new.user_id, 'administrator', coalesce(auth.uid(), new.user_id)
    from public.properties p
    where p.org_id = new.org_id
    on conflict (property_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.grant_new_member_property_access() is
  'Companion to grant_org_members_property_access_trigger (properties side) -- together they keep
   "any active org member sees every property in their org" true going forward exactly as it is
   today, until deliberate narrowing via revoke_property_access() becomes a real product feature
   with a UI on top of it (Phase 4/5, not yet built).';

create trigger grant_new_member_property_access_trigger
  after insert or update on public.organization_members
  for each row execute function public.grant_new_member_property_access();

-- Second real gap found by testing this cutover (support_session_access.test.sql, run against
-- this migration): a platform admin with an active support_access_sessions row could no longer
-- see a customer org's properties at all, because has_org_role()'s own support-mode OR-branch
-- (20260101000057) correctly still returns true, but the NEW has_property_access() requirement
-- has no equivalent branch -- a support admin has no property_access row and never should (they
-- are not a real org member). SUPER_ADMIN.md §6's promise is "viewer-level read for the whole org
-- under investigation," which has to mean every property in it, not a subset gated by a
-- per-property grant list that support mode was never meant to interact with. Mirrors
-- has_org_role()'s exact branch: read_only floor only, active (ended_at is null) session, ignores
-- organizations.status (archived orgs stay admin-readable for compliance, same reasoning).
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
  )
  or (
    min_role = 'read_only'
    and exists (
      select 1
      from public.properties p
      join public.support_access_sessions sas on sas.org_id = p.org_id
      where p.id = target_property_id
        and sas.ended_at is null
        and sas.platform_admin_id = public.caller_platform_admin_id()
    )
  );
$$;

comment on function public.has_property_access(uuid, public.property_role) is
  'True if the calling authenticated user holds a property_access grant on target_property_id at
   or above min_role, OR -- read_only floor only, never higher -- holds an active support session
   against that property''s org (mirrors has_org_role()''s support-mode branch, 20260101000057).';
