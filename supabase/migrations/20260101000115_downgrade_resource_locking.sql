-- Commercial plan restructure, Part 5 (WORKLOG.md this date): downgrade resource locking.
-- Never deletes customer data -- properties/staff/owners over a new, smaller plan's allowance are
-- marked restricted/suspended, not removed, and access returns automatically the moment capacity
-- is available again (upgrade, or an existing resource is archived/removed to free a slot).

alter table public.properties
  add column restricted_by_plan boolean not null default false;
alter table public.organization_members
  add column suspended_by_plan boolean not null default false;
alter table public.owners
  add column restricted_by_plan boolean not null default false;

comment on column public.properties.restricted_by_plan is
  'True when this property is outside the org''s current plan allowance (set by a downgrade this
   pass''s own reconcile_plan_limits() ran for). The property and all its data (units, tenants,
   leases, documents, payments, audit history) remain fully stored -- only day-to-day access is
   restricted while this is true. Never set for a reason other than plan capacity.';
comment on column public.organization_members.suspended_by_plan is
  'Same concept as properties.restricted_by_plan, for a staff seat over the org''s current plan
   allowance. Historical activity/audit_events are never deleted or altered by this flag.';
comment on column public.owners.restricted_by_plan is
  'Same concept, for an external owner over the org''s current plan allowance.';

-- Staff RLS already resolves access through has_org_role()/organization_members.status -- a
-- suspended-by-plan member should be treated as though inactive for write purposes without
-- destroying their historical organization_members row (status stays 'active'; this flag is the
-- distinct "plan capacity" reason, never conflated with the org actually removing them).
--
-- Re-declared from the EXACT current source (20260101000057, confirmed by direct read before
-- writing this -- not reconstructed from memory) with exactly ONE new condition added: a
-- suspended_by_plan member fails every branch except when min_role = 'viewer' is already
-- guaranteed true regardless of role (read access is never revoked by a staff-seat downgrade,
-- only write/role-gated actions are -- matching how an org already over its property limit still
-- lets staff VIEW the restricted property, per this pass's own "restricted, not deleted" wording).
-- The support_access_sessions OR-branch is preserved completely unchanged -- omitting it here
-- would have silently broken Platform Admin support-mode access.
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
    join public.organizations o on o.id = om.org_id
    where om.org_id = target_org_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and o.status <> 'archived'
      and (min_role = 'viewer' or coalesce(om.suspended_by_plan, false) = false)
      and (
        case
          when o.status in ('suspended', 'cancelled') then min_role = 'viewer'
          else (
            case min_role
              when 'viewer' then true
              when 'accountant' then om.role in ('accountant', 'manager', 'principal')
              when 'agent' then om.role in ('agent', 'manager', 'principal')
              when 'manager' then om.role in ('manager', 'principal')
              when 'principal' then om.role = 'principal'
            end
          )
        end
      )
  )
  or (
    min_role = 'viewer'
    and exists (
      select 1
      from public.support_access_sessions sas
      where sas.org_id = target_org_id
        and sas.ended_at is null
        and sas.platform_admin_id = public.caller_platform_admin_id()
    )
  );
$$;

comment on function public.has_org_role(uuid, public.organization_member_role) is
  'Re-declared to also exclude a suspended_by_plan member from anything above viewer-level access
   (downgrade resource locking, this pass) -- every other condition (active status, org status,
   role hierarchy, the support_access_sessions branch) is byte-for-byte unchanged from
   20260101000057''s version. The principal role is never itself suspended_by_plan
   (org_active_billable_staff_count()/reconcile_plan_limits() both exclude role = ''principal''
   entirely), so the paying account owner always retains full access to fix their own plan.';

-- ============================================================
-- reconcile_plan_limits(): the one function that actually applies/lifts restriction, called from
-- application code (a) immediately after any plan/add-on change (upgrade, downgrade, or extra
-- capacity purchase/removal) and (b) idempotently safe to call any time capacity might have
-- changed. Deterministic default when the principal has not yet chosen which resources to keep:
-- OLDEST-created resources stay active, MOST-RECENTLY-created are restricted first -- a safe,
-- disclosed, non-arbitrary rule (never random, never "whichever happens to sort last in a query
-- with no ORDER BY"). If the principal later explicitly chooses a different active set (via the
-- application UI calling set_property_active_selection(), a smaller follow-up piece), that
-- explicit choice is respected; this function only ever applies the deterministic default to
-- whatever is NOT already explicitly flagged.
-- ============================================================
create or replace function public.reconcile_plan_limits(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_limit integer;
  v_owner_limit integer;
  v_staff_limit integer;
begin
  v_property_limit := public.org_property_limit(p_org_id);
  v_owner_limit := public.org_owner_limit(p_org_id);
  v_staff_limit := public.org_staff_seat_limit(p_org_id);

  -- Properties: lift restriction on everything first (capacity may have increased), then
  -- re-restrict only the excess beyond the current limit, oldest-first-kept.
  if v_property_limit is null then
    update public.properties set restricted_by_plan = false
    where org_id = p_org_id and restricted_by_plan = true;
  else
    update public.properties set restricted_by_plan = false where org_id = p_org_id;
    update public.properties set restricted_by_plan = true
    where id in (
      select id from public.properties
      where org_id = p_org_id and status = 'active'
      order by created_at desc
      offset greatest(v_property_limit, 0)
    );
  end if;

  -- Owners: same pattern.
  if v_owner_limit is null then
    update public.owners set restricted_by_plan = false
    where org_id = p_org_id and restricted_by_plan = true;
  else
    update public.owners set restricted_by_plan = false where org_id = p_org_id;
    update public.owners set restricted_by_plan = true
    where id in (
      select id from public.owners
      where org_id = p_org_id and status = 'active'
      order by created_at desc
      offset greatest(v_owner_limit, 0)
    );
  end if;

  -- Staff: never the principal (excluded from the seat count and from this restriction entirely
  -- -- org_active_billable_staff_count() already excludes role = 'principal').
  if v_staff_limit is null then
    update public.organization_members set suspended_by_plan = false
    where org_id = p_org_id and suspended_by_plan = true;
  else
    update public.organization_members set suspended_by_plan = false
    where org_id = p_org_id and role <> 'principal';
    update public.organization_members set suspended_by_plan = true
    where id in (
      select id from public.organization_members
      where org_id = p_org_id and role <> 'principal' and status = 'active'
      order by joined_at desc
      offset greatest(v_staff_limit, 0)
    );
  end if;
end;
$$;

comment on function public.reconcile_plan_limits(uuid) is
  'Applies/lifts restricted_by_plan / suspended_by_plan for properties/owners/staff against the
   org''s CURRENT plan+add-on capacity. Deterministic default (most-recently-created restricted
   first) when no explicit selection exists. Idempotent -- safe to call after every plan change,
   trial-limit reconciliation, or add-on purchase/removal. Never deletes any row.';

revoke all on function public.reconcile_plan_limits(uuid) from public, authenticated, anon;
grant execute on function public.reconcile_plan_limits(uuid) to service_role;
