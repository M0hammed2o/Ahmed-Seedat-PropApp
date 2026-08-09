-- Workflow-integration pass (WORKLOG.md this date): a manually-created lease (source='manual',
-- the normal path -- approve_application() is the only path that already auto-links a tenant)
-- starts 'draft' with zero tenants and nothing to resolve "No tenant assigned to this lease yet."
-- This migration adds the two missing pieces: a way to assign a tenant to an existing lease, and a
-- validated activation path that used to be a bare, unchecked status-field PATCH.

-- assign_lease_tenant(): agent+ only (same bar as leases_write_agent_plus itself), not security
-- definer -- the caller already has agent+ RLS rights on both leases and lease_tenants directly,
-- same non-definer reasoning approve_application() documents for its own inserts. Upserts so a
-- retried/duplicate call is a no-op, not an error. Setting p_is_primary=true demotes any other
-- primary tenant on the same lease to keep "the one primary tenant" invariant lease_tenants.
-- is_primary was designed around (post_lease_deposit() reads exactly one primary tenant).
create or replace function public.assign_lease_tenant(
  p_lease_id uuid,
  p_tenant_id uuid,
  p_is_primary boolean default true
)
returns void
language plpgsql
as $$
declare
  v_lease public.leases%rowtype;
  v_tenant_org_id uuid;
begin
  select * into v_lease from public.leases where id = p_lease_id;
  if not found then
    raise exception 'Lease not found (or not visible to the caller)';
  end if;

  select org_id into v_tenant_org_id from public.tenants where id = p_tenant_id;
  if v_tenant_org_id is null then
    raise exception 'Tenant not found (or not visible to the caller)';
  end if;
  if v_tenant_org_id <> v_lease.org_id then
    raise exception 'Tenant does not belong to the same organization as this lease';
  end if;

  if p_is_primary then
    update public.lease_tenants set is_primary = false
    where lease_id = p_lease_id and tenant_id <> p_tenant_id and is_primary;
  end if;

  insert into public.lease_tenants (lease_id, tenant_id, is_primary)
  values (p_lease_id, p_tenant_id, p_is_primary)
  on conflict (lease_id, tenant_id) do update set is_primary = excluded.is_primary;
end;
$$;

comment on function public.assign_lease_tenant(uuid, uuid, boolean) is
  'Attaches an existing tenant to an existing lease (upsert, idempotent). Relies entirely on the
   caller''s own agent+ RLS rights on leases/tenants/lease_tenants -- not security definer.';

-- Pre-flight guard, added after a real incremental-upgrade simulation against representative
-- pre-078 data caught this: nothing before this migration ever stopped two leases from both being
-- 'active' on the same unit, so a production unit that already has that (however it happened --
-- historical data, a since-fixed bug, manual correction gone wrong) would make the unique index
-- below fail with a bare, unexplained "duplicate key" error, aborting the whole migration. Same
-- posture as the org_id backfill guard in migration 20260101000023: this does not guess which of
-- the two leases should "win" and silently demote the other (a real business decision, not an
-- engineering one) -- it fails loudly, names the exact unit_ids, and tells the operator to resolve
-- it (e.g. end_lease() the wrong one) before re-running. Zero cost when, as expected, no such row
-- exists.
do $$
declare
  v_conflicting_units uuid[];
begin
  select array_agg(unit_id) into v_conflicting_units
  from (
    select unit_id from public.leases where status = 'active' group by unit_id having count(*) > 1
  ) x;
  if v_conflicting_units is not null then
    raise exception
      'lease_tenant_assignment_and_activation: % unit(s) already have more than one active lease
       (unit_id(s): %) -- the new leases_one_active_per_unit_idx cannot be created until this is
       resolved. This migration does not guess which lease should stay active; end (expire or
       terminate) every extra active lease on each listed unit, then re-run.',
      array_length(v_conflicting_units, 1), v_conflicting_units;
  end if;
end $$;

-- Only one ACTIVE lease per unit at a time -- a real DB-enforced guard, not just app-layer
-- discipline (Stage 11 requirement: "protect against overlapping active leases for the same unit
-- where the current business model does not allow them"). Partial unique index rather than a
-- trigger/exclusion constraint -- the simplest correct tool for "at most one row per unit_id
-- matching a condition", and it composes for free with activate_lease()'s own pre-check below
-- (that check exists purely to turn a raw constraint-violation 500 into a clean, explained
-- exception -- the index is still the actual, unconditional guarantee).
create unique index leases_one_active_per_unit_idx on public.leases (unit_id) where status = 'active';

-- activate_lease(): replaces the previous bare "PATCH status='active'" (packages/validation's
-- leaseUpdateSchema permits any enum member with zero business-rule checking). Validates exactly
-- the Stage 11 minimum ("unit, tenant, valid start date, valid rent") before flipping status, then
-- generates the lease's own first rent-schedule pass so a newly-activated lease is never left
-- silently empty on the Rent Schedule tab. Not security definer, same reasoning as
-- assign_lease_tenant() -- but DOES need to reach generate_rent_schedules_for_lease(), which is
-- locked to service_role only (migration 20260101000050) for its real caller (the system cron
-- job) -- this function is deliberately the one sanctioned interactive-user path to it, scoped to
-- exactly the lease being activated, never a bulk/cross-org call.
create or replace function public.activate_lease(p_lease_id uuid)
returns public.leases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease public.leases%rowtype;
  v_tenant_count integer;
begin
  select * into v_lease from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Lease not found (or not visible to the caller)';
  end if;

  if not public.has_org_role(v_lease.org_id, 'agent') then
    raise exception 'Caller does not have permission to activate this lease';
  end if;

  if v_lease.status = 'active' then
    -- Idempotent: activating an already-active lease is a no-op success, not an error -- matches
    -- generate_rent_schedules_for_lease()'s own retry-safe posture (Stage 12's "duplicate
    -- activation" test requirement).
    return v_lease;
  end if;

  if v_lease.status <> 'draft' then
    raise exception 'Only a draft lease can be activated (current status: %)', v_lease.status;
  end if;

  select count(*) into v_tenant_count from public.lease_tenants where lease_id = p_lease_id;
  if v_tenant_count = 0 then
    raise exception 'Assign a tenant to this lease before activating it';
  end if;

  if v_lease.rent_amount <= 0 then
    raise exception 'Lease must have a rent amount greater than zero to activate';
  end if;

  if v_lease.start_date is null then
    raise exception 'Lease must have a start date to activate';
  end if;

  if exists (
    select 1 from public.leases
    where unit_id = v_lease.unit_id and status = 'active' and id <> p_lease_id
  ) then
    raise exception 'This unit already has another active lease';
  end if;

  update public.leases set status = 'active' where id = p_lease_id
  returning * into v_lease;

  perform public.generate_rent_schedules_for_lease(p_lease_id);

  return v_lease;
end;
$$;

comment on function public.activate_lease(uuid) is
  'Validates (tenant assigned, rent > 0, start_date set, no other active lease on the unit) then
   flips a draft lease to active and generates its first rent-schedule pass. Idempotent re-call on
   an already-active lease is a no-op. Security definer solely to reach the service-role-locked
   generate_rent_schedules_for_lease() for this one caller-scoped lease.';

-- end_lease(): the mirror action -- terminate/expire an active lease. Exists so unit-status
-- reversion (next migration) has a single, validated transition point on the "ending" side too,
-- matching activate_lease()'s validated transition on the "starting" side, rather than leaving
-- end-of-lease as another bare unchecked status PATCH.
create or replace function public.end_lease(p_lease_id uuid, p_status public.lease_status)
returns public.leases
language plpgsql
as $$
declare
  v_lease public.leases%rowtype;
begin
  if p_status not in ('expired', 'terminated') then
    raise exception 'end_lease can only set status to expired or terminated (got %)', p_status;
  end if;

  select * into v_lease from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Lease not found (or not visible to the caller)';
  end if;

  if not public.has_org_role(v_lease.org_id, 'agent') then
    raise exception 'Caller does not have permission to end this lease';
  end if;

  if v_lease.status <> 'active' then
    raise exception 'Only an active lease can be ended (current status: %)', v_lease.status;
  end if;

  update public.leases set status = p_status where id = p_lease_id
  returning * into v_lease;

  return v_lease;
end;
$$;

comment on function public.end_lease(uuid, public.lease_status) is
  'Validated draft-free transition from active to expired/terminated. Not security definer -- the
   caller''s own agent+ RLS rights on leases already cover this write.';
