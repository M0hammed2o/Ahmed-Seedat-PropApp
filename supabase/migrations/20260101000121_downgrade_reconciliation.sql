-- V1 commercial UX pass -- PRODUCT DECISION (this date): downgrades must actively reconcile
-- resources, not merely block new creation. reconcile_plan_limits() (20260101000115) already sets
-- properties.restricted_by_plan / owners.restricted_by_plan / organization_members.suspended_by_plan
-- correctly and deterministically, but (a) is never called by any real downgrade/trial-change path,
-- (b) has no way to honor a customer's own explicit "which resources stay active" choice, and (c)
-- setting restricted_by_plan today has NO actual access-control effect -- confirmed by full-codebase
-- grep before writing this migration: no RLS policy anywhere references either column. This
-- migration closes all three gaps in one place, deliberately reusing reconcile_plan_limits() as the
-- one locking primitive (per instruction: extend it, do not duplicate its logic in application code
-- or in a second SQL function).

-- ============================================================
-- 1. billing_plan_changes gets a customer-selectable keep-list, settable at confirm time (for an
--    immediate/trial downgrade) or any time before effective_at (for a scheduled one, via
--    set_scheduled_downgrade_selection() below). NULL (the default) means "no explicit choice was
--    made" -- reconcile_plan_limits() below falls back to its existing deterministic
--    oldest-created-stays-active rule for that resource type, exactly as before this migration.
-- ============================================================
alter table public.billing_plan_changes
  add column keep_property_ids uuid[],
  add column keep_owner_ids uuid[],
  add column keep_staff_member_ids uuid[];

comment on column public.billing_plan_changes.keep_property_ids is
  'Customer''s explicit choice of which properties stay active if this downgrade puts the org over
   its new plan''s property allowance. NULL = no explicit choice made -- reconcile_plan_limits()
   falls back to its deterministic default (oldest-created stays active). Never touched for a
   non-downgrade change_type.';
comment on column public.billing_plan_changes.keep_owner_ids is
  'Same concept as keep_property_ids, for external owners.';
comment on column public.billing_plan_changes.keep_staff_member_ids is
  'Same concept as keep_property_ids, for staff (organization_members.id, never the principal --
   reconcile_plan_limits() already excludes role=principal unconditionally).';

-- ============================================================
-- 2. reconcile_plan_limits() -- extended, not replaced. Original two-argument-equivalent callers
--    (reconcile_plan_limits(p_org_id)) are completely unaffected: every new parameter has a default
--    that reproduces the exact prior behavior (null keep-list = deterministic default, null actor =
--    system-attributed audit event). Also now writes audit_events for every resource-type batch
--    that actually changed state, and returns nothing new (still `returns void`) -- callers that
--    need to know what changed re-read current restricted_by_plan/suspended_by_plan state
--    themselves (e.g. a "N properties currently locked by your plan" banner), rather than this
--    function growing a bespoke result shape only some callers need.
-- ============================================================
-- CREATE OR REPLACE cannot change a function's parameter list -- it would silently create a SECOND,
-- overloaded function instead of replacing the original, and any caller still invoking it with just
-- one argument (every pgTAP test written before this migration) would then fail with
-- "function ... is not unique" (confirmed by running the existing test suite before adding this
-- line). The single-argument original must be dropped explicitly first.
drop function if exists public.reconcile_plan_limits(uuid);

create or replace function public.reconcile_plan_limits(
  p_org_id uuid,
  p_keep_property_ids uuid[] default null,
  p_keep_owner_ids uuid[] default null,
  p_keep_staff_member_ids uuid[] default null,
  p_actor_user_id uuid default null,
  p_change_reason text default 'plan_reconciliation'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_limit integer;
  v_owner_limit integer;
  v_staff_limit integer;
  v_keep_property_ids uuid[];
  v_keep_owner_ids uuid[];
  v_keep_staff_ids uuid[];
  v_restricted_property_ids uuid[];
  v_restored_property_ids uuid[];
  v_restricted_owner_ids uuid[];
  v_restored_owner_ids uuid[];
  v_suspended_staff_ids uuid[];
  v_restored_staff_ids uuid[];
  v_actor_type public.audit_actor_type;
begin
  v_actor_type := case when p_actor_user_id is null then 'system' else 'user' end;

  v_property_limit := public.org_property_limit(p_org_id);
  v_owner_limit := public.org_owner_limit(p_org_id);
  v_staff_limit := public.org_staff_seat_limit(p_org_id);

  -- === Properties =========================================================
  if v_property_limit is null then
    select coalesce(array_agg(id), '{}') into v_restored_property_ids
      from public.properties where org_id = p_org_id and restricted_by_plan = true;
    v_restricted_property_ids := '{}';
    update public.properties set restricted_by_plan = false
      where org_id = p_org_id and restricted_by_plan = true;
  else
    if p_keep_property_ids is not null then
      -- Explicit customer selection -- honored as-is, defensively capped at the new limit
      -- (oldest-of-the-selection first) only in the pathological case the selection itself is
      -- oversized; the API layer is expected to have already validated selection size.
      select coalesce(array_agg(id), '{}') into v_keep_property_ids from (
        select id from public.properties
        where org_id = p_org_id and status = 'active' and id = any(p_keep_property_ids)
        order by created_at asc
        limit greatest(v_property_limit, 0)
      ) s;
    else
      -- Deterministic default -- unchanged from this function's original behavior.
      select coalesce(array_agg(id), '{}') into v_keep_property_ids from (
        select id from public.properties
        where org_id = p_org_id and status = 'active'
        order by created_at asc
        limit greatest(v_property_limit, 0)
      ) s;
    end if;

    select coalesce(array_agg(id), '{}') into v_restored_property_ids
      from public.properties
      where org_id = p_org_id and restricted_by_plan = true and id = any(v_keep_property_ids);
    select coalesce(array_agg(id), '{}') into v_restricted_property_ids
      from public.properties
      where org_id = p_org_id and status = 'active' and restricted_by_plan = false
        and not (id = any(v_keep_property_ids));

    update public.properties set restricted_by_plan = false where id = any(v_restored_property_ids);
    update public.properties set restricted_by_plan = true where id = any(v_restricted_property_ids);
  end if;

  -- === External owners =====================================================
  if v_owner_limit is null then
    select coalesce(array_agg(id), '{}') into v_restored_owner_ids
      from public.owners where org_id = p_org_id and restricted_by_plan = true;
    v_restricted_owner_ids := '{}';
    update public.owners set restricted_by_plan = false
      where org_id = p_org_id and restricted_by_plan = true;
  else
    if p_keep_owner_ids is not null then
      select coalesce(array_agg(id), '{}') into v_keep_owner_ids from (
        select id from public.owners
        where org_id = p_org_id and status = 'active' and id = any(p_keep_owner_ids)
        order by created_at asc
        limit greatest(v_owner_limit, 0)
      ) s;
    else
      select coalesce(array_agg(id), '{}') into v_keep_owner_ids from (
        select id from public.owners
        where org_id = p_org_id and status = 'active'
        order by created_at asc
        limit greatest(v_owner_limit, 0)
      ) s;
    end if;

    select coalesce(array_agg(id), '{}') into v_restored_owner_ids
      from public.owners
      where org_id = p_org_id and restricted_by_plan = true and id = any(v_keep_owner_ids);
    select coalesce(array_agg(id), '{}') into v_restricted_owner_ids
      from public.owners
      where org_id = p_org_id and status = 'active' and restricted_by_plan = false
        and not (id = any(v_keep_owner_ids));

    update public.owners set restricted_by_plan = false where id = any(v_restored_owner_ids);
    update public.owners set restricted_by_plan = true where id = any(v_restricted_owner_ids);
  end if;

  -- === Staff (never the principal) =========================================
  if v_staff_limit is null then
    select coalesce(array_agg(id), '{}') into v_restored_staff_ids
      from public.organization_members
      where org_id = p_org_id and suspended_by_plan = true;
    v_suspended_staff_ids := '{}';
    update public.organization_members set suspended_by_plan = false
      where org_id = p_org_id and suspended_by_plan = true;
  else
    if p_keep_staff_member_ids is not null then
      select coalesce(array_agg(id), '{}') into v_keep_staff_ids from (
        select id from public.organization_members
        where org_id = p_org_id and role <> 'principal' and status = 'active'
          and id = any(p_keep_staff_member_ids)
        order by joined_at asc
        limit greatest(v_staff_limit, 0)
      ) s;
    else
      select coalesce(array_agg(id), '{}') into v_keep_staff_ids from (
        select id from public.organization_members
        where org_id = p_org_id and role <> 'principal' and status = 'active'
        order by joined_at asc
        limit greatest(v_staff_limit, 0)
      ) s;
    end if;

    select coalesce(array_agg(id), '{}') into v_restored_staff_ids
      from public.organization_members
      where org_id = p_org_id and suspended_by_plan = true and id = any(v_keep_staff_ids);
    select coalesce(array_agg(id), '{}') into v_suspended_staff_ids
      from public.organization_members
      where org_id = p_org_id and role <> 'principal' and status = 'active' and suspended_by_plan = false
        and not (id = any(v_keep_staff_ids));

    update public.organization_members set suspended_by_plan = false where id = any(v_restored_staff_ids);
    update public.organization_members set suspended_by_plan = true where id = any(v_suspended_staff_ids);
  end if;

  -- === Audit trail (one batch event per resource type that actually changed) ==============
  if array_length(v_restricted_property_ids, 1) > 0 then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (p_org_id, p_actor_user_id, v_actor_type, 'billing.properties_restricted_by_plan',
      'organizations', p_org_id, jsonb_build_object('propertyIds', to_jsonb(v_restricted_property_ids), 'reason', p_change_reason));
  end if;
  if array_length(v_restored_property_ids, 1) > 0 then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (p_org_id, p_actor_user_id, v_actor_type, 'billing.properties_restored_by_plan',
      'organizations', p_org_id, jsonb_build_object('propertyIds', to_jsonb(v_restored_property_ids), 'reason', p_change_reason));
  end if;
  if array_length(v_restricted_owner_ids, 1) > 0 then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (p_org_id, p_actor_user_id, v_actor_type, 'billing.owners_restricted_by_plan',
      'organizations', p_org_id, jsonb_build_object('ownerIds', to_jsonb(v_restricted_owner_ids), 'reason', p_change_reason));
  end if;
  if array_length(v_restored_owner_ids, 1) > 0 then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (p_org_id, p_actor_user_id, v_actor_type, 'billing.owners_restored_by_plan',
      'organizations', p_org_id, jsonb_build_object('ownerIds', to_jsonb(v_restored_owner_ids), 'reason', p_change_reason));
  end if;
  if array_length(v_suspended_staff_ids, 1) > 0 then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (p_org_id, p_actor_user_id, v_actor_type, 'billing.staff_suspended_by_plan',
      'organizations', p_org_id, jsonb_build_object('memberIds', to_jsonb(v_suspended_staff_ids), 'reason', p_change_reason));
  end if;
  if array_length(v_restored_staff_ids, 1) > 0 then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (p_org_id, p_actor_user_id, v_actor_type, 'billing.staff_restored_by_plan',
      'organizations', p_org_id, jsonb_build_object('memberIds', to_jsonb(v_restored_staff_ids), 'reason', p_change_reason));
  end if;
end;
$$;

comment on function public.reconcile_plan_limits(uuid, uuid[], uuid[], uuid[], uuid, text) is
  'Applies/lifts restricted_by_plan / suspended_by_plan for properties/owners/staff against the
   org''s CURRENT plan+add-on capacity. Each keep-list parameter, when non-null, is the customer''s
   own explicit choice of which resources of that type stay active; null falls back to the original
   deterministic default (most-recently-created restricted first). Idempotent -- safe to call after
   every plan change, trial-limit reconciliation, or add-on purchase/removal. Never deletes any row,
   never touches property_owners (ownership history/shares are factually separate from portal/
   management entitlement -- see the RLS changes below for the actual access-control effect of these
   flags). Writes one audit_events row per resource-type batch that actually changed.';

revoke all on function public.reconcile_plan_limits(uuid, uuid[], uuid[], uuid[], uuid, text) from public, authenticated, anon;
grant execute on function public.reconcile_plan_limits(uuid, uuid[], uuid[], uuid[], uuid, text) to service_role;

-- ============================================================
-- 3. RLS: restricted_by_plan/suspended_by_plan now actually mean something.
--    organization_members.suspended_by_plan is ALREADY wired into has_org_role() (20260101000115) --
--    unchanged here. properties/owners get the same treatment, scoped narrowly:
--      - a restricted property/owner cannot be UPDATED by staff (WITH CHECK only, not USING, so the
--        rejection is an explicit RLS error the UI can catch and explain, not a silent 0-row no-op).
--      - SELECT/read is completely unaffected for staff -- "restricted, not deleted" means the
--        agency can still see and act to resolve the situation (upgrade, purchase capacity, or
--        choose a different keep-list).
--      - the OWNER'S OWN portal view of a restricted property is hidden (owner_portal_property_
--        restricted() below) -- deliberately NARROW: it only ever fires for a genuine owner
--        identity (auth.uid() actually matches an owners.user_id row for THIS org, with an 'owner'/
--        'administrator' property_access grant), never for staff, so has_property_access()'s
--        existing, heavily-shared semantics for property-manager-role staff grants are completely
--        untouched. property_owners (the actual ownership share/history record) is never read or
--        written by any of this -- ownership truth stays completely separate from portal access.
-- ============================================================
drop policy "properties_update_agent_plus_and_property_access" on public.properties;
create policy "properties_update_agent_plus_and_property_access"
  on public.properties for update
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(id, 'property_manager') or public.has_property_access(id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(id, 'property_manager') or public.has_property_access(id, 'owner'))
    and not restricted_by_plan
  );

comment on policy "properties_update_agent_plus_and_property_access" on public.properties is
  'V1 commercial UX pass: added "and not restricted_by_plan" to WITH CHECK only (not USING) -- a
   restricted property stays fully visible/selectable, but any UPDATE against it is rejected with an
   explicit RLS error rather than silently matching zero rows. Lifted automatically the moment
   reconcile_plan_limits() restores it (upgrade, added capacity, or the customer choosing to keep a
   different property instead).';

drop policy "owners_update_agent_plus" on public.owners;
create policy "owners_update_agent_plus"
  on public.owners for update
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent') and not restricted_by_plan);

comment on policy "owners_update_agent_plus" on public.owners is
  'V1 commercial UX pass: same "and not restricted_by_plan" WITH-CHECK-only treatment as
   properties_update_agent_plus_and_property_access. Never touches property_owners (ownership
   shares/history) -- restriction is scoped to the owners row (the portal/management identity)
   only, per this pass''s own explicit ownership-safety requirement.';

create or replace function public.owner_portal_property_restricted(target_property_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.property_access pa
    join public.properties p on p.id = pa.property_id
    join public.owners o on o.user_id = pa.user_id and o.org_id = p.org_id
    where pa.property_id = target_property_id
      and pa.user_id = auth.uid()
      and pa.property_role in ('owner', 'administrator')
      and o.restricted_by_plan = true
  );
$$;

comment on function public.owner_portal_property_restricted(uuid) is
  'V1 commercial UX pass: true only when the CALLING user is a genuine owner identity (a real
   owners.user_id row for this specific org, not a staff property_access grant that merely happens
   to hold role owner/administrator) whose owners row is currently restricted_by_plan. Used to
   narrow properties_select_staff_or_owner''s owner-only branch WITHOUT touching
   has_property_access() itself, which is shared by staff property-manager/accountant/maintenance
   grants that must remain completely unaffected by an owner-capacity downgrade.';

revoke all on function public.owner_portal_property_restricted(uuid) from public;
grant execute on function public.owner_portal_property_restricted(uuid) to authenticated;

drop policy "properties_select_staff_or_owner" on public.properties;
create policy "properties_select_staff_or_owner"
  on public.properties for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_property_access(id, 'read_only'))
    or (public.has_property_access(id, 'owner') and not public.owner_portal_property_restricted(id))
  );

comment on policy "properties_select_staff_or_owner" on public.properties is
  'V1 commercial UX pass: the staff branch (has_org_role + read_only property_access) is completely
   unchanged -- the agency can always see every property to resolve a downgrade. Only the owner-only
   branch is narrowed by owner_portal_property_restricted(), hiding this property from a restricted
   owner''s own portal view while their org resolves capacity (upgrade, purchase an owner add-on, or
   choose a different keep-list). property_owners (ownership share/history) is untouched -- the
   ownership record itself remains factually intact regardless of portal visibility.';

-- ============================================================
-- 4. confirm_plan_change() -- extended with keep-list passthrough AND the PRODUCT DECISION that a
--    downgrade while org.status = 'trial' takes effect IMMEDIATELY (reconciled synchronously, right
--    here) instead of being scheduled for current_period_end. Every other outcome (upgrade,
--    reactivation, no_change, and a downgrade for an active/overdue org) is BYTE-FOR-BYTE UNCHANGED
--    from the pre-existing function -- a trial org is the ONLY case whose control flow differs, and
--    only because compute_plan_change_quote() below now marks that one case's effective_at as "now"
--    instead of period_end (a trial org has paid nothing for "the remainder of this period," so
--    there is no economic reason to let it keep a higher tier''s access for free until day 30).
-- ============================================================
create or replace function public.compute_plan_change_quote(p_org_id uuid, p_target_plan_id uuid)
returns public.plan_change_quote_result
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org public.organizations%rowtype;
  v_sub public.organization_subscriptions%rowtype;
  v_current_plan public.plans%rowtype;
  v_target_plan public.plans%rowtype;
  v_current_effective numeric(10, 2);
  v_target_effective numeric(10, 2);
  v_fraction numeric(6, 5);
  v_result public.plan_change_quote_result;
begin
  if not public.has_billing_principal_access(p_org_id) then
    raise exception 'Only the organization principal may request a billing quote';
  end if;

  select * into v_org from public.organizations where id = p_org_id;
  if v_org.id is null then
    raise exception 'Organization not found';
  end if;

  select * into v_target_plan from public.plans where id = p_target_plan_id and is_active;
  if v_target_plan.id is null then
    raise exception 'Target plan not found or inactive';
  end if;
  v_target_effective := v_target_plan.base_price;

  select * into v_sub
    from public.organization_subscriptions
    where org_id = p_org_id
    order by current_period_start desc
    limit 1;

  if v_sub.id is null then
    v_result.change_type := 'new_subscription';
    v_result.current_plan_id := null;
    v_result.current_plan_code := null;
    v_result.target_plan_id := v_target_plan.id;
    v_result.target_plan_code := v_target_plan.code;
    v_result.current_effective_price := null;
    v_result.target_effective_price := v_target_effective;
    v_result.current_period_start := null;
    v_result.current_period_end := null;
    v_result.proration_fraction := null;
    v_result.amount_due_now := v_target_effective;
    v_result.next_renewal_amount := v_target_effective;
    v_result.currency := v_target_plan.currency;
    v_result.effective_at := now();
    return v_result;
  end if;

  select * into v_current_plan from public.plans where id = v_sub.plan_id;

  if v_org.status in ('suspended', 'cancelled') then
    v_result.change_type := 'reactivation';
    v_result.current_plan_id := v_current_plan.id;
    v_result.current_plan_code := v_current_plan.code;
    v_result.target_plan_id := v_target_plan.id;
    v_result.target_plan_code := v_target_plan.code;
    v_result.current_effective_price := null;
    v_result.target_effective_price := v_target_effective;
    v_result.current_period_start := v_sub.current_period_start;
    v_result.current_period_end := v_sub.current_period_end;
    v_result.proration_fraction := null;
    v_result.amount_due_now := v_target_effective;
    v_result.next_renewal_amount := v_target_effective;
    v_result.currency := v_target_plan.currency;
    v_result.effective_at := now();
    return v_result;
  end if;

  v_current_effective := greatest(
    0,
    coalesce(v_sub.price_override, v_current_plan.base_price)
      * (1 - coalesce(v_sub.discount_pct, 0) / 100)
      - coalesce(v_sub.promotional_credit, 0)
  );

  if v_current_plan.id = v_target_plan.id then
    v_result.change_type := 'no_change';
    v_result.current_plan_id := v_current_plan.id;
    v_result.current_plan_code := v_current_plan.code;
    v_result.target_plan_id := v_target_plan.id;
    v_result.target_plan_code := v_target_plan.code;
    v_result.current_effective_price := v_current_effective;
    v_result.target_effective_price := v_target_effective;
    v_result.current_period_start := v_sub.current_period_start;
    v_result.current_period_end := v_sub.current_period_end;
    v_result.proration_fraction := 0;
    v_result.amount_due_now := 0;
    v_result.next_renewal_amount := v_current_effective;
    v_result.currency := v_current_plan.currency;
    v_result.effective_at := now();
    return v_result;
  end if;

  v_fraction := least(
    1,
    greatest(
      0,
      (v_sub.current_period_end - current_date)::numeric
        / nullif((v_sub.current_period_end - v_sub.current_period_start)::numeric, 0)
    )
  );
  v_fraction := coalesce(v_fraction, 0);

  if v_target_effective >= v_current_effective then
    v_result.change_type := 'upgrade';
    v_result.effective_at := now();
    v_result.amount_due_now := round((v_target_effective - v_current_effective) * v_fraction, 2);
  else
    v_result.change_type := 'downgrade';
    -- PRODUCT DECISION (this date): a TRIAL org's downgrade is effective immediately -- it has
    -- collected/paid nothing for "the remainder of this period" (trial R0), so there is no
    -- current-period entitlement to honor until period_end the way a paying org's is. Every other
    -- status (active/overdue) is completely unchanged: still scheduled for current_period_end.
    if v_org.status = 'trial' then
      v_result.effective_at := now();
    else
      v_result.effective_at := v_sub.current_period_end::timestamptz;
    end if;
    v_result.amount_due_now := 0;
  end if;

  v_result.current_plan_id := v_current_plan.id;
  v_result.current_plan_code := v_current_plan.code;
  v_result.target_plan_id := v_target_plan.id;
  v_result.target_plan_code := v_target_plan.code;
  v_result.current_effective_price := v_current_effective;
  v_result.target_effective_price := v_target_effective;
  v_result.current_period_start := v_sub.current_period_start;
  v_result.current_period_end := v_sub.current_period_end;
  v_result.proration_fraction := v_fraction;
  v_result.next_renewal_amount := v_target_effective;
  v_result.currency := v_current_plan.currency;
  return v_result;
end;
$$;

comment on function public.compute_plan_change_quote(uuid, uuid) is
  'RELEASE A P0, extended by the V1 commercial UX pass (this date): the downgrade branch''s
   effective_at is now() instead of current_period_end when the org is currently on status=trial --
   see this migration''s own header comment for the reasoning. Every other branch (new_subscription,
   reactivation, no_change, upgrade, and downgrade for a non-trial org) is byte-for-byte identical to
   the original RELEASE A version. Still pure/side-effect-free/STABLE.';

-- Same overload hazard as reconcile_plan_limits() above -- drop the single-argument original first.
drop function if exists public.confirm_plan_change(uuid);

create or replace function public.confirm_plan_change(
  p_quote_id uuid,
  p_keep_property_ids uuid[] default null,
  p_keep_owner_ids uuid[] default null,
  p_keep_staff_member_ids uuid[] default null
)
returns public.plan_change_confirmation_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.billing_change_quotes%rowtype;
  v_existing public.billing_plan_changes%rowtype;
  v_computed public.plan_change_quote_result;
  v_change public.billing_plan_changes%rowtype;
  v_result public.plan_change_confirmation_result;
  v_org_status public.organization_status;
  v_immediate_downgrade boolean;
begin
  select * into v_quote from public.billing_change_quotes where id = p_quote_id for update;
  if v_quote.id is null then
    raise exception 'Quote not found';
  end if;
  if not public.has_billing_principal_access(v_quote.org_id) then
    raise exception 'Only the organization principal may confirm a billing change';
  end if;

  if v_quote.consumed_at is not null then
    select * into v_existing from public.billing_plan_changes where id = v_quote.consumed_by_change_id;
    v_result.billing_plan_change_id := v_existing.id;
    v_result.change_type := v_existing.change_type;
    v_result.status := v_existing.status;
    v_result.amount_due_now := v_existing.charge_due;
    v_result.currency := v_existing.currency;
    v_result.effective_at := v_existing.effective_at;
    v_result.requires_payment := v_existing.status = 'awaiting_payment';
    v_result.already_processed := true;
    return v_result;
  end if;

  if v_quote.expires_at < now() then
    raise exception 'This quote has expired -- request a new one';
  end if;

  v_computed := public.compute_plan_change_quote(v_quote.org_id, v_quote.target_plan_id);

  select status into v_org_status from public.organizations where id = v_quote.org_id;
  v_immediate_downgrade := v_computed.change_type = 'downgrade' and v_computed.effective_at <= now();

  update public.billing_plan_changes
    set status = 'cancelled', cancelled_at = now()
    where org_id = v_quote.org_id and status = 'scheduled';

  insert into public.billing_plan_changes (
    org_id, actor_user_id, change_type, old_plan_id, new_plan_id,
    old_effective_price, new_effective_price, period_start, period_end,
    proration_fraction, charge_due, currency, status, quote_id, effective_at,
    keep_property_ids, keep_owner_ids, keep_staff_member_ids
  )
  values (
    v_quote.org_id, auth.uid(), v_computed.change_type, v_computed.current_plan_id, v_computed.target_plan_id,
    v_computed.current_effective_price, v_computed.target_effective_price,
    v_computed.current_period_start, v_computed.current_period_end,
    v_computed.proration_fraction, v_computed.amount_due_now, v_computed.currency,
    case
      when v_computed.change_type = 'downgrade' and v_immediate_downgrade then 'completed'
      when v_computed.change_type = 'downgrade' then 'scheduled'
      when v_computed.amount_due_now > 0 then 'awaiting_payment'
      else 'completed'
    end::public.billing_plan_change_status,
    v_quote.id, v_computed.effective_at,
    p_keep_property_ids, p_keep_owner_ids, p_keep_staff_member_ids
  )
  returning * into v_change;

  if v_change.status = 'completed' and v_computed.change_type in ('upgrade', 'no_change') then
    if v_computed.change_type = 'upgrade' then
      update public.organization_subscriptions
        set plan_id = v_computed.target_plan_id
        where id = (
          select id from public.organization_subscriptions
          where org_id = v_quote.org_id
          order by current_period_start desc
          limit 1
        );
      -- An upgrade may have just lifted a prior restriction (more capacity, or a plan that now
      -- includes external owners at all) -- reconcile immediately so previously-restricted
      -- resources become eligible for restoration without the customer having to do anything else.
      -- Deliberately passes NULL keep-lists: an upgrade never needs to CHOOSE what to restrict
      -- (nothing new becomes over-limit), only what to restore, which reconcile_plan_limits()
      -- already does correctly for a raised/unlimited capacity regardless of keep-list.
      perform public.reconcile_plan_limits(v_quote.org_id, null, null, null, auth.uid(), 'upgrade');
    end if;
    update public.billing_plan_changes set completed_at = now() where id = v_change.id;
  elsif v_change.status = 'completed' and v_computed.change_type = 'downgrade' then
    -- Immediate (trial) downgrade -- flip the plan NOW and reconcile synchronously, in the SAME
    -- transaction as recording the change, so there is never a window where the org is on the new
    -- (lower) plan_id but still shows the old plan's full, unrestricted resource set (or vice
    -- versa). Mirrors apply_due_scheduled_plan_changes()'s own plan_id-flip statement exactly.
    update public.organization_subscriptions
      set plan_id = v_computed.target_plan_id
      where id = (
        select id from public.organization_subscriptions
        where org_id = v_quote.org_id
        order by current_period_start desc
        limit 1
      );
    perform public.reconcile_plan_limits(
      v_quote.org_id, p_keep_property_ids, p_keep_owner_ids, p_keep_staff_member_ids,
      auth.uid(), 'trial_downgrade_immediate'
    );
    update public.billing_plan_changes set completed_at = now() where id = v_change.id;
  end if;

  update public.billing_change_quotes
    set consumed_at = now(), consumed_by_change_id = v_change.id
    where id = v_quote.id;

  v_result.billing_plan_change_id := v_change.id;
  v_result.change_type := v_change.change_type;
  v_result.status := v_change.status;
  v_result.amount_due_now := v_change.charge_due;
  v_result.currency := v_change.currency;
  v_result.effective_at := v_change.effective_at;
  v_result.requires_payment := v_change.status = 'awaiting_payment';
  v_result.already_processed := false;
  return v_result;
end;
$$;

comment on function public.confirm_plan_change(uuid, uuid[], uuid[], uuid[]) is
  'RELEASE A P0, extended by the V1 commercial UX pass: three new keep-list parameters (all default
   null, so every pre-existing caller''s behavior is unchanged) let the customer pass their explicit
   choice of which resources stay active. NEW behavior, scoped narrowly: when
   compute_plan_change_quote() reports a downgrade whose effective_at is now (only possible for a
   trial org, see that function''s own comment), this applies the new plan_id AND calls
   reconcile_plan_limits() SYNCHRONOUSLY in this same call/transaction, rather than leaving a
   status=scheduled row for apply_due_scheduled_plan_changes() to pick up later. An
   upgrade also now calls reconcile_plan_limits() (restore-only, since nothing can newly exceed a
   raised limit) so previously-restricted resources become eligible immediately. A downgrade for a
   non-trial (active/overdue) org is completely unchanged: still scheduled for current_period_end,
   with the keep-lists simply stored on the row for apply_due_scheduled_plan_changes() to use later.';

revoke all on function public.confirm_plan_change(uuid, uuid[], uuid[], uuid[]) from public;
grant execute on function public.confirm_plan_change(uuid, uuid[], uuid[], uuid[]) to authenticated;

-- ============================================================
-- 5. Let the customer set (or change) the keep-list for an already-scheduled downgrade any time
--    before it takes effect -- "before the effective downgrade date," not only at confirm time.
-- ============================================================
create or replace function public.set_scheduled_downgrade_selection(
  p_org_id uuid,
  p_keep_property_ids uuid[] default null,
  p_keep_owner_ids uuid[] default null,
  p_keep_staff_member_ids uuid[] default null
)
returns public.billing_plan_changes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_plan_changes%rowtype;
begin
  if not public.has_billing_principal_access(p_org_id) then
    raise exception 'Only the organization principal may manage a scheduled downgrade';
  end if;

  update public.billing_plan_changes
    set keep_property_ids = p_keep_property_ids,
        keep_owner_ids = p_keep_owner_ids,
        keep_staff_member_ids = p_keep_staff_member_ids
    where org_id = p_org_id and status = 'scheduled' and change_type = 'downgrade'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'No pending scheduled downgrade for this organization';
  end if;

  return v_row;
end;
$$;

comment on function public.set_scheduled_downgrade_selection(uuid, uuid[], uuid[], uuid[]) is
  'V1 commercial UX pass: lets the principal set/replace which resources stay active for their OWN
   pending scheduled downgrade, any time before it applies at current_period_end. Passing null for a
   given resource type reverts that type to the deterministic default. Irrelevant (never called) for
   an immediate trial downgrade, which requires the selection at confirm_plan_change() time itself
   since there is no waiting period to make the choice in.';

revoke all on function public.set_scheduled_downgrade_selection(uuid, uuid[], uuid[], uuid[]) from public;
grant execute on function public.set_scheduled_downgrade_selection(uuid, uuid[], uuid[], uuid[]) to authenticated;

-- ============================================================
-- 6. apply_due_scheduled_plan_changes() -- now also flips access, not just plan_id. Reconciliation
--    happens AFTER the plan_id update, in the SAME loop iteration/transaction, so there is no
--    window where the new (lower) plan_id is live but the old (higher) entitlement's resource set
--    is still fully unrestricted.
-- ============================================================
create or replace function public.apply_due_scheduled_plan_changes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_plan_changes%rowtype;
  v_applied integer := 0;
  v_new_period_start date;
  v_new_period_end date;
  v_billing_cycle public.billing_cycle;
begin
  for v_row in
    select * from public.billing_plan_changes
    where status = 'scheduled' and effective_at <= now()
    order by effective_at
  loop
    select os.billing_cycle into v_billing_cycle
      from public.organization_subscriptions os
      where os.org_id = v_row.org_id
      order by os.current_period_start desc
      limit 1;

    v_new_period_start := v_row.period_end;
    v_new_period_end := v_new_period_start + case coalesce(v_billing_cycle, 'monthly') when 'annual' then interval '1 year' else interval '1 month' end;

    update public.organization_subscriptions
      set plan_id = v_row.new_plan_id
      where id = (
        select id from public.organization_subscriptions
        where org_id = v_row.org_id
        order by current_period_start desc
        limit 1
      );

    if v_row.change_type = 'downgrade' then
      perform public.reconcile_plan_limits(
        v_row.org_id, v_row.keep_property_ids, v_row.keep_owner_ids, v_row.keep_staff_member_ids,
        null, 'downgrade'
      );
    end if;

    update public.billing_plan_changes
      set status = 'completed', completed_at = now()
      where id = v_row.id;

    v_applied := v_applied + 1;
  end loop;

  return v_applied;
end;
$$;

comment on function public.apply_due_scheduled_plan_changes() is
  'RELEASE A, extended by the V1 commercial UX pass: after flipping plan_id for a due downgrade, now
   ALSO calls reconcile_plan_limits() with whatever keep-list the customer set (via
   confirm_plan_change() or set_scheduled_downgrade_selection()), or the deterministic default if
   they never chose one -- the actual PRODUCT DECISION this pass implements: a downgrade no longer
   just blocks new resource creation, it actively restricts existing over-allowance resources (never
   deletes any data). Still never deletes/archives anything itself, still idempotent by construction
   (a row leaves status=scheduled the moment it is applied).';

revoke all on function public.apply_due_scheduled_plan_changes() from public;
grant execute on function public.apply_due_scheduled_plan_changes() to service_role;
