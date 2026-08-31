-- Final completion + security hardening pass (WORKLOG.md this date), P1 "Payment history UX"
-- (Part F). subscription_payments.status is a plain text CHECK constraint (migration
-- 20260101000019), not a Postgres enum -- adding a new allowed value is a simple constraint
-- swap, no ALTER TYPE transaction-boundary restrictions to work around.
--
-- 'expired' is a NEW status for a 'pending' checkout that never received a webhook (payment_
-- succeeded or payment_failed) within a safe age window -- distinct from 'failed' (the provider
-- explicitly said no) and never fabricates a provider outcome that was never actually received.
-- No row is ever deleted -- this only ever moves 'pending' -> 'expired', preserving full audit
-- history (task brief: "Do NOT delete historical evidence").

alter table public.subscription_payments
  drop constraint subscription_payments_status_check;
alter table public.subscription_payments
  add constraint subscription_payments_status_check
  check (status in ('pending', 'paid', 'failed', 'refunded', 'expired'));

comment on constraint subscription_payments_status_check on public.subscription_payments is
  'expired (final hardening pass, migration 155): a pending checkout that exceeded the safe max
   age with no webhook ever received -- see expire_stale_subscription_checkouts().';

create or replace function public.expire_stale_subscription_checkouts(p_max_age_hours integer default 24)
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.subscription_payments
    set status = 'expired'
    where status = 'pending'
      and created_at < now() - (p_max_age_hours || ' hours')::interval
    returning id
  )
  select count(*)::integer from expired;
$$;

comment on function public.expire_stale_subscription_checkouts(integer) is
  'Sweeps genuinely stale pending checkouts (no webhook received within p_max_age_hours) to
   expired -- called from the daily-jobs cron route (service_role) only, never client-triggered;
   execute is revoked from public/authenticated and granted only to service_role. Final hardening
   pass, migration 155.';

revoke all on function public.expire_stale_subscription_checkouts(integer) from public;
grant execute on function public.expire_stale_subscription_checkouts(integer) to service_role;
