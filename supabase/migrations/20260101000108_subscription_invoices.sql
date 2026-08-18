-- V1 billing invoice pass (WORKLOG.md this date): the smallest production-quality invoice/receipt
-- system for Proplyst's OWN SaaS subscription charges -- NOT the landlord/property accounting
-- invoice system (public.invoices, apps/admin/lib/accounting.ts, tenant rent invoices), which
-- this table is deliberately named to never be confused with. Additive only: one new table, one
-- new sequence, one new function, called from apps/admin/lib/billing.ts's existing
-- processBillingWebhookEvent()/refundSubscriptionPayment() at the exact points a real payment
-- event already happens -- no new payment/entitlement logic, this only records what the existing,
-- already-proven proration/webhook engine (20260101000104) already decided.

-- ============================================================
-- Race-safe, server-generated, non-editable invoice numbering. A sequence is atomic under
-- concurrent access by Postgres's own guarantee -- two simultaneous webhook deliveries (a real
-- possibility: PayFast retries on any non-2xx, and two DIFFERENT orgs' payments can land in the
-- same second) can never be issued the same number. Year-scoped format matches
-- organizations.invoice_prefix's own convention (the landlord accounting module) in spirit
-- without sharing the same sequence or prefix -- these are a different document series entirely.
-- ============================================================
-- Deliberately its own enum, NOT a reuse of billing_plan_change_type (20260101000104): that enum
-- has no 'renewal' value at all (a renewal is an ordinary recurring gateway charge, never a
-- "plan change" the proration engine tracks) -- found live, this migration failed to apply on
-- first attempt with exactly this mismatch before being fixed to a dedicated type.
create type public.subscription_invoice_type as enum (
  'new_subscription', 'renewal', 'upgrade', 'reactivation'
);

create sequence public.subscription_invoice_number_seq;

create or replace function public.generate_subscription_invoice_number()
returns text
language sql
as $$
  select 'PLY-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.subscription_invoice_number_seq')::text, 6, '0');
$$;

comment on function public.generate_subscription_invoice_number() is
  'Server-generated Proplyst subscription invoice number, e.g. PLY-2026-000123. Backed by a
   Postgres sequence -- race-safe under real concurrent webhook delivery by construction, never a
   client-supplied or random string. Called only from create_subscription_invoice_for_payment()
   below.';

-- ============================================================
-- subscription_invoices: one row per successfully-collected Proplyst subscription charge. There
-- is deliberately NO row for a downgrade (no money moves) or a failed payment (no paid receipt,
-- per this pass's own explicit instruction) -- only for actual, confirmed money collected.
-- Immutable in the sense that matters: no client can ever INSERT/UPDATE/DELETE (see RLS below);
-- the only server-side mutation after creation is status flipping to 'refunded', which never
-- deletes or overwrites the original invoice_number/amounts -- financial history is retained, not
-- erased.
-- ============================================================
create table public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique default public.generate_subscription_invoice_number(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  subscription_payment_id uuid not null references public.subscription_payments(id) unique,
  billing_plan_change_id uuid references public.billing_plan_changes(id),
  plan_id uuid not null references public.plans(id),
  invoice_type public.subscription_invoice_type not null,
  billing_period_start date not null,
  billing_period_end date not null,
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  discount_amount numeric(10, 2) not null default 0 check (discount_amount >= 0),
  total numeric(10, 2) not null check (total >= 0),
  currency char(3) not null default 'ZAR',
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  issued_at timestamptz not null default now(),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.subscription_invoices is
  'V1 billing invoice pass: Proplyst''s OWN subscription-fee invoices/receipts (org paying
   Proplyst), never the landlord/tenant accounting invoice system (public.invoices). One row per
   successfully-collected charge -- unique(subscription_payment_id) makes "a duplicate PayFast ITN
   creates a second invoice" structurally impossible (the INSERT itself would violate the
   constraint), on top of billing_events'' own (provider_name, provider_event_id) idempotency guard
   that already prevents processBillingWebhookEvent''s payment_succeeded branch from running twice
   for the same event at all -- two independent layers, not one relied on alone.';

comment on column public.subscription_invoices.invoice_type is
  'subscription_invoice_type -- its own enum, not billing_plan_change_type (20260101000104),
   which has no ''renewal'' value (a renewal is an ordinary recurring gateway charge, never a
   "plan change"). new_subscription/renewal/upgrade/reactivation are exactly what an invoice can
   ever be for; downgrade/cancellation/no_change never reach this table because they never
   collect a payment.';

comment on column public.subscription_invoices.discount_amount is
  'A genuine promotional discount/credit applied to the charge, when known -- NOT the proration
   math itself (an upgrade''s prorated amount is the correct full charge for what was actually
   granted, not a discount off the new plan''s price). Zero by default; V1''s checkout/plan-change
   paths do not currently break out a separate discount component of the charged amount, so this
   is structurally ready but not yet populated with a nonzero value by any caller -- a disclosed,
   correct-as-is simplification, not an oversight.';

create index subscription_invoices_org_idx on public.subscription_invoices (org_id, issued_at desc);

alter table public.subscription_invoices enable row level security;

create policy "subscription_invoices_select_same_org"
  on public.subscription_invoices for select
  using (
    org_id in (
      select om.org_id from public.organization_members om
      where om.user_id = auth.uid() and om.status = 'active'
    )
  );

-- No client write policy at all, matching organization_subscriptions/subscription_payments/
-- billing_plan_changes' own established posture: every write goes through
-- create_subscription_invoice_for_payment() (security definer, service-role only) or the
-- service-role refund path -- never a direct client insert/update/delete. "Customer cannot modify
-- amount/plan/status/invoice number" holds structurally.

-- ============================================================
-- Creates exactly one invoice for a payment that has just been confirmed 'paid'. Called from
-- apps/admin/lib/billing.ts's processBillingWebhookEvent(), AFTER the existing plan-flip/status
-- logic (20260101000104) has already run for this same webhook delivery -- reads
-- organization_subscriptions fresh so an upgrade's invoice reflects the ALREADY-APPLIED target
-- plan/period, not a stale pre-flip snapshot. Idempotent by construction: unique(
-- subscription_payment_id) means calling this twice for the same payment throws a unique-violation
-- on the second call rather than creating a duplicate -- the caller (processBillingWebhookEvent)
-- doesn't need its own separate guard, though billing_events' own event-level idempotency means
-- it never actually gets called twice for the same real event in practice either.
-- ============================================================
create or replace function public.create_subscription_invoice_for_payment(p_payment_id uuid)
returns public.subscription_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_sub public.organization_subscriptions%rowtype;
  v_change public.billing_plan_changes%rowtype;
  v_invoice_type public.subscription_invoice_type;
  v_plan_id uuid;
  v_has_prior_invoice boolean;
  v_invoice public.subscription_invoices%rowtype;
begin
  select * into v_payment from public.subscription_payments where id = p_payment_id;
  if v_payment.id is null then
    raise exception 'Payment % not found', p_payment_id;
  end if;
  if v_payment.status <> 'paid' then
    raise exception 'Payment % is not paid (status: %) -- refusing to invoice an unpaid charge', p_payment_id, v_payment.status;
  end if;

  select * into v_sub from public.organization_subscriptions where id = v_payment.subscription_id;
  if v_sub.id is null then
    raise exception 'Subscription % for payment % not found', v_payment.subscription_id, p_payment_id;
  end if;

  if v_payment.billing_plan_change_id is not null then
    select * into v_change from public.billing_plan_changes where id = v_payment.billing_plan_change_id;
    -- Only upgrade/reactivation ever reach here with a real payment (downgrade never sets
    -- billing_plan_change_id on a subscription_payments row -- it charges nothing) -- v_change.
    -- change_type IS the invoice_type (cast across the two distinct-but-label-matching enums; see
    -- subscription_invoice_type's own comment on why they're separate types), no further
    -- branching needed.
    v_invoice_type := v_change.change_type::text::public.subscription_invoice_type;
    v_plan_id := v_change.new_plan_id;
  else
    -- No linked plan change -- either this org's very first successful payment, or an ordinary
    -- recurring renewal charge. Distinguished the same server-side way, not a client hint: does
    -- an invoice already exist for this org at all.
    select exists(select 1 from public.subscription_invoices where org_id = v_payment.org_id) into v_has_prior_invoice;
    v_invoice_type := case when v_has_prior_invoice then 'renewal' else 'new_subscription' end;
    v_plan_id := v_sub.plan_id;
  end if;

  insert into public.subscription_invoices (
    org_id, subscription_payment_id, billing_plan_change_id, plan_id, invoice_type,
    billing_period_start, billing_period_end, subtotal, discount_amount, total, currency,
    status, issued_at, paid_at
  )
  values (
    v_payment.org_id, v_payment.id, v_payment.billing_plan_change_id, v_plan_id, v_invoice_type,
    v_sub.current_period_start, v_sub.current_period_end,
    -- V1: the full payment amount is the subtotal (see discount_amount's own comment on why V1
    -- has no separate discount line to break out yet) -- total always equals subtotal minus a
    -- zero discount, kept as two columns for the schema shape Phase 2 asked for, not because they
    -- can currently diverge.
    v_payment.amount, 0, v_payment.amount, v_payment.currency,
    'paid', coalesce(v_payment.paid_at, now()), coalesce(v_payment.paid_at, now())
  )
  returning * into v_invoice;

  return v_invoice;
end;
$$;

comment on function public.create_subscription_invoice_for_payment(uuid) is
  'V1 billing invoice pass: creates exactly one subscription_invoices row for a confirmed-paid
   subscription_payments row. Raises if the payment is not actually paid (refuses to invoice an
   unpaid/pending/failed charge) or if called twice for the same payment (unique(
   subscription_payment_id) violation). service_role only -- called from
   processBillingWebhookEvent(), never client-triggered.';

revoke all on function public.create_subscription_invoice_for_payment(uuid) from public;
grant execute on function public.create_subscription_invoice_for_payment(uuid) to service_role;
