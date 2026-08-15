-- RELEASE A, Part 1 (V1 Commercial Launch Gap Audit): provider-independent billing-change engine.
-- Business rules (Mohammed's exact directive, this date):
--   UPGRADE      -- immediate access, prorated DIFFERENCE only (never full-price-again), preserves
--                   current_period_end, next renewal charges the full new-plan price.
--   DOWNGRADE    -- no mid-cycle refund, current (higher) entitlement kept until current_period_end,
--                   effective at next renewal, never destroys existing over-limit data.
--   REACTIVATION -- a suspended/cancelled org has no "current paid period" to prorate against, so a
--                   reactivation is a full-price charge for a fresh period, same as a first-time
--                   subscription.
--   CANCELLATION -- no duplicate charge, no phantom subscription, explicit dates (existing
--                   cancelOrgSubscription() lifecycle preserved, extended for idempotency + audit).
--
-- Every plan-change decision is computed HERE, in Postgres numeric arithmetic (never floating
-- point, never trusting a browser-supplied amount) -- apps/admin's billing.ts/routes only ever
-- pass through what these functions return.

-- ============================================================
-- Audit trail + pending-downgrade tracker (ONE table, deliberately -- a 'scheduled' row IS the
-- pending downgrade; the scheduler that applies it at renewal is the same process that completes
-- the audit record, so a second, redundant "pending_plan_changes" table would just be two sources
-- of truth for the same fact).
-- ============================================================
create type public.billing_plan_change_type as enum (
  'new_subscription', 'upgrade', 'downgrade', 'reactivation', 'cancellation', 'no_change'
);
create type public.billing_plan_change_status as enum (
  'scheduled', 'awaiting_payment', 'completed', 'cancelled', 'failed'
);

create table public.billing_plan_changes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  change_type public.billing_plan_change_type not null,
  old_plan_id uuid references public.plans(id),
  new_plan_id uuid references public.plans(id),
  old_effective_price numeric(10, 2),
  new_effective_price numeric(10, 2),
  old_subscription_id uuid references public.organization_subscriptions(id),
  new_subscription_id uuid references public.organization_subscriptions(id),
  period_start date,
  period_end date,
  proration_fraction numeric(6, 5),
  credit_applied numeric(10, 2) not null default 0,
  charge_due numeric(10, 2) not null default 0,
  currency char(3) not null default 'ZAR',
  status public.billing_plan_change_status not null default 'scheduled',
  quote_id uuid,
  requested_at timestamptz not null default now(),
  effective_at timestamptz not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failure_reason text,
  provider_state jsonb not null default '{}'::jsonb
);

create index billing_plan_changes_org_idx on public.billing_plan_changes (org_id, requested_at desc);
-- One outstanding SCHEDULED downgrade per org at a time -- confirm_plan_change() supersedes
-- (cancels) any prior scheduled row for the same org before inserting a new one, so this is a
-- backstop, not the only enforcement.
create unique index billing_plan_changes_one_scheduled_per_org
  on public.billing_plan_changes (org_id)
  where status = 'scheduled';

alter table public.billing_plan_changes enable row level security;

create policy "billing_plan_changes_select_same_org"
  on public.billing_plan_changes for select
  using (
    org_id in (
      select om.org_id from public.organization_members om
      where om.user_id = auth.uid() and om.status = 'active'
    )
  );
-- No client write policy -- every row is written by the SECURITY DEFINER functions below or the
-- service-role webhook/scheduler path, matching billing_events'/subscription_payments' own
-- "server-side subsystems only" posture.

comment on table public.billing_plan_changes is
  'RELEASE A: the complete billing-change audit trail (every quote confirmation, whether it
   completed immediately, is awaiting payment, or is scheduled for a future renewal) AND the
   pending-downgrade tracker in one place -- a status=''scheduled'' row for change_type=''downgrade''
   IS the pending downgrade; apply_due_scheduled_plan_changes() (called by the subscription
   lifecycle scheduler) is what completes it at current_period_end.';

-- ============================================================
-- Server-generated, short-lived quotes (Phase 10) -- never trust a browser-supplied amount.
-- confirm_plan_change() below ALWAYS recomputes fresh against live state rather than trusting the
-- numbers stored on the quote row itself; the quote row exists for expiry/idempotency/audit, not
-- as the source of truth for the charge.
-- ============================================================
create table public.billing_change_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  target_plan_id uuid not null references public.plans(id),
  change_type public.billing_plan_change_type not null,
  current_plan_id uuid references public.plans(id),
  current_effective_price numeric(10, 2),
  target_effective_price numeric(10, 2),
  current_period_start date,
  current_period_end date,
  proration_fraction numeric(6, 5),
  amount_due_now numeric(10, 2) not null,
  next_renewal_amount numeric(10, 2),
  currency char(3) not null default 'ZAR',
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_change_id uuid references public.billing_plan_changes(id)
);

create index billing_change_quotes_org_idx on public.billing_change_quotes (org_id, created_at desc);

alter table public.billing_change_quotes enable row level security;

create policy "billing_change_quotes_select_same_org"
  on public.billing_change_quotes for select
  using (
    org_id in (
      select om.org_id from public.organization_members om
      where om.user_id = auth.uid() and om.status = 'active'
    )
  );

-- ============================================================
-- The core computation -- pure, side-effect-free, callable repeatedly (STABLE). Day-based
-- proration granularity (current_period_start/end are `date` columns, matching the existing
-- billing architecture, not timestamptz).
-- ============================================================
create type public.plan_change_quote_result as (
  change_type public.billing_plan_change_type,
  current_plan_id uuid,
  current_plan_code text,
  target_plan_id uuid,
  target_plan_code text,
  current_effective_price numeric,
  target_effective_price numeric,
  current_period_start date,
  current_period_end date,
  proration_fraction numeric,
  amount_due_now numeric,
  next_renewal_amount numeric,
  currency text,
  effective_at timestamptz
);

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

  -- No subscription row at all (still on the free trial, never subscribed) -- a fresh,
  -- full-price subscription, no proration input to compute against.
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

  -- REACTIVATION: the org's own status (not the subscription row's) says suspended/cancelled --
  -- there is no "currently paid period" to prorate against, so this is priced exactly like a new
  -- subscription: full target price, fresh period starting now. Deliberately checked before the
  -- same-plan/upgrade/downgrade branches -- a suspended org "upgrading" or "downgrading" is still
  -- a reactivation, not a proration, because nothing is currently being paid for.
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

  -- Ordinary plan change on an active/trial/overdue subscription.
  v_current_effective := greatest(
    0,
    coalesce(v_sub.price_override, v_current_plan.base_price)
      * (1 - coalesce(v_sub.discount_pct, 0) / 100)
      - coalesce(v_sub.promotional_credit, 0)
  );

  -- True no-op ONLY when it's literally the same plan -- a genuine plan change where the two
  -- effective prices merely happen to coincide (a discount/override can produce this) must still
  -- update plan_id; that case falls through to the upgrade branch below, which correctly applies
  -- immediately at a computed charge of exactly 0.00 rather than being silently swallowed here.
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

  -- Day-based remaining-period fraction, clamped to [0, 1]. nullif guards a same-day
  -- start/end (division by zero) -- treated as fully consumed (fraction 0).
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
    -- UPGRADE (>=, not > -- a different plan whose effective price happens to equal the current
    -- one is still a real plan change, applied immediately at a computed charge of 0.00, not a
    -- scheduled downgrade): immediate access, charge ONLY the prorated difference,
    -- current_period_end preserved (Mohammed's exact formula).
    v_result.change_type := 'upgrade';
    v_result.effective_at := now();
    v_result.amount_due_now := round((v_target_effective - v_current_effective) * v_fraction, 2);
  else
    -- DOWNGRADE: no mid-cycle refund, effective at next renewal, zero charge now.
    v_result.change_type := 'downgrade';
    v_result.effective_at := v_sub.current_period_end::timestamptz;
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
  'RELEASE A P0: pure, side-effect-free plan-change pricing. Decimal-safe (Postgres numeric
   throughout, never floating point). current_effective_price folds in price_override/discount_pct/
   promotional_credit from the CURRENT organization_subscriptions row; target_effective_price is
   always the target plan''s plain base_price (no override/discount carries forward onto a new
   plan in V1 -- a deliberate, disclosed scope decision, not an oversight; a super-admin can apply a
   fresh override to the resulting subscription row afterward if a negotiated deal is needed).
   Callable repeatedly with no side effects -- create_plan_change_quote() below is what persists a
   specific quote.';

revoke all on function public.compute_plan_change_quote(uuid, uuid) from public;
grant execute on function public.compute_plan_change_quote(uuid, uuid) to authenticated;

-- ============================================================
-- Persisted, expiring quote (Phase 10).
-- ============================================================
create or replace function public.create_plan_change_quote(p_org_id uuid, p_target_plan_id uuid)
returns public.billing_change_quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_computed public.plan_change_quote_result;
  v_quote public.billing_change_quotes%rowtype;
begin
  v_computed := public.compute_plan_change_quote(p_org_id, p_target_plan_id);

  insert into public.billing_change_quotes (
    org_id, requested_by, target_plan_id, change_type, current_plan_id,
    current_effective_price, target_effective_price, current_period_start, current_period_end,
    proration_fraction, amount_due_now, next_renewal_amount, currency, effective_at, expires_at
  )
  values (
    p_org_id, auth.uid(), p_target_plan_id, v_computed.change_type, v_computed.current_plan_id,
    v_computed.current_effective_price, v_computed.target_effective_price,
    v_computed.current_period_start, v_computed.current_period_end,
    v_computed.proration_fraction, v_computed.amount_due_now, v_computed.next_renewal_amount,
    v_computed.currency, v_computed.effective_at,
    -- 15-minute quote lifetime -- long enough for a customer to review and confirm, short enough
    -- that a stale quote is never confirmed against materially different underlying state
    -- (confirm_plan_change() recomputes fresh regardless, but a short expiry keeps the UI honest
    -- about "this price may no longer be current" rather than showing an indefinitely-stale number).
    now() + interval '15 minutes'
  )
  returning * into v_quote;

  return v_quote;
end;
$$;

comment on function public.create_plan_change_quote(uuid, uuid) is
  'RELEASE A P0: persists one compute_plan_change_quote() result with a 15-minute expiry. Callable
   only by the org''s billing principal (enforced inside compute_plan_change_quote()).';

revoke all on function public.create_plan_change_quote(uuid, uuid) from public;
grant execute on function public.create_plan_change_quote(uuid, uuid) to authenticated;

-- ============================================================
-- Confirmation -- idempotent (Phase 12), always recomputes fresh rather than trusting the stored
-- quote's numbers as authoritative for a NEW confirmation, but replays the SAME already-completed
-- result if called twice with the same quote_id (double-click / retry safe).
-- ============================================================
create type public.plan_change_confirmation_result as (
  billing_plan_change_id uuid,
  change_type public.billing_plan_change_type,
  status public.billing_plan_change_status,
  amount_due_now numeric,
  currency text,
  effective_at timestamptz,
  requires_payment boolean,
  already_processed boolean
);

create or replace function public.confirm_plan_change(p_quote_id uuid)
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
begin
  select * into v_quote from public.billing_change_quotes where id = p_quote_id for update;
  if v_quote.id is null then
    raise exception 'Quote not found';
  end if;
  if not public.has_billing_principal_access(v_quote.org_id) then
    raise exception 'Only the organization principal may confirm a billing change';
  end if;

  -- Idempotent replay: this exact quote was already consumed -- return the SAME outcome again
  -- instead of creating a second billing_plan_changes row (double-click / browser-retry / webhook
  -- retry protection, Phase 12). This is intentionally the ONLY path that reuses a stored value --
  -- everything else below recomputes fresh.
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

  -- Recompute fresh against LIVE state -- the quote row is never trusted as the source of truth
  -- for the charge, only for expiry/idempotency bookkeeping.
  v_computed := public.compute_plan_change_quote(v_quote.org_id, v_quote.target_plan_id);

  -- Supersede any prior scheduled downgrade for this org before recording a new decision --
  -- confirming a NEW plan change (of any type) always cancels a stale pending one rather than
  -- letting two scheduled changes race at the next renewal.
  update public.billing_plan_changes
    set status = 'cancelled', cancelled_at = now()
    where org_id = v_quote.org_id and status = 'scheduled';

  insert into public.billing_plan_changes (
    org_id, actor_user_id, change_type, old_plan_id, new_plan_id,
    old_effective_price, new_effective_price, period_start, period_end,
    proration_fraction, charge_due, currency, status, quote_id, effective_at
  )
  values (
    v_quote.org_id, auth.uid(), v_computed.change_type, v_computed.current_plan_id, v_computed.target_plan_id,
    v_computed.current_effective_price, v_computed.target_effective_price,
    v_computed.current_period_start, v_computed.current_period_end,
    v_computed.proration_fraction, v_computed.amount_due_now, v_computed.currency,
    case
      when v_computed.change_type = 'downgrade' then 'scheduled'
      when v_computed.amount_due_now > 0 then 'awaiting_payment'
      else 'completed'
    end::public.billing_plan_change_status,
    v_quote.id, v_computed.effective_at
  )
  returning * into v_change;

  -- Immediate, zero-charge changes (no_change, a zero-difference upgrade, or -- not reachable via
  -- the UI today but handled correctly regardless -- a target plan that happens to cost the same)
  -- apply to organization_subscriptions right now, synchronously.
  if v_change.status = 'completed' and v_computed.change_type in ('upgrade', 'no_change') then
    if v_computed.change_type = 'upgrade' then
      -- Postgres UPDATE has no ORDER BY/LIMIT clause -- resolve the single current subscription
      -- row's id via a subquery first, matching this migration's own apply_due_scheduled_plan_
      -- changes() approach below.
      update public.organization_subscriptions
        set plan_id = v_computed.target_plan_id
        where id = (
          select id from public.organization_subscriptions
          where org_id = v_quote.org_id
          order by current_period_start desc
          limit 1
        );
    end if;
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

comment on function public.confirm_plan_change(uuid) is
  'RELEASE A P0: idempotent confirmation. Recomputes fresh against live state (never trusts the
   quote row''s stored numbers as authoritative), supersedes any prior scheduled downgrade, and
   either (a) applies a zero-charge change immediately, (b) schedules a downgrade for
   current_period_end, or (c) marks the change awaiting_payment for the caller (API route) to
   initiate a gateway checkout for the exact prorated amount -- entitlement only flips once that
   payment is confirmed by processBillingWebhookEvent. Calling this twice with the SAME quote_id
   returns the identical prior outcome rather than creating a second change (double-click/retry
   safe) -- reusing an EXPIRED, never-confirmed quote for a fresh attempt is rejected.';

revoke all on function public.confirm_plan_change(uuid) from public;
grant execute on function public.confirm_plan_change(uuid) to authenticated;

-- ============================================================
-- Cancelling a pending (scheduled) downgrade before it takes effect.
-- ============================================================
create or replace function public.cancel_pending_plan_change(p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if not public.has_billing_principal_access(p_org_id) then
    raise exception 'Only the organization principal may cancel a pending plan change';
  end if;

  update public.billing_plan_changes
    set status = 'cancelled', cancelled_at = now()
    where org_id = p_org_id and status = 'scheduled';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.cancel_pending_plan_change(uuid) is
  'RELEASE A: cancels the org''s pending scheduled downgrade, if any. Returns false (not an error)
   if there was nothing scheduled -- an idempotent no-op, matching this codebase''s established
   "cancel is safe to call even if already cancelled" convention.';

revoke all on function public.cancel_pending_plan_change(uuid) from public;
grant execute on function public.cancel_pending_plan_change(uuid) to authenticated;

-- ============================================================
-- Scheduler-facing: apply every scheduled downgrade whose effective_at has arrived. Called from
-- the subscription-lifecycle system route (service-role only) -- see Phase 14/15's own migration.
-- Deliberately does NOT touch properties/units/leases/tenants/any customer data -- a downgraded
-- org simply cannot CREATE more than its new plan allows (available_property_slots() already
-- handles a negative/over-limit count gracefully, migration 20260101000102); nothing here deletes
-- or archives anything.
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

    update public.billing_plan_changes
      set status = 'completed', completed_at = now()
      where id = v_row.id;

    v_applied := v_applied + 1;
  end loop;

  return v_applied;
end;
$$;

comment on function public.apply_due_scheduled_plan_changes() is
  'RELEASE A: applies every SCHEDULED downgrade whose effective_at (= the period_end captured at
   quote-confirm time) has arrived -- flips the org''s current organization_subscriptions row to
   the lower plan. Never deletes or archives any customer data; an org that now exceeds its new
   plan''s limits simply cannot create more (available_property_slots() already returns
   negative/zero gracefully). Idempotent by construction -- a row moves out of status=''scheduled''
   the moment it is applied, so re-running this function is always safe.';

revoke all on function public.apply_due_scheduled_plan_changes() from public;
grant execute on function public.apply_due_scheduled_plan_changes() to service_role;

-- ============================================================
-- Links a subscription_payments row back to the plan-change it is paying for, so
-- processBillingWebhookEvent (apps/admin/lib/billing.ts) can apply the ACTUAL target plan on
-- payment_succeeded, not just reactivate whatever plan the pending organization_subscriptions row
-- already pointed at.
-- ============================================================
alter table public.subscription_payments
  add column billing_plan_change_id uuid references public.billing_plan_changes(id);

comment on column public.subscription_payments.billing_plan_change_id is
  'RELEASE A: set when this payment is collecting a prorated upgrade/reactivation amount
   (billing_plan_changes.status = ''awaiting_payment'') -- null for an ordinary first-time
   subscription payment. processBillingWebhookEvent uses this to mark the plan change completed
   (and apply the target plan) on payment_succeeded, distinct from ordinary trial->active
   activation.';
