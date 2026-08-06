-- Tests for 20260101000075_commercial_billing_foundation.sql: create_organization() starts a
-- real 30-day trial clock, and the three real commercial plans exist with the directive's own
-- stated prices.

begin;
select plan(6);

insert into auth.users (id, email) values
  ('fd000000-0000-0000-0000-000000000001', 'cbf-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Commercial Billing Test Org', 'agency')), null, 'org created');

select ok(
  (select trial_ends_at is not null from public.organizations where legal_name = 'Commercial Billing Test Org'),
  'a newly created org has a trial_ends_at set (not null)'
);

select ok(
  (select trial_ends_at between now() + interval '29 days' and now() + interval '31 days'
     from public.organizations where legal_name = 'Commercial Billing Test Org'),
  'trial_ends_at is approximately 30 days from creation'
);

select is(
  (select base_price from public.plans where code = 'starter'),
  299.00::numeric,
  'Starter plan is R299/month'
);

select is(
  (select base_price from public.plans where code = 'professional'),
  699.00::numeric,
  'Professional plan is R699/month'
);

select is(
  (select base_price from public.plans where code = 'business'),
  1499.00::numeric,
  'Business plan is R1499/month'
);

select * from finish();
rollback;
