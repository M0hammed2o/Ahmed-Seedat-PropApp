-- Tests for 20260101000075_commercial_billing_foundation.sql, superseded by
-- 20260101000114_commercial_setup_gate_and_trial_eligibility.sql: create_organization() no longer
-- starts the trial clock itself -- payment method capture must happen first (directive: "payment
-- method required BEFORE trial activation"). trial_ends_at is null until the service-role-only
-- activate_trial_after_payment() runs, which lib/billing.ts calls from
-- processBillingWebhookEvent()'s first-activation branch after a real gateway confirmation.

begin;
select plan(6);

insert into auth.users (id, email) values
  ('fd000000-0000-0000-0000-000000000001', 'cbf-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Commercial Billing Test Org', 'agency')), null, 'org created');

select ok(
  (select trial_ends_at is null from public.organizations where legal_name = 'Commercial Billing Test Org'),
  'a newly created org has no trial_ends_at until payment method is captured'
);

reset role;
select public.activate_trial_after_payment(
  (select id from public.organizations where legal_name = 'Commercial Billing Test Org')
);
set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';

select ok(
  (select trial_ends_at between now() + interval '29 days' and now() + interval '31 days'
     from public.organizations where legal_name = 'Commercial Billing Test Org'),
  'activate_trial_after_payment() sets trial_ends_at to approximately 30 days out'
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
