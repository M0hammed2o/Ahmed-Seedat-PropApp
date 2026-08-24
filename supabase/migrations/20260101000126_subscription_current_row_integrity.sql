-- Subscription integrity fix (read-only production audit found Mo's Properties with 2
-- simultaneous organization_subscriptions rows, both status='trial', identical
-- current_period_start -- neither ever confirmed by a real PayFast payment/ITN).
--
-- Root cause (full audit in WORKLOG.md this date): (1) every "current subscription" reader in this
-- codebase -- 10 SQL functions, 9 TypeScript call sites -- resolves the current row via
-- `order by current_period_start desc limit 1`, with no secondary tiebreaker; when two rows share
-- the same current_period_start (as happened here), which one wins is undefined by SQL semantics.
-- (2) `startSubscriptionCheckout()`/`startTrialActivationCheckout()` (lib/billing.ts) INSERT a new
-- organization_subscriptions row unconditionally on every call, with no check for an already-open,
-- unresolved 'trial' row from a prior attempt -- nothing in the schema or these functions prevents
-- a retry/double-submit from creating a second row before the first ever resolves.
--
-- This migration fixes (1): every reader gets a deterministic `, created_at desc` tiebreaker, and a
-- new partial unique index makes "at most one commercially-current row per org" a real, enforced
-- DB guarantee, not just an assumption. (2) is a TypeScript-only fix (this same commit,
-- lib/billing.ts) -- reuses an existing unresolved row instead of inserting a new one, and the new
-- unique index below is what makes even a genuine concurrent-request race safe (a losing INSERT
-- fails with 23505, which the application code catches and turns into a reuse).
--
-- Audited exhaustively (WORKLOG.md this date) that no legitimate workflow ever requires two
-- simultaneous 'trial'/'active' rows for the same org -- every UPDATE-based writer (webhook
-- confirmation, cancellation, downgrade/upgrade, add-on purchase, credits) already assumes exactly
-- one current row exists; only the Super Admin plan-change route and the two checkout-initiation
-- functions above ever INSERT, and none of them need a second *simultaneous* current row, only a
-- new one dated in the future (a real plan change) or none until the app-level fix above lands.
--
-- Production-safety decision (explicit, per instruction, over silently repairing customer data):
-- this migration does NOT auto-repair any existing duplicate. The unique index at the bottom is
-- preceded by a guard that RAISES and refuses to apply if any org still has more than one
-- 'trial'/'active' row -- so this migration cannot succeed against production until Mo's
-- Properties' two rows are explicitly, separately cleaned up (a reviewed, human-approved SQL
-- statement, documented in WORKLOG.md this date, NOT included in this migration and NOT yet run).
-- A fresh/clean database (local dev, a future CI run) has no duplicates and the guard is a no-op.
-- A full production audit (this date) confirmed Mo's Properties is the ONLY organization, across
-- all 4 production orgs, with more than one current-status row -- nothing else to report.

-- ============================================================
-- 1. Deterministic current-row selection -- every RPC that resolves "the current subscription"
--    gets an identical, explicit secondary key. Ordering alone is not the integrity mechanism (the
--    unique index in section 3 is); this section makes every reader consistent and reproducible
--    regardless of whether the index-guard below ends up blocking on Mo's Properties.
-- ============================================================

create or replace function public.org_property_limit(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when (p.feature_limits ->> 'maxProperties') is null then null
      else (p.feature_limits ->> 'maxProperties')::integer + os.purchased_extra_properties
    end
  from public.organization_subscriptions os
  join public.plans p on p.id = os.plan_id
  where os.org_id = p_org_id
  order by os.current_period_start desc, os.created_at desc
  limit 1;
$$;

comment on function public.org_property_limit(uuid) is
  'The org''s current plan''s feature_limits.maxProperties PLUS any purchased_extra_properties
   (null base = unlimited, add-ons irrelevant in that case). Returns null (unlimited) for an org
   with no organization_subscriptions row at all -- unchanged convention from 20260101000102.
   Subscription integrity fix (this date): added created_at as a secondary sort key so the "current"
   row is deterministic even if two rows ever shared current_period_start (should no longer be
   possible given this migration''s own unique index, but this must not silently rely on that alone).';

create or replace function public.org_staff_seat_limit(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select (p.feature_limits ->> 'maxStaff')::integer
  from public.organization_subscriptions os
  join public.plans p on p.id = os.plan_id
  where os.org_id = p_org_id
  order by os.current_period_start desc, os.created_at desc
  limit 1;
$$;

comment on function public.org_staff_seat_limit(uuid) is
  'The org''s current plan''s feature_limits.maxStaff (null = unlimited, matching the existing
   maxProperties null-means-unlimited convention on the same jsonb column -- seeded
   20260101000075, never previously read by any query). Returns null (unlimited) for an org with
   no organization_subscriptions row at all, or a plan with no maxStaff key -- deliberately
   permissive so every existing organization/test fixture, none of which populate
   organization_subscriptions by default, keeps working unchanged. Subscription integrity fix
   (this date): added created_at as a secondary sort key, same reasoning as org_property_limit().';

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
      order by os.current_period_start desc, os.created_at desc
      limit 1
    ),
    not exists (select 1 from public.organization_subscriptions where organization_subscriptions.org_id = p_org_id)
  );
$$;

comment on function public.org_feature_enabled(uuid, text) is
  'Subscription integrity fix (this date): added created_at as a secondary sort key, same
   reasoning as org_property_limit(). Behavior otherwise unchanged from 20260101000102.';

create or replace function public.org_owner_limit(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when (p.feature_limits ->> 'includedOwners') is null then null
      else (p.feature_limits ->> 'includedOwners')::integer + os.purchased_extra_owner_slots
    end
  from public.organization_subscriptions os
  join public.plans p on p.id = os.plan_id
  where os.org_id = p_org_id
  order by os.current_period_start desc, os.created_at desc
  limit 1;
$$;

comment on function public.org_owner_limit(uuid) is
  'Subscription integrity fix (this date): added created_at as a secondary sort key, same
   reasoning as org_property_limit(). Behavior otherwise unchanged from 20260101000112.';

-- ============================================================
-- 2. Same deterministic tiebreaker inside every write-path RPC that locates "the current row" to
--    UPDATE (plan changes, add-on capacity). These never insert a second current row themselves --
--    only the tiebreaker changes; every other line is byte-for-byte identical to each function's
--    prior definition (re-verified against the live migration source before writing this file).
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
    order by current_period_start desc, created_at desc
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
  'Subscription integrity fix (this date): added created_at as a secondary sort key when resolving
   the current subscription row. Every other line is unchanged from 20260101000121.';

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
          order by current_period_start desc, created_at desc
          limit 1
        );
      perform public.reconcile_plan_limits(v_quote.org_id, null, null, null, auth.uid(), 'upgrade');
      perform public.reconcile_addon_capacity_on_upgrade(v_quote.org_id);
    end if;
    update public.billing_plan_changes set completed_at = now() where id = v_change.id;
  elsif v_change.status = 'completed' and v_computed.change_type = 'downgrade' then
    update public.organization_subscriptions
      set plan_id = v_computed.target_plan_id
      where id = (
        select id from public.organization_subscriptions
        where org_id = v_quote.org_id
        order by current_period_start desc, created_at desc
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
  'Subscription integrity fix (this date): added created_at as a secondary sort key (both
   occurrences) when resolving the current subscription row to update. Every other line is
   unchanged from 20260101000122.';

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
      order by os.current_period_start desc, os.created_at desc
      limit 1;

    v_new_period_start := v_row.period_end;
    v_new_period_end := v_new_period_start + case coalesce(v_billing_cycle, 'monthly') when 'annual' then interval '1 year' else interval '1 month' end;

    update public.organization_subscriptions
      set plan_id = v_row.new_plan_id
      where id = (
        select id from public.organization_subscriptions
        where org_id = v_row.org_id
        order by current_period_start desc, created_at desc
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
  'Subscription integrity fix (this date): added created_at as a secondary sort key (both
   occurrences) when resolving the current subscription row. Every other line is unchanged from
   20260101000121.';

create or replace function public.set_property_addon_capacity(
  p_org_id uuid,
  p_target_quantity integer,
  p_keep_property_ids uuid[] default null,
  p_actor_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.organization_subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_old_quantity integer;
  v_new_effective_limit integer;
  v_active_count integer;
begin
  if p_target_quantity < 0 then
    raise exception 'invalid_addon_quantity: target quantity cannot be negative';
  end if;

  select * into v_sub from public.organization_subscriptions
    where org_id = p_org_id order by current_period_start desc, created_at desc limit 1;
  if v_sub.id is null then
    raise exception 'no_subscription: organization has no subscription on record';
  end if;

  select * into v_plan from public.plans where id = v_sub.plan_id;
  if (v_plan.feature_limits ->> 'extraPropertyPrice') is null then
    raise exception 'addon_not_supported_by_plan: % does not offer extra property capacity', v_plan.code;
  end if;

  v_old_quantity := v_sub.purchased_extra_properties;

  if p_target_quantity < v_old_quantity then
    v_new_effective_limit := (v_plan.feature_limits ->> 'maxProperties')::integer + p_target_quantity;
    select count(*)::integer into v_active_count
      from public.properties where org_id = p_org_id and status = 'active';
    if v_active_count > v_new_effective_limit and p_keep_property_ids is null then
      raise exception 'addon_removal_requires_selection: % properties in use exceeds the new % capacity -- choose which stay active first', v_active_count, v_new_effective_limit;
    end if;
  end if;

  update public.organization_subscriptions
    set purchased_extra_properties = p_target_quantity
    where id = v_sub.id;

  perform public.reconcile_plan_limits(
    p_org_id, p_keep_property_ids, null, null, p_actor_user_id,
    case when p_target_quantity > v_old_quantity then 'addon_purchased' else 'addon_removed' end
  );

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after)
  values (
    p_org_id, p_actor_user_id, case when p_actor_user_id is null then 'system' else 'user' end::public.audit_actor_type,
    'billing.property_addon_capacity_changed', 'organization_subscriptions', v_sub.id,
    jsonb_build_object('purchasedExtraProperties', v_old_quantity),
    jsonb_build_object('purchasedExtraProperties', p_target_quantity)
  );

  return p_target_quantity;
end;
$$;

comment on function public.set_property_addon_capacity(uuid, integer, uuid[], uuid) is
  'Subscription integrity fix (this date): added created_at as a secondary sort key when resolving
   the current subscription row. Every other line is unchanged from 20260101000122.';

create or replace function public.set_owner_addon_capacity(
  p_org_id uuid,
  p_target_quantity integer,
  p_keep_owner_ids uuid[] default null,
  p_actor_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.organization_subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_old_quantity integer;
  v_new_effective_limit integer;
  v_active_count integer;
begin
  if p_target_quantity < 0 then
    raise exception 'invalid_addon_quantity: target quantity cannot be negative';
  end if;

  select * into v_sub from public.organization_subscriptions
    where org_id = p_org_id order by current_period_start desc, created_at desc limit 1;
  if v_sub.id is null then
    raise exception 'no_subscription: organization has no subscription on record';
  end if;

  select * into v_plan from public.plans where id = v_sub.plan_id;
  if (v_plan.feature_limits ->> 'extraOwnerPrice') is null then
    raise exception 'addon_not_supported_by_plan: % does not offer extra owner capacity', v_plan.code;
  end if;

  v_old_quantity := v_sub.purchased_extra_owner_slots;

  if p_target_quantity < v_old_quantity then
    v_new_effective_limit := coalesce((v_plan.feature_limits ->> 'includedOwners')::integer, 0) + p_target_quantity;
    select count(*)::integer into v_active_count
      from public.owners where org_id = p_org_id and status = 'active';
    if v_active_count > v_new_effective_limit and p_keep_owner_ids is null then
      raise exception 'addon_removal_requires_selection: % owners in use exceeds the new % capacity -- choose which stay active first', v_active_count, v_new_effective_limit;
    end if;
  end if;

  update public.organization_subscriptions
    set purchased_extra_owner_slots = p_target_quantity
    where id = v_sub.id;

  perform public.reconcile_plan_limits(
    p_org_id, null, p_keep_owner_ids, null, p_actor_user_id,
    case when p_target_quantity > v_old_quantity then 'addon_purchased' else 'addon_removed' end
  );

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after)
  values (
    p_org_id, p_actor_user_id, case when p_actor_user_id is null then 'system' else 'user' end::public.audit_actor_type,
    'billing.owner_addon_capacity_changed', 'organization_subscriptions', v_sub.id,
    jsonb_build_object('purchasedExtraOwnerSlots', v_old_quantity),
    jsonb_build_object('purchasedExtraOwnerSlots', p_target_quantity)
  );

  return p_target_quantity;
end;
$$;

comment on function public.set_owner_addon_capacity(uuid, integer, uuid[], uuid) is
  'Subscription integrity fix (this date): added created_at as a secondary sort key when resolving
   the current subscription row. Every other line is unchanged from 20260101000122.';

create or replace function public.reconcile_addon_capacity_on_upgrade(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.organization_subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_active_properties integer;
  v_active_owners integer;
  v_base_property_limit integer;
  v_base_owner_limit integer;
  v_required_extra_properties integer;
  v_required_extra_owners integer;
begin
  select * into v_sub from public.organization_subscriptions
    where org_id = p_org_id order by current_period_start desc, created_at desc limit 1;
  if v_sub.id is null then return; end if;

  select * into v_plan from public.plans where id = v_sub.plan_id;
  v_base_property_limit := (v_plan.feature_limits ->> 'maxProperties')::integer;
  v_base_owner_limit := (v_plan.feature_limits ->> 'includedOwners')::integer;

  if v_base_property_limit is null then
    update public.organization_subscriptions set purchased_extra_properties = 0 where id = v_sub.id;
  else
    select count(*)::integer into v_active_properties
      from public.properties where org_id = p_org_id and status = 'active';
    v_required_extra_properties := greatest(0, v_active_properties - v_base_property_limit);
    if v_sub.purchased_extra_properties > v_required_extra_properties then
      update public.organization_subscriptions
        set purchased_extra_properties = v_required_extra_properties where id = v_sub.id;
    end if;
  end if;

  if v_base_owner_limit is null then
    update public.organization_subscriptions set purchased_extra_owner_slots = 0 where id = v_sub.id;
  else
    select count(*)::integer into v_active_owners
      from public.owners where org_id = p_org_id and status = 'active';
    v_required_extra_owners := greatest(0, v_active_owners - v_base_owner_limit);
    if v_sub.purchased_extra_owner_slots > v_required_extra_owners then
      update public.organization_subscriptions
        set purchased_extra_owner_slots = v_required_extra_owners where id = v_sub.id;
    end if;
  end if;
end;
$$;

comment on function public.reconcile_addon_capacity_on_upgrade(uuid) is
  'Subscription integrity fix (this date): added created_at as a secondary sort key when resolving
   the current subscription row. Every other line is unchanged from 20260101000122.';

-- ============================================================
-- 3. The real integrity mechanism: at most one commercially-current row per org.
--
-- Audited exhaustively (WORKLOG.md this date): organization_subscriptions.status is only ever
-- written as 'trial' (checkout-initiated), 'active' (webhook payment_succeeded), or 'cancelled'
-- (explicit cancellation or a gateway-reported cancellation webhook) -- never 'overdue' or
-- 'suspended' (those two apply only to organizations.status, via expire_trials_and_suspend_
-- overdue() and the webhook's payment_failed branch, neither of which ever touches this table) and
-- never 'archived' (no writer uses it here at all). 'trial' and 'active' are therefore the complete
-- set of commercially-current statuses for THIS table today.
--
-- Guard: refuses to create the index (raising, not silently skipping or repairing) if any org
-- still has more than one row with status in ('trial','active') -- see this file's header comment.
-- ============================================================

do $$
declare
  v_dupe_count integer;
  v_dupe_orgs text;
begin
  select count(*), string_agg(org_id::text, ', ')
    into v_dupe_count, v_dupe_orgs
  from (
    select org_id
    from public.organization_subscriptions
    where status in ('trial', 'active')
    group by org_id
    having count(*) > 1
  ) dupes;

  if v_dupe_count > 0 then
    raise exception
      'subscription_integrity_guard: % organization(s) still have more than one trial/active organization_subscriptions row (org_id(s): %) -- run the reviewed cleanup documented in WORKLOG.md this date BEFORE re-applying this migration. Refusing to create the unique index against dirty data.',
      v_dupe_count, v_dupe_orgs;
  end if;
end;
$$;

create unique index organization_subscriptions_one_current_per_org
  on public.organization_subscriptions (org_id)
  where status in ('trial', 'active');

comment on index public.organization_subscriptions_one_current_per_org is
  'Subscription integrity fix (this date): enforces at most one commercially-current
   (trial/active) organization_subscriptions row per org. A checkout-initiation INSERT that would
   violate this (a genuine concurrent-request race, or an app-level bug) fails with 23505; the
   application (lib/billing.ts, this same commit) catches that and reuses the row that won instead
   of erroring out to the customer.';
