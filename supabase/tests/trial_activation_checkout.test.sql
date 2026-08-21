-- Tests for 20260101000116_trial_activation_checkout.sql: the indefinite-trial blocker fix.
-- Covers what the vitest integration tests (lib/__tests__/billing.trialActivation.test.ts) can't
-- easily exercise -- that a plain authenticated session (not service_role) cannot call
-- activate_trial_after_payment()/record_trial_usage() directly to fabricate its own trial, and
-- that trial_usage_records' new unique(org_id) constraint actually enforces idempotency at the
-- DB level, not just via the RPC's own ON CONFLICT clause.

begin;
select plan(10);

insert into auth.users (id, email) values
  ('ac000000-0000-0000-0000-000000000001', 'tac-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'ac000000-0000-0000-0000-000000000001';

select isnt(
  (select public.create_organization('Trial Activation Test Org', 'agency')),
  null,
  'org created'
);

select ok(
  (select trial_ends_at is null and commercial_setup_completed_at is null
     from public.organizations where legal_name = 'Trial Activation Test Org'),
  'a freshly created org has both trial_ends_at and commercial_setup_completed_at null'
);

-- A plain authenticated caller must NOT be able to fabricate its own trial activation --
-- activate_trial_after_payment() is revoked from authenticated/anon, service_role-only.
select throws_ok(
  $$ select public.activate_trial_after_payment(
       (select id from public.organizations where legal_name = 'Trial Activation Test Org')
     ) $$,
  '42501',
  null,
  'authenticated cannot call activate_trial_after_payment() directly (permission denied)'
);

select ok(
  (select trial_ends_at is null from public.organizations where legal_name = 'Trial Activation Test Org'),
  'the blocked call left trial_ends_at untouched'
);

-- Same for record_trial_usage() -- also service_role-only.
select throws_ok(
  $$ select public.record_trial_usage(
       (select id from public.organizations where legal_name = 'Trial Activation Test Org'),
       'ac000000-0000-0000-0000-000000000001'::uuid
     ) $$,
  '42501',
  null,
  'authenticated cannot call record_trial_usage() directly (permission denied)'
);

-- Now switch to postgres (stands in for service_role -- matches this test suite's own existing
-- convention elsewhere for exercising a security definer function's actual logic once the RLS/
-- grant boundary above is already proven) to verify the idempotency guarantee itself.
reset role;

select lives_ok(
  $$ select public.activate_trial_after_payment(
       (select id from public.organizations where legal_name = 'Trial Activation Test Org')
     ) $$,
  'service-role-equivalent caller can activate the trial'
);

select ok(
  (select trial_ends_at is not null and commercial_setup_completed_at is not null
     from public.organizations where legal_name = 'Trial Activation Test Org'),
  'activation sets both trial_ends_at and commercial_setup_completed_at'
);

select lives_ok(
  $$ select public.record_trial_usage(
       (select id from public.organizations where legal_name = 'Trial Activation Test Org'),
       'ac000000-0000-0000-0000-000000000001'::uuid,
       'payfast-ref-1'
     ) $$,
  'first record_trial_usage() call succeeds'
);

select lives_ok(
  $$ select public.record_trial_usage(
       (select id from public.organizations where legal_name = 'Trial Activation Test Org'),
       'ac000000-0000-0000-0000-000000000001'::uuid,
       'payfast-ref-1-retry'
     ) $$,
  'a second record_trial_usage() call for the SAME org does not error (on conflict do nothing)'
);

select is(
  (select count(*) from public.trial_usage_records
     where org_id = (select id from public.organizations where legal_name = 'Trial Activation Test Org')),
  1::bigint,
  'exactly one trial_usage_records row exists for this org despite two calls -- unique(org_id) + on conflict enforced it'
);

select * from finish();
rollback;
