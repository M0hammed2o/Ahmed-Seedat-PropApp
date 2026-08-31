-- Final completion + security hardening pass (WORKLOG.md this date), P1 "Payment history UX":
-- expire_stale_subscription_checkouts() (migration 155) only ever moves a genuinely stale
-- 'pending' row to 'expired' -- never touches a recent pending row, never fabricates paid/failed,
-- never deletes anything.

begin;
select plan(6);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'stale-checkout@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';
select public.create_organization('Stale Checkout Test Org', 'agency');
reset role;

insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
select o.id, p.id, 'monthly', current_date, current_date + interval '1 month', 'trial'
from public.organizations o, public.plans p
where o.legal_name = 'Stale Checkout Test Org' and p.code = 'starter_monthly';

-- A genuinely old pending checkout (2 days ago) -- must expire.
insert into public.subscription_payments (org_id, subscription_id, amount, status, purpose, created_at)
select o.id, s.id, 5, 'pending', 'trial_activation', now() - interval '2 days'
from public.organizations o
join public.organization_subscriptions s on s.org_id = o.id
where o.legal_name = 'Stale Checkout Test Org';

-- A recent pending checkout (5 minutes ago) -- must NOT expire yet.
insert into public.subscription_payments (org_id, subscription_id, amount, status, purpose, created_at)
select o.id, s.id, 5, 'pending', 'trial_activation', now() - interval '5 minutes'
from public.organizations o
join public.organization_subscriptions s on s.org_id = o.id
where o.legal_name = 'Stale Checkout Test Org';

-- An old row that is already paid -- must NOT be touched (only 'pending' rows are eligible).
insert into public.subscription_payments (org_id, subscription_id, amount, status, purpose, paid_at, created_at)
select o.id, s.id, 5, 'paid', 'trial_activation', now() - interval '2 days', now() - interval '2 days'
from public.organizations o
join public.organization_subscriptions s on s.org_id = o.id
where o.legal_name = 'Stale Checkout Test Org';

select is(
  (select count(*) from public.subscription_payments sp
     join public.organizations o on o.id = sp.org_id
     where o.legal_name = 'Stale Checkout Test Org' and sp.status = 'pending'),
  2::bigint,
  'two pending rows exist before the sweep'
);

select is(
  (select public.expire_stale_subscription_checkouts(24)),
  1,
  'the sweep (24h max age) expires exactly the one genuinely stale row'
);

select is(
  (select count(*) from public.subscription_payments sp
     join public.organizations o on o.id = sp.org_id
     where o.legal_name = 'Stale Checkout Test Org' and sp.status = 'expired'),
  1::bigint,
  'exactly one row is now expired'
);

select is(
  (select count(*) from public.subscription_payments sp
     join public.organizations o on o.id = sp.org_id
     where o.legal_name = 'Stale Checkout Test Org' and sp.status = 'pending'),
  1::bigint,
  'the recent (5-minutes-old) pending row is untouched, still pending'
);

select is(
  (select count(*) from public.subscription_payments sp
     join public.organizations o on o.id = sp.org_id
     where o.legal_name = 'Stale Checkout Test Org' and sp.status = 'paid'),
  1::bigint,
  'the already-paid row is untouched -- the sweep never rewrites a real financial outcome'
);

-- Idempotent: running it again with nothing newly stale expires nothing further.
select is(
  (select public.expire_stale_subscription_checkouts(24)),
  0,
  'running the sweep again expires zero additional rows (nothing newly stale)'
);

select * from finish();
rollback;
