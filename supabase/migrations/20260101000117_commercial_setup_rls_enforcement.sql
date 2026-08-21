-- Commercial plan restructure, Part 6 -- RLS-safe commercial-setup enforcement (Objective A of the
-- follow-up gate task). The previous attempt (20260101000116) added
-- "commercial_setup_completed_at is not null" directly into has_org_role() and broke ~40 unrelated
-- pgTAP fixtures, because nearly every fixture -- and every pre-existing/grandfathered/seed org --
-- also has commercial_setup_completed_at = null, with no way to tell "genuinely mid-setup new
-- signup" apart from "pre-existing org that was simply never given a subscription row" using that
-- column alone.
--
-- Fix: a NEW, separate boolean, commercial_setup_required, defaulting to false. It is set true in
-- EXACTLY ONE place -- create_organization(), the sole production-reachable self-service org
-- creation path (confirmed by an explicit audit of every organizations-creating code path this
-- pass: the RPC via POST /api/v1/organizations is the only client-facing one; Platform Admin has
-- no "create an organization" feature at all, only plan/subscription changes for orgs that already
-- exist; supabase/seed/seed.sql is local-dev-only, never applied to production, per its own header
-- comment; every pgTAP fixture that inserts organizations directly never sets this new column
-- either). Every pre-existing/grandfathered org, every seed org, and every direct-insert test
-- fixture therefore gets commercial_setup_required = false automatically, with ZERO changes needed
-- to any of them -- they were never "born needing commercial setup" and this column says so
-- structurally, not by inference from an unrelated timestamp.
--
-- org_commercially_active(org_id): true unless commercial_setup_required AND setup genuinely
-- hasn't completed yet. This is the ONE new check added to the specific write-sensitive
-- operational entry points the task named (properties, owners, staff invites, tenants, leases,
-- accounting, documents, maintenance) -- NOT a change to has_org_role() itself, which stays exactly
-- as 20260101000115 left it. Read access is completely untouched everywhere.

alter table public.organizations
  add column commercial_setup_required boolean not null default false;

comment on column public.organizations.commercial_setup_required is
  'True only for an organization created by the current create_organization() (the sole
   production-reachable self-service signup path) -- set once, at creation, never re-derived.
   Distinct from commercial_setup_completed_at ("has setup happened yet"): this column instead
   answers "was this org born needing commercial setup at all." Every pre-existing/grandfathered
   org, every local-dev seed org, and every org created by a trusted non-self-service path
   defaults to false and is never subject to the org_commercially_active() gate below.';

create or replace function public.org_commercially_active(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select not o.commercial_setup_required or o.commercial_setup_completed_at is not null
      from public.organizations o
      where o.id = target_org_id
    ),
    true
  );
$$;

comment on function public.org_commercially_active(uuid) is
  'False only for a genuinely new, not-yet-set-up self-service org (commercial_setup_required=true
   and commercial_setup_completed_at still null). True for every other org, including one that does
   not exist (coalesce default) -- callers that need existence checked already do so separately
   (e.g. create_property()''s own org lookup), this function only ever answers the commercial-setup
   question, matching has_org_role()''s own single-responsibility shape.';

grant execute on function public.org_commercially_active(uuid) to authenticated, service_role;

-- create_organization(): identical to 20260101000114''s version, plus commercial_setup_required.
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

  if not public.may_create_portfolio(auth.uid()) then
    raise exception 'owner_subscription_required: an active Proplyst owner subscription is required to create your own portfolio.';
  end if;

  insert into public.organizations (
    legal_name, org_type, commercial_setup_completed_at, trial_ends_at, commercial_setup_required
  )
  values (p_legal_name, p_org_type, null, null, true)
  returning id into v_org_id;

  insert into public.organization_members (org_id, user_id, role, status, joined_at)
  values (v_org_id, auth.uid(), 'principal', 'active', now());

  perform public.seed_chart_of_accounts(v_org_id);

  return v_org_id;
end;
$$;

-- create_property(): one new guard, same shape as its own existing has_org_role/
-- available_property_slots checks immediately above it.
create or replace function public.create_property(
  p_org_id uuid,
  p_nickname text,
  p_address_line1 text,
  p_city text,
  p_country text,
  p_property_type property_type,
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

  if not public.org_commercially_active(p_org_id) then
    raise exception 'commercial_setup_required: complete payment-method setup before adding properties.';
  end if;

  if not (
    public.available_property_slots(p_org_id) is null
    or public.available_property_slots(p_org_id) > 0
  ) then
    raise exception 'property_limit_reached: You have reached the property limit for your current plan. Upgrade your plan to add more properties.';
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

-- ============================================================
-- Narrow RLS additions -- each existing WITH CHECK clause, re-declared byte-for-byte from its live
-- definition (read directly from this database before writing this migration) plus exactly one new
-- "and org_commercially_active(...)" condition. Read (SELECT) policies are completely untouched.
-- ============================================================

drop policy if exists owners_insert_agent_plus_capacity on public.owners;
create policy owners_insert_agent_plus_capacity on public.owners
  for insert
  with check (
    has_org_role(org_id, 'agent'::organization_member_role)
    and (available_owner_slots(org_id) is null or available_owner_slots(org_id) > 0)
    and org_commercially_active(org_id)
  );

drop policy if exists organization_invites_insert_manager_plus on public.organization_invites;
create policy organization_invites_insert_manager_plus on public.organization_invites
  for insert
  with check (
    has_org_role(org_id, 'manager'::organization_member_role)
    and (available_staff_seats(org_id) is null or available_staff_seats(org_id) > 0)
    and org_commercially_active(org_id)
  );

drop policy if exists journal_entries_insert_accountant_plus on public.journal_entries;
create policy journal_entries_insert_accountant_plus on public.journal_entries
  for insert
  with check (
    has_org_role(org_id, 'accountant'::organization_member_role)
    and org_commercially_active(org_id)
  );

drop policy if exists journal_lines_insert_accountant_plus_and_property_access on public.journal_lines;
create policy journal_lines_insert_accountant_plus_and_property_access on public.journal_lines
  for insert
  with check (
    (exists (
      select 1 from journal_entries e
      where e.id = journal_lines.journal_entry_id
        and has_org_role(e.org_id, 'accountant'::organization_member_role)
        and org_commercially_active(e.org_id)
    ))
    and (
      property_id is null
      or has_property_access(property_id, 'accountant'::property_role)
      or has_property_access(property_id, 'owner'::property_role)
    )
  );

drop policy if exists tenants_write_agent_plus_and_property_access on public.tenants;
create policy tenants_write_agent_plus_and_property_access on public.tenants
  for all
  using (
    has_org_role(org_id, 'agent'::organization_member_role)
    and has_tenant_property_access(id, 'property_manager'::property_role)
  )
  with check (
    has_org_role(org_id, 'agent'::organization_member_role)
    and has_tenant_property_access(id, 'property_manager'::property_role)
    and org_commercially_active(org_id)
  );

drop policy if exists leases_write_agent_plus_and_property_access on public.leases;
create policy leases_write_agent_plus_and_property_access on public.leases
  for all
  using (
    has_org_role(org_id, 'agent'::organization_member_role)
    and exists (
      select 1 from units u
      where u.id = leases.unit_id
        and (has_property_access(u.property_id, 'property_manager'::property_role)
             or has_property_access(u.property_id, 'owner'::property_role))
    )
  )
  with check (
    has_org_role(org_id, 'agent'::organization_member_role)
    and exists (
      select 1 from units u
      where u.id = leases.unit_id
        and (has_property_access(u.property_id, 'property_manager'::property_role)
             or has_property_access(u.property_id, 'owner'::property_role))
    )
    and org_commercially_active(org_id)
  );

drop policy if exists documents_write_agent_plus_and_property_access on public.documents;
create policy documents_write_agent_plus_and_property_access on public.documents
  for all
  using (
    has_org_role(org_id, 'agent'::organization_member_role)
    and (has_property_access(property_id, 'property_manager'::property_role)
         or has_property_access(property_id, 'owner'::property_role))
  )
  with check (
    has_org_role(org_id, 'agent'::organization_member_role)
    and (has_property_access(property_id, 'property_manager'::property_role)
         or has_property_access(property_id, 'owner'::property_role))
    and org_commercially_active(org_id)
  );

drop policy if exists maintenance_tickets_write_agent_plus_and_property_access on public.maintenance_tickets;
create policy maintenance_tickets_write_agent_plus_and_property_access on public.maintenance_tickets
  for all
  using (
    has_org_role(org_id, 'agent'::organization_member_role)
    and (has_property_access(property_id, 'maintenance_manager'::property_role)
         or has_property_access(property_id, 'owner'::property_role))
  )
  with check (
    has_org_role(org_id, 'agent'::organization_member_role)
    and (has_property_access(property_id, 'maintenance_manager'::property_role)
         or has_property_access(property_id, 'owner'::property_role))
    and org_commercially_active(org_id)
  );
-- maintenance_tickets_insert_tenant_self is deliberately untouched -- a tenant cannot exist in a
-- not-yet-set-up org in the first place (tenants/leases are downstream of properties, which
-- create_property() already blocks), and the tenant portal must never be gated on commercial
-- setup regardless.
