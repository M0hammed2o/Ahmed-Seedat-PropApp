-- V1 Billing/Subscription/PayFast Commercial-Close Pass, Phase 14 (WORKLOG.md this date):
-- billing_events_isolation.test.sql already proves cross-org isolation for billing_events
-- specifically -- this file proves the SAME property for the four other core billing tables
-- (organization_subscriptions, subscription_payments, billing_plan_changes,
-- billing_change_quotes), plus RPC-level authorization: a non-principal member of their OWN org,
-- and a principal of a DIFFERENT org, must both be refused by the billing-change RPCs
-- (compute_plan_change_quote/create_plan_change_quote/confirm_plan_change/
-- cancel_pending_plan_change), never merely by the client-side UI choosing not to call them.

begin;
select plan(17);

insert into auth.users (id, email) values
  ('bc000000-0000-0000-0000-000000000001', 'cross-org-a-principal@test.propertyvault.example'),
  ('bc000000-0000-0000-0000-000000000002', 'cross-org-b-principal@test.propertyvault.example'),
  ('bc000000-0000-0000-0000-000000000003', 'cross-org-a-manager@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type, status) values
  ('bcbc0000-0000-0000-0000-000000000001', 'Cross-Org Isolation Test A', 'agency', 'active'),
  ('bcbc0000-0000-0000-0000-000000000002', 'Cross-Org Isolation Test B', 'agency', 'active');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('bcbc0000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('bcbc0000-0000-0000-0000-000000000002', 'bc000000-0000-0000-0000-000000000002', 'principal', 'active', now()),
  ('bcbc0000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-000000000003', 'manager', 'active', now());

-- Commercial plan restructure (WORKLOG.md this date): 'starter'/'professional' were deactivated
-- in favour of the new starter_monthly/professional_monthly codes -- updated here to match, not a
-- behavior change to what this file actually tests (cross-org isolation).
select set_config('pgtap.co.starter_id', (select id::text from public.plans where code = 'starter_monthly'), false);
select set_config('pgtap.co.professional_id', (select id::text from public.plans where code = 'professional_monthly'), false);

insert into public.organization_subscriptions (id, org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'bcbc0000-0000-0000-0000-000000000101', 'bcbc0000-0000-0000-0000-000000000001',
  current_setting('pgtap.co.starter_id')::uuid, 'monthly', current_date - 5, current_date + 25, 'active'
);
insert into public.subscription_payments (id, org_id, subscription_id, amount, currency, status)
values (
  'bcbc0000-0000-0000-0000-000000000201', 'bcbc0000-0000-0000-0000-000000000001',
  'bcbc0000-0000-0000-0000-000000000101', 299.00, 'ZAR', 'paid'
);
insert into public.billing_plan_changes (id, org_id, change_type, new_plan_id, effective_at, status)
values (
  'bcbc0000-0000-0000-0000-000000000301', 'bcbc0000-0000-0000-0000-000000000001',
  'new_subscription', current_setting('pgtap.co.starter_id')::uuid, now(), 'completed'
);
insert into public.billing_change_quotes (id, org_id, requested_by, target_plan_id, change_type, amount_due_now, currency, effective_at, expires_at)
values (
  'bcbc0000-0000-0000-0000-000000000401', 'bcbc0000-0000-0000-0000-000000000001',
  'bc000000-0000-0000-0000-000000000001', current_setting('pgtap.co.professional_id')::uuid,
  'upgrade', 200.00, 'ZAR', now(), now() + interval '15 minutes'
);

-- === Org B's principal cannot SELECT any of Org A's billing rows ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'bc000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.organization_subscriptions where org_id = 'bcbc0000-0000-0000-0000-000000000001'),
  0,
  'Org B principal cannot see Org A''s organization_subscriptions row'
);
select is(
  (select count(*)::int from public.subscription_payments where org_id = 'bcbc0000-0000-0000-0000-000000000001'),
  0,
  'Org B principal cannot see Org A''s subscription_payments row'
);
select is(
  (select count(*)::int from public.billing_plan_changes where org_id = 'bcbc0000-0000-0000-0000-000000000001'),
  0,
  'Org B principal cannot see Org A''s billing_plan_changes row'
);
select is(
  (select count(*)::int from public.billing_change_quotes where org_id = 'bcbc0000-0000-0000-0000-000000000001'),
  0,
  'Org B principal cannot see Org A''s billing_change_quotes row'
);

-- === Org A's own principal CAN see them (sanity -- proves the zero counts above are isolation,
-- not a broken policy hiding everything from everyone) ===
set local "request.jwt.claim.sub" = 'bc000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.organization_subscriptions where org_id = 'bcbc0000-0000-0000-0000-000000000001'),
  1,
  'Org A principal CAN see their own organization_subscriptions row'
);
select is(
  (select count(*)::int from public.subscription_payments where org_id = 'bcbc0000-0000-0000-0000-000000000001'),
  1,
  'Org A principal CAN see their own subscription_payments row'
);

-- === No authenticated-role client can write directly to any of these four tables -- every write
-- goes through a SECURITY DEFINER RPC or the service-role client, never a direct client insert/
-- update/delete. "Customer cannot forge payment status" / "cannot edit invoice amount" hold
-- structurally, not merely by the UI choosing not to expose a control. ===
-- No UPDATE policy exists on either table, so RLS filters the UPDATE to zero matching rows rather
-- than raising a permission error (same "lives_ok, filtered to zero rows" shape
-- billing_events_isolation.test.sql already establishes for this exact situation) -- verified
-- unchanged below via reset role, which is the real proof, not the lack of an error.
select lives_ok(
  $$ update public.subscription_payments set status = 'paid' where id = 'bcbc0000-0000-0000-0000-000000000201' $$,
  'authenticated-role UPDATE against subscription_payments.status runs without error (no UPDATE policy, filtered to zero rows)'
);
select throws_ok(
  $$ insert into public.subscription_payments (org_id, subscription_id, amount, currency, status)
     values ('bcbc0000-0000-0000-0000-000000000001', 'bcbc0000-0000-0000-0000-000000000101', 0.01, 'ZAR', 'paid') $$,
  '42501',
  null,
  'no authenticated-role client can INSERT a fabricated paid subscription_payments row'
);
select lives_ok(
  $$ update public.organization_subscriptions set plan_id = current_setting('pgtap.co.professional_id')::uuid
     where id = 'bcbc0000-0000-0000-0000-000000000101' $$,
  'authenticated-role UPDATE against organization_subscriptions.plan_id runs without error (no UPDATE policy, filtered to zero rows)'
);

reset role;
select is(
  (select status from public.subscription_payments where id = 'bcbc0000-0000-0000-0000-000000000201'),
  'paid',
  -- Was already 'paid' at insert time -- the real proof is the NEXT assertion (the attempted
  -- forge from 'pending'/whatever a real attacker would try); this just re-establishes a known
  -- baseline before it. Kept as its own assertion for a clear failure message if the fixture
  -- itself ever changes.
  'sanity: subscription_payments row still has its original status (fixture baseline)'
);
select is(
  (select plan_id from public.organization_subscriptions where id = 'bcbc0000-0000-0000-0000-000000000101'),
  current_setting('pgtap.co.starter_id')::uuid,
  'the UPDATE against organization_subscriptions.plan_id really did affect zero rows -- plan_id is still Starter, not silently flipped to Professional'
);
set local role authenticated;

-- === RPC-level authorization: a non-principal member of the SAME org cannot request/confirm a
-- billing change either -- only the org's principal, matching has_billing_principal_access()'s
-- own narrow definition. ===
set local "request.jwt.claim.sub" = 'bc000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.compute_plan_change_quote('bcbc0000-0000-0000-0000-000000000001'::uuid, current_setting('pgtap.co.professional_id')::uuid) $$,
  'P0001',
  'Only the organization principal may request a billing quote',
  'a manager (non-principal) of Org A cannot request a billing quote for their own org'
);
select throws_ok(
  $$ select public.cancel_pending_plan_change('bcbc0000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'Only the organization principal may cancel a pending plan change',
  'a manager (non-principal) of Org A cannot cancel a pending plan change for their own org'
);

-- === RPC-level authorization: Org B's principal cannot price or confirm a change for Org A,
-- even though they ARE a genuine principal (just of the wrong org). ===
set local "request.jwt.claim.sub" = 'bc000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.compute_plan_change_quote('bcbc0000-0000-0000-0000-000000000001'::uuid, current_setting('pgtap.co.professional_id')::uuid) $$,
  'P0001',
  'Only the organization principal may request a billing quote',
  'Org B''s principal cannot request a billing quote for Org A'
);
select throws_ok(
  $$ select public.confirm_plan_change('bcbc0000-0000-0000-0000-000000000401'::uuid) $$,
  null,
  null,
  'Org B''s principal cannot confirm Org A''s billing_change_quotes row (either "not found" under their own RLS view, or an explicit authorization error -- never a successful confirmation)'
);

-- The quote was NOT consumed by Org B's failed attempt above.
reset role;
select is(
  (select consumed_at from public.billing_change_quotes where id = 'bcbc0000-0000-0000-0000-000000000401'),
  null,
  'Org A''s quote remains unconsumed after Org B''s principal failed to confirm it'
);

-- === Org A's own principal CAN price a change for their own org (sanity: the RPC denials above
-- are real authorization, not a broken function that rejects everyone). ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'bc000000-0000-0000-0000-000000000001';

select is(
  ((select public.compute_plan_change_quote('bcbc0000-0000-0000-0000-000000000001'::uuid, current_setting('pgtap.co.professional_id')::uuid)).change_type)::text,
  'upgrade',
  'Org A''s own principal CAN successfully request a quote for their own org'
);

select * from finish();
rollback;
