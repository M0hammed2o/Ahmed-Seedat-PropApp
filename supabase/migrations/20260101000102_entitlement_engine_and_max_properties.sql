-- RELEASE A P0 FIX (V1 Commercial Launch Gap Audit, this date): plan/feature-limit enforcement.
-- The audit re-confirmed only `maxStaff` (migration 20260101000094) was ever actually enforced --
-- `maxProperties` and every boolean feature_limits key (ocrEnabled/ownerPortalEnabled/
-- advancedReporting/bulkCommunications/apiAccess/prioritySupport) were readable on `plans` but
-- never consulted by any RLS policy, RPC, or route. This migration adds the missing database-level
-- primitives -- following org_staff_seat_limit()/org_active_billable_staff_count()/
-- available_staff_seats()'s own exact shape (20260101000094) -- as ONE authoritative source
-- apps/admin/lib/subscriptionEntitlements.ts (extended in this same release) wraps in TypeScript,
-- not reimplemented ad hoc per route.
--
-- Default-when-missing conventions (both deliberate, both documented at their point of use below):
--   * numeric limits (maxProperties): missing/null key OR no organization_subscriptions row at all
--     = unlimited -- exactly mirrors org_staff_seat_limit()'s own existing convention, so an org
--     with no subscription row yet (mid-trial, no billing wired up in this environment) is not
--     newly blocked from anything it could do before this migration.
--   * boolean feature flags (ocrEnabled etc.): missing key on a plan a subscription DOES point to
--     = false (Starter/Professional's own seed data (20260101000075) already establishes this --
--     they explicitly set `false` for restricted features rather than omitting the key, and only
--     Business omits nothing) -- but NO subscription row at all = true (a trialing org, with
--     nothing yet purchased, gets full functionality to evaluate the product, matching
--     maxProperties/maxStaff's own "no subscription = unrestricted" posture for the numeric case).

-- ============================================================
-- maxProperties
-- ============================================================
create or replace function public.org_active_property_count(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.properties
  where properties.org_id = p_org_id
    and properties.status = 'active';
$$;

comment on function public.org_active_property_count(uuid) is
  'Active (non-archived) properties only -- an archived property no longer counts toward the plan
   limit (RELEASE A business decision: archiving is the customer''s own way of freeing a slot
   without losing historical data, matching how staff seats already free up the moment a member is
   deactivated, org_active_billable_staff_count). A property the customer already has stays fully
   usable even if archiving other properties later never happens -- this function is only consulted
   at CREATION time, never used to lock existing rows.';

create or replace function public.org_property_limit(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select (p.feature_limits ->> 'maxProperties')::integer
  from public.organization_subscriptions os
  join public.plans p on p.id = os.plan_id
  where os.org_id = p_org_id
  order by os.current_period_start desc
  limit 1;
$$;

comment on function public.org_property_limit(uuid) is
  'The org''s current plan''s feature_limits.maxProperties (null = unlimited). Returns null
   (unlimited) for an org with no organization_subscriptions row at all, mirroring
   org_staff_seat_limit()''s exact convention.';

create or replace function public.available_property_slots(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when public.org_property_limit(p_org_id) is null then null
      else public.org_property_limit(p_org_id) - public.org_active_property_count(p_org_id)
    end;
$$;

comment on function public.available_property_slots(uuid) is
  'null = unlimited. May be zero or negative once the limit is reached or the org''s plan changed
   to a smaller property allowance after properties were already created -- callers treat "> 0 or
   null" as "may create another," never "must equal a specific positive number."';

-- Enforcement point: inside create_property() itself, the ONLY sanctioned way to create a
-- properties row from client code (20260101000064's own comment -- there is deliberately no
-- client-facing INSERT policy on `properties` at all, so this single RPC is already the complete
-- bypass surface; no separate RLS policy addition is needed the way organization_invites needed
-- one for maxStaff, which DOES have a client-facing INSERT policy).
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

comment on function public.create_property(
  uuid, text, text, text, text, public.property_type, text, text, text, text, text, text
) is
  'The only sanctioned way to create a properties row from client code. Raises
   ''property_limit_reached: ...'' (RELEASE A P0 fix) when the org''s active property count has
   already reached its plan''s maxProperties limit -- caught by name in the API route, matching the
   ''owner_subscription_required:''-prefix convention create_organization() already established, so
   the client can render a specific upgrade prompt rather than a generic 500.';

-- ============================================================
-- Boolean feature flags (ocrEnabled / ownerPortalEnabled / advancedReporting / bulkCommunications /
-- apiAccess) -- ONE generic resolver, not five near-duplicate functions, since every flag shares
-- identical resolution semantics (only the jsonb key differs). `prioritySupport` is deliberately
-- NOT included here -- RELEASE A audited it and confirmed it has no technical surface anywhere in
-- this codebase (a support-priority queue/SLA concept, not a gatable code path) -- it stays a
-- business/process flag only, exactly as the audit's own P0 task list allowed.
-- ============================================================
create or replace function public.org_feature_enabled(p_org_id uuid, p_feature_key text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select (p.feature_limits ->> p_feature_key)::boolean
      from public.organization_subscriptions os
      join public.plans p on p.id = os.plan_id
      where os.org_id = p_org_id
      order by os.current_period_start desc
      limit 1
    ),
    not exists (select 1 from public.organization_subscriptions where organization_subscriptions.org_id = p_org_id)
  );
$$;

comment on function public.org_feature_enabled(uuid, text) is
  'Resolves any boolean feature_limits key for an org''s current plan. Two-tier default: if a
   subscription row exists but the key is absent from that specific plan''s feature_limits, resolves
   to FALSE (a deliberate exclusion -- Starter/Professional''s own seed data sets false explicitly
   for restricted features rather than omitting the key). If NO subscription row exists at all
   (mid-trial), resolves to TRUE -- a trialing org gets full functionality to evaluate the product,
   matching org_property_limit()/org_staff_seat_limit()''s own "no subscription = unrestricted"
   posture for the numeric case. RELEASE A P0 fix -- this function did not exist before; every
   feature_limits boolean key was previously readable but never consulted by anything.';

revoke all on function public.org_active_property_count(uuid) from public;
revoke all on function public.org_property_limit(uuid) from public;
revoke all on function public.available_property_slots(uuid) from public;
revoke all on function public.org_feature_enabled(uuid, text) from public;
grant execute on function public.org_active_property_count(uuid) to authenticated, service_role;
grant execute on function public.org_property_limit(uuid) to authenticated, service_role;
grant execute on function public.available_property_slots(uuid) to authenticated, service_role;
grant execute on function public.org_feature_enabled(uuid, text) to authenticated, service_role;
