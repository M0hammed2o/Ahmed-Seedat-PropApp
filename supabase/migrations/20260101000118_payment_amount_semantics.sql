-- V1 commercial onboarding pass, Phase 3: subscription_payments.amount semantics.
--
-- Bug found live (real sandbox round trip, WORKLOG.md this date): a R0.00 trial-activation
-- checkout's subscription_payments row was being mutated from amount=0 to amount=299.00
-- immediately after being marked 'paid' -- so the one row that should have permanently recorded
-- "R0 actually collected" instead showed "R299 collected" for a transaction that never charged
-- anything. The mutation existed only to make a LATER, unrelated amount-mismatch check pass for
-- the real day-30 recurring charge, which reuses the same subscription_payments row (matched by
-- PayFast's stable m_payment_id/provider_reference across a subscription's whole lifetime).
--
-- Fix (implemented in apps/admin/lib/billing.ts's processBillingWebhookEvent): a
-- subscription_payments row's `amount` now permanently reflects what was ACTUALLY collected for
-- THAT SPECIFIC transaction, never mutated after the fact. Every subsequent charge on the same
-- long-lived provider_reference (day-30 first real charge, and every recurring cycle after it)
-- gets its OWN NEW row instead of overwriting the previous one -- this also means payment history
-- now correctly shows one line per real transaction instead of one row whose amount/paid_at get
-- silently overwritten every month, which the previous design already had as a latent gap even
-- for perfectly ordinary (non-trial) subscriptions once one considers month 2 onward.
--
-- Since a gateway-initiated recurring charge has no local "pending" row already declaring what
-- amount to expect, this helper -- the exact formula already used by compute_plan_change_quote()
-- (migration 20260101000104), not a new one invented for this pass -- gives the webhook handler
-- something trustworthy to validate event.amount against before ever creating that new row.
create or replace function public.org_subscription_expected_amount(p_subscription_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.price_override, p.base_price) * (1 - coalesce(s.discount_pct, 0) / 100)
         - coalesce(s.promotional_credit, 0)
  from public.organization_subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.id = p_subscription_id;
$$;

comment on function public.org_subscription_expected_amount(uuid) is
  'The amount a subscription should currently be charged per cycle, accounting for
   price_override/discount_pct/promotional_credit -- identical formula to
   compute_plan_change_quote()''s own current_effective_price calculation (20260101000104), kept
   as a separate function rather than refactored out of that one to avoid touching the existing,
   tested proration engine. Used by processBillingWebhookEvent to validate a gateway-initiated
   recurring charge (one with no local pending subscription_payments row already declaring an
   expected amount) before creating a new payment row for it.';

revoke all on function public.org_subscription_expected_amount(uuid) from public, authenticated, anon;
grant execute on function public.org_subscription_expected_amount(uuid) to service_role;
