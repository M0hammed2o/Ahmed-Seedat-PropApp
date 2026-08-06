-- V1 scope correction (2026-08-01, DECISIONS.md): a tenant-facing web portal is now in scope.
-- PERMISSIONS.md §4 has always documented what a tenant should be able to see ("their own lease,
-- payment balance/history, documents, maintenance tickets... announcements targeted at their
-- property") but the actual RLS predicates for leases/lease_tenants/rent_schedules/invoices/
-- maintenance_tickets were never built -- only `tenants` and `announcements`/`announcement_reads`
-- already had a real tenant-self-access policy (`tenants_select_org_or_self`,
-- `announcements_select_org_or_tenant`, migrations 20260101000028/20260101000039). This closes
-- that gap for every table the tenant portal actually needs to read, using the identical
-- `tenants.user_id = auth.uid()` predicate those two already established -- no new authorization
-- concept, same pattern extended to more tables.

create or replace function public.caller_tenant_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.tenants where user_id = auth.uid();
$$;

comment on function public.caller_tenant_ids() is
  'The tenant record id(s) belonging to the calling authenticated user (normally zero or one; the
   schema does not prevent a user having tenant rows in more than one org, so this returns a set,
   not a single value). Used by every tenant-self-access RLS policy below instead of repeating the
   same subquery -- one definition, not five copies to keep in sync.';

-- caller_tenant_ids() only queries `tenants`, so it is safe to call directly from a policy on any
-- other table. `lease_tenants` is different: it already has its own policy
-- (`lease_tenants_select_org_member`, migration 20260101000030) that queries `leases` to resolve
-- org_id. A raw `exists (select ... from lease_tenants ...)` inside a `leases` policy would
-- therefore re-trigger `lease_tenants`'s policies, one of which queries `leases` again --
-- `42P17: infinite recursion detected in policy`. Wrapping the lease_tenants membership check in
-- its own SECURITY DEFINER function breaks the cycle the same way has_org_role() already does for
-- organization_members/leases -- the function's internal query runs as the function owner and
-- does not re-evaluate lease_tenants' RLS policies.
create or replace function public.caller_is_tenant_of_lease(p_lease_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.lease_tenants lt
    where lt.lease_id = p_lease_id and lt.tenant_id in (select public.caller_tenant_ids())
  );
$$;

-- === leases: tenant reads their own lease(s) ===
create policy "leases_select_tenant_self"
  on public.leases for select
  using (public.caller_is_tenant_of_lease(leases.id));

-- === lease_tenants: tenant reads their own membership row(s) ===
create policy "lease_tenants_select_tenant_self"
  on public.lease_tenants for select
  using (tenant_id in (select public.caller_tenant_ids()));

-- === rent_schedules: tenant reads their own lease's payment schedule/history ===
create policy "rent_schedules_select_tenant_self"
  on public.rent_schedules for select
  using (public.caller_is_tenant_of_lease(rent_schedules.lease_id));

-- === invoices: tenant reads their own invoices (tenant_id is a direct column here) ===
create policy "invoices_select_tenant_self"
  on public.invoices for select
  using (tenant_id in (select public.caller_tenant_ids()));

-- === maintenance_tickets: tenant reads tickets about them or submitted by them, and may submit
-- their own (matches the pre-existing submitted_by_tenant_id column and exactly-one-submitter
-- CHECK constraint, migration 20260101000034 -- "included now because the column is cheap... not
-- because it's used today." It's used starting now.) ===
create policy "maintenance_tickets_select_tenant_self"
  on public.maintenance_tickets for select
  using (
    tenant_id in (select public.caller_tenant_ids())
    or submitted_by_tenant_id in (select public.caller_tenant_ids())
  );

create policy "maintenance_tickets_insert_tenant_self"
  on public.maintenance_tickets for insert
  with check (
    submitted_by_user_id is null
    and submitted_by_tenant_id in (select public.caller_tenant_ids())
    and tenant_id = submitted_by_tenant_id
    and exists (
      select 1 from public.tenants t where t.id = submitted_by_tenant_id and t.org_id = maintenance_tickets.org_id
    )
  );

-- === documents: NOT a blanket property-scoped tenant grant (a property's documents include
-- owner-only paperwork -- municipal bills, insurance, compliance docs -- that a tenant must never
-- see, PERMISSIONS.md §4's "never: owner financials"). Adds a nullable lease_id so staff can
-- explicitly tag a specific document (e.g. the signed lease PDF) as tenant-visible; documents
-- with no lease_id stay staff/owner-only exactly as before. This is a deliberately narrower grant
-- than "documents," matching the actual isolation requirement rather than the literal word.
alter table public.documents add column lease_id uuid references public.leases(id) on delete set null;

create policy "documents_select_tenant_self"
  on public.documents for select
  using (lease_id is not null and public.caller_is_tenant_of_lease(documents.lease_id));

-- === units / properties: the tenant-portal UI needs a human-readable unit label and property
-- name alongside a lease (`/my-lease`), and the tenant-submitted maintenance-ticket route derives
-- property_id/unit_id server-side from the tenant's own lease -- both require actually being able
-- to read the `units`/`properties` rows, which `units_select_org_member`/`properties_select_org`
-- (org-member only) do not grant a tenant. Neither `units` nor `properties`' existing policies
-- reference `leases`/`lease_tenants` at all, so wrapping this in its own SECURITY DEFINER function
-- (rather than a raw subquery) isn't strictly required to avoid recursion the way
-- caller_is_tenant_of_lease() was, but does it anyway for the same reason has_org_role() is used
-- everywhere instead of inlining its subquery: one definition, not N call sites to keep in sync.
create or replace function public.caller_is_tenant_of_unit(p_unit_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.leases l
    join public.lease_tenants lt on lt.lease_id = l.id
    where l.unit_id = p_unit_id and lt.tenant_id in (select public.caller_tenant_ids())
  );
$$;

create or replace function public.caller_is_tenant_of_property(p_property_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.leases l
    join public.lease_tenants lt on lt.lease_id = l.id
    join public.units u on u.id = l.unit_id
    where u.property_id = p_property_id and lt.tenant_id in (select public.caller_tenant_ids())
  );
$$;

create policy "units_select_tenant_self"
  on public.units for select
  using (public.caller_is_tenant_of_unit(units.id));

create policy "properties_select_tenant_self"
  on public.properties for select
  using (public.caller_is_tenant_of_property(properties.id));
