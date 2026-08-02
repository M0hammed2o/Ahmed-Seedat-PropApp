-- RLS tests for billing_events (migration 20260101000054) -- org-scoped read, no client write
-- path (service-role/webhook-receiver only), and the idempotency unique constraint itself.

begin;
select plan(7);

insert into auth.users (id, email) values
  ('a9000000-0000-0000-0000-000000000001', 'billing-member-a@test.propertyvault.example'),
  ('a9000000-0000-0000-0000-000000000002', 'billing-member-b@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type) values
  ('a9a9a9a9-0000-0000-0000-000000000001', 'Billing Test Org A', 'agency'),
  ('a9a9a9a9-0000-0000-0000-000000000002', 'Billing Test Org B', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('a9a9a9a9-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('a9a9a9a9-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000002', 'principal', 'active', now());

insert into public.billing_events (org_id, provider_name, provider_event_id, event_type, payload) values
  ('a9a9a9a9-0000-0000-0000-000000000001', 'mock', 'evt_1', 'payment_succeeded', '{}');

set local role authenticated;
set local "request.jwt.claim.sub" = 'a9000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.billing_events where org_id = 'a9a9a9a9-0000-0000-0000-000000000001'),
  1::bigint,
  'Org A member can SELECT their own org''s billing_events'
);

set local "request.jwt.claim.sub" = 'a9000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.billing_events where org_id = 'a9a9a9a9-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B member cannot see Org A''s billing_events (cross-org isolation)'
);

select throws_ok(
  $$ insert into public.billing_events (org_id, provider_name, provider_event_id, event_type)
     values ('a9a9a9a9-0000-0000-0000-000000000002', 'mock', 'evt_2', 'payment_succeeded') $$,
  '42501',
  null,
  'no authenticated-role client can INSERT into billing_events (service-role/webhook-receiver only)'
);

set local "request.jwt.claim.sub" = 'a9000000-0000-0000-0000-000000000001';

-- No UPDATE policy exists at all, so this isn't a permission error, it's zero visible rows to
-- update -- runs without error, verified next to have changed nothing (same "lives_ok, filtered
-- to zero rows" shape used throughout this session's other RLS tests, e.g. leasing_isolation).
select lives_ok(
  $$ update public.billing_events set event_type = 'payment_failed' where provider_event_id = 'evt_1' $$,
  'authenticated-role UPDATE against billing_events runs without error (no UPDATE policy, filtered to zero rows)'
);

reset role;

select is(
  (select event_type from public.billing_events where provider_event_id = 'evt_1'),
  'payment_succeeded'::public.billing_event_type,
  'the row is genuinely unchanged -- the UPDATE above really did affect zero rows, not silently succeed'
);

-- Still reset (superuser/service-role-equivalent) here on purpose -- the point of this assertion
-- is the UNIQUE constraint itself (23505), not RLS (42501); running it as authenticated would
-- hit the RLS denial first and never actually exercise the constraint this test is named for.
select throws_ok(
  $$ insert into public.billing_events (org_id, provider_name, provider_event_id, event_type, payload)
     values ('a9a9a9a9-0000-0000-0000-000000000001', 'mock', 'evt_1', 'payment_succeeded', '{}') $$,
  '23505',
  null,
  'a duplicate (provider_name, provider_event_id) is rejected by the unique constraint -- the real idempotency guard'
);

select is(
  (select count(*) from public.billing_events where provider_event_id = 'evt_1'),
  1::bigint,
  'still exactly one billing_events row for evt_1 after the rejected duplicate insert attempt'
);

select * from finish();
rollback;
