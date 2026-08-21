-- V1 commercial UX pass: add-on purchasing (extra property/owner capacity). Server-authoritative
-- only -- these two functions are the SOLE way purchased_extra_properties/purchased_extra_owner_
-- slots (migration 20260101000112) are ever mutated; both are service_role-only (called from
-- application code AFTER a verified PayFast Management API amendment succeeds, never from a
-- client-reachable RPC and never on browser-return success alone -- see lib/addons.ts).
--
-- Each takes the ABSOLUTE target quantity, not a delta -- idempotent by construction: a retried
-- call (network timeout, duplicate request) converges to the same end state instead of double-
-- applying, without needing a separate idempotency-key dedup table the way a checkout does.
--
-- Reuses reconcile_plan_limits() for the actual locking/restoring effect (never duplicates that
-- logic) -- an increase is restore-only (its own keep-lists are irrelevant, matching confirm_plan_
-- change()'s own upgrade branch); a decrease that would put the org over its new effective
-- capacity REQUIRES an explicit keep-list for the affected resource type (stricter than a
-- downgrade's deterministic fallback -- "do not allow capacity removal to create unhandled
-- over-limit state" without the customer having chosen what happens, per this pass's own
-- instruction).

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
    where org_id = p_org_id order by current_period_start desc limit 1;
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
  'The sole way purchased_extra_properties is ever mutated. Idempotent (absolute target, not a
   delta). Rejects a decrease that would leave the org over its new effective capacity unless an
   explicit keep-list is provided. service_role only -- called from lib/addons.ts AFTER a verified
   PayFast subscription-amend call succeeds, never on browser-return success alone.';

revoke all on function public.set_property_addon_capacity(uuid, integer, uuid[], uuid) from public, authenticated, anon;
grant execute on function public.set_property_addon_capacity(uuid, integer, uuid[], uuid) to service_role;

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
    where org_id = p_org_id order by current_period_start desc limit 1;
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
  'Same shape as set_property_addon_capacity(), for purchased_extra_owner_slots.';

revoke all on function public.set_owner_addon_capacity(uuid, integer, uuid[], uuid) from public, authenticated, anon;
grant execute on function public.set_owner_addon_capacity(uuid, integer, uuid[], uuid) to service_role;

-- ============================================================
-- Upgrade auto-reconciliation of now-unnecessary add-ons: required_extra = max(0, current_usage -
-- new_base_allowance). Called from confirm_plan_change()'s upgrade branch, right after the
-- reconcile_plan_limits() call already added there -- an upgrade that makes some/all purchased
-- add-on capacity redundant automatically reduces the org's purchased_extra_* to exactly what is
-- still required, never billing for capacity no longer needed. A downgrade never auto-adjusts
-- add-ons the other way -- add-ons stay exactly as purchased; the customer explicitly manages them
-- via set_property_addon_capacity()/set_owner_addon_capacity() if they want to remove any.
-- ============================================================
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
    where org_id = p_org_id order by current_period_start desc limit 1;
  if v_sub.id is null then return; end if;

  select * into v_plan from public.plans where id = v_sub.plan_id;
  v_base_property_limit := (v_plan.feature_limits ->> 'maxProperties')::integer;
  v_base_owner_limit := (v_plan.feature_limits ->> 'includedOwners')::integer;

  -- Unlimited base allowance -- no add-on can ever be "required," reduce both to 0 outright
  -- (their own price key being present or not is irrelevant once the base is unlimited).
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
  'required_extra = max(0, current_usage - new_base_allowance) -- only ever REDUCES purchased_
   extra_*, never increases it (an upgrade should never silently start billing for MORE add-ons
   than the customer actually purchased). Called from confirm_plan_change()''s upgrade branch.';

revoke all on function public.reconcile_addon_capacity_on_upgrade(uuid) from public, authenticated, anon;
grant execute on function public.reconcile_addon_capacity_on_upgrade(uuid) to service_role;

-- Wire it into confirm_plan_change()'s existing upgrade branch -- same overload-hazard note as
-- migration 20260101000121: this changes the function BODY only (identical signature to the
-- version that migration created), so a plain CREATE OR REPLACE is safe here, no DROP needed.
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
      perform public.reconcile_plan_limits(v_quote.org_id, null, null, null, auth.uid(), 'upgrade');
      -- V1 commercial UX pass: an upgrade may have just made some/all purchased add-on capacity
      -- redundant -- reduce it to exactly what's still required so the customer is never billed
      -- for add-ons a bigger plan's own base allowance now covers.
      perform public.reconcile_addon_capacity_on_upgrade(v_quote.org_id);
    end if;
    update public.billing_plan_changes set completed_at = now() where id = v_change.id;
  elsif v_change.status = 'completed' and v_computed.change_type = 'downgrade' then
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
