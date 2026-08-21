-- V1 commercial UX pass: add-on purchasing coverage -- set_property_addon_capacity(),
-- set_owner_addon_capacity(), reconcile_addon_capacity_on_upgrade(), and their interaction with
-- reconcile_plan_limits()'s keep-list mechanism.

begin;
select plan(22);

insert into auth.users (id, email) values
  ('ae000000-0000-0000-0000-000000000001', 'addon-principal@test.propertyvault.example');

select set_config('addon.professional_id', (select id::text from public.plans where code = 'professional_monthly'), false);
select set_config('addon.starter_id', (select id::text from public.plans where code = 'starter_monthly'), false);
select set_config('addon.business_id', (select id::text from public.plans where code = 'business_monthly'), false);

insert into public.organizations (id, legal_name, org_type, status)
values ('aeae0000-0000-0000-0000-000000000001', 'Addon Purchasing Test Org', 'agency', 'active');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('aeae0000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values ('aeae0000-0000-0000-0000-000000000001', current_setting('addon.professional_id')::uuid, 'monthly', current_date, current_date + 30, 'active');

-- === Purchase: Professional buys 2 extra properties ===
select is(
  (select public.set_property_addon_capacity('aeae0000-0000-0000-0000-000000000001'::uuid, 2, null, 'ae000000-0000-0000-0000-000000000001'::uuid)),
  2, 'set_property_addon_capacity(2) returns the new absolute quantity'
);
select is(
  (select purchased_extra_properties from public.organization_subscriptions where org_id = 'aeae0000-0000-0000-0000-000000000001'),
  2, 'purchased_extra_properties is persisted as 2'
);
select is(
  (select public.org_property_limit('aeae0000-0000-0000-0000-000000000001'::uuid)),
  17, 'org_property_limit() reflects 15 included + 2 purchased = 17'
);
select is(
  (select count(*)::int from public.audit_events where org_id = 'aeae0000-0000-0000-0000-000000000001' and action = 'billing.property_addon_capacity_changed'),
  1, 'an audit event was written for the purchase'
);

-- Idempotency: calling again with the SAME target quantity converges to the same state, no
-- double-application (absolute target, not a delta).
select public.set_property_addon_capacity('aeae0000-0000-0000-0000-000000000001'::uuid, 2, null, 'ae000000-0000-0000-0000-000000000001'::uuid);
select is(
  (select purchased_extra_properties from public.organization_subscriptions where org_id = 'aeae0000-0000-0000-0000-000000000001'),
  2, 'a repeated call with the same target quantity is idempotent -- still 2, not 4'
);

-- === Starter cannot buy either add-on -- source-of-truth (extraPropertyPrice/extraOwnerPrice)
-- is null on Starter, never silently supported. ===
insert into public.organizations (id, legal_name, org_type, status)
values ('aeae0000-0000-0000-0000-000000000002', 'Starter Addon Reject Org', 'agency', 'active');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('aeae0000-0000-0000-0000-000000000002', 'ae000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values ('aeae0000-0000-0000-0000-000000000002', current_setting('addon.starter_id')::uuid, 'monthly', current_date, current_date + 30, 'active');

select throws_ok(
  $$select public.set_property_addon_capacity('aeae0000-0000-0000-0000-000000000002'::uuid, 1)$$,
  'addon_not_supported_by_plan: starter_monthly does not offer extra property capacity',
  'Starter is rejected for the extra-property add-on'
);
select throws_ok(
  $$select public.set_owner_addon_capacity('aeae0000-0000-0000-0000-000000000002'::uuid, 1)$$,
  'addon_not_supported_by_plan: starter_monthly does not offer extra owner capacity',
  'Starter is rejected for the extra-owner add-on'
);

-- === Removal over capacity requires an explicit selection ===
insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type, created_at) values
  ('aeae0000-0000-0000-0000-000000000101', 'aeae0000-0000-0000-0000-000000000001', 'P1', '1 St', 'Cape Town', 'ZA', 'house', now() - interval '5 days'),
  ('aeae0000-0000-0000-0000-000000000102', 'aeae0000-0000-0000-0000-000000000001', 'P2', '2 St', 'Cape Town', 'ZA', 'house', now() - interval '4 days'),
  ('aeae0000-0000-0000-0000-000000000103', 'aeae0000-0000-0000-0000-000000000001', 'P3', '3 St', 'Cape Town', 'ZA', 'house', now() - interval '3 days'),
  ('aeae0000-0000-0000-0000-000000000104', 'aeae0000-0000-0000-0000-000000000001', 'P4', '4 St', 'Cape Town', 'ZA', 'house', now() - interval '2 days'),
  ('aeae0000-0000-0000-0000-000000000105', 'aeae0000-0000-0000-0000-000000000001', 'P5', '5 St', 'Cape Town', 'ZA', 'house', now() - interval '1 day'),
  ('aeae0000-0000-0000-0000-000000000106', 'aeae0000-0000-0000-0000-000000000001', 'P6', '6 St', 'Cape Town', 'ZA', 'house', now() - interval '12 hours'),
  ('aeae0000-0000-0000-0000-000000000107', 'aeae0000-0000-0000-0000-000000000001', 'P7 (newest)', '7 St', 'Cape Town', 'ZA', 'house', now());
-- 7 properties in use, effective capacity 17 (plenty of room) -- confirm normal operation first.
select is(
  (select count(*)::int from public.properties where org_id = 'aeae0000-0000-0000-0000-000000000001' and status = 'active'),
  7, 'setup: 7 properties created'
);

-- Now reduce purchased extra properties from 2 to 0 -- effective capacity becomes 15, still >= 7,
-- so this must succeed WITHOUT requiring a selection.
select lives_ok(
  $$select public.set_property_addon_capacity('aeae0000-0000-0000-0000-000000000001'::uuid, 0)$$,
  'reducing add-on capacity that stays above current usage succeeds without a keep-list'
);

-- Reduce the ORG'S PLAN itself is out of scope here (that's a downgrade) -- instead simulate the
-- over-limit-removal case directly: bump usage up via more properties, then try to reduce
-- capacity below usage.
insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type, created_at) values
  ('aeae0000-0000-0000-0000-000000000108', 'aeae0000-0000-0000-0000-000000000001', 'P8', '8 St', 'Cape Town', 'ZA', 'house', now()),
  ('aeae0000-0000-0000-0000-000000000109', 'aeae0000-0000-0000-0000-000000000001', 'P9 (newest)', '9 St', 'Cape Town', 'ZA', 'house', now());
-- 9 properties now in use, 15 base capacity -- still fits. Purchase 1 extra (16 capacity, fits),
-- then attempt to reduce base... base can't reduce without a plan change, so instead exercise the
-- over-limit path by purchasing enough that the org is using MORE than the plan's own 15 base
-- would allow, then removing that add-on.
select public.set_property_addon_capacity('aeae0000-0000-0000-0000-000000000001'::uuid, 3);
-- 9 used, capacity 18 -- fine. Now add 8 more properties to reach 17 used (over the 15 base, needs
-- the 3 extra to stay under 18).
insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type, created_at)
select gen_random_uuid(), 'aeae0000-0000-0000-0000-000000000001', 'Bulk ' || n, n || ' Bulk St', 'Cape Town', 'ZA', 'house', now()
from generate_series(1, 8) as n;
select is(
  (select count(*)::int from public.properties where org_id = 'aeae0000-0000-0000-0000-000000000001' and status = 'active'),
  17, 'setup: 17 properties now in use (15 base + needs at least 2 of the 3 purchased slots)'
);

select throws_ok(
  $$select public.set_property_addon_capacity('aeae0000-0000-0000-0000-000000000001'::uuid, 0)$$,
  'addon_removal_requires_selection: 17 properties in use exceeds the new 15 capacity -- choose which stay active first',
  'removing all 3 extra slots without a selection is rejected -- 17 in use would exceed the 15 base capacity'
);

-- With an explicit keep-list of exactly 15, the removal succeeds and restriction applies to the
-- other 2.
select set_config(
  'addon.keep_15',
  (select array_to_string(array_agg(id), ',') from (
    select id from public.properties where org_id = 'aeae0000-0000-0000-0000-000000000001' and status = 'active'
    order by created_at asc limit 15
  ) s),
  false
);
select lives_ok(
  format(
    $$select public.set_property_addon_capacity('aeae0000-0000-0000-0000-000000000001'::uuid, 0, string_to_array('%s', ',')::uuid[])$$,
    current_setting('addon.keep_15')
  ),
  'removing all 3 extra slots WITH an explicit 15-item keep-list succeeds'
);
select is(
  (select count(*)::int from public.properties where org_id = 'aeae0000-0000-0000-0000-000000000001' and restricted_by_plan = true),
  2, 'exactly 2 properties (17 in use - 15 new capacity) are restricted after the add-on removal'
);
select is(
  (select purchased_extra_properties from public.organization_subscriptions where org_id = 'aeae0000-0000-0000-0000-000000000001'),
  0, 'purchased_extra_properties is now 0'
);

-- === Upgrade auto-reconciles now-unnecessary add-ons ===
-- Buy 3 extra properties again on top of the still-restricted state, then upgrade to Business
-- (25 base) -- the org's real usage (17) fits entirely within Business's own base allowance, so
-- reconcile_addon_capacity_on_upgrade() must reduce purchased_extra_properties back to 0.
select public.set_property_addon_capacity(
  'aeae0000-0000-0000-0000-000000000001'::uuid, 3,
  (select array_agg(id) from public.properties where org_id = 'aeae0000-0000-0000-0000-000000000001' and status = 'active')
);
select is(
  (select purchased_extra_properties from public.organization_subscriptions where org_id = 'aeae0000-0000-0000-0000-000000000001'),
  3, 'setup: 3 extra property slots purchased again before the upgrade'
);

update public.organization_subscriptions set plan_id = current_setting('addon.business_id')::uuid
  where org_id = 'aeae0000-0000-0000-0000-000000000001';
select public.reconcile_addon_capacity_on_upgrade('aeae0000-0000-0000-0000-000000000001'::uuid);
select is(
  (select purchased_extra_properties from public.organization_subscriptions where org_id = 'aeae0000-0000-0000-0000-000000000001'),
  0, 'upgrading to Business (25 base, 17 in use) makes all 3 purchased slots unnecessary -- reduced to 0, never billed for'
);

-- A partial reduction case: purchase 5 extra on Business-with-25-base-but-only-17-used is
-- unnecessary too (17 < 25) -- but if usage were, say, 27 (over the 25 base), only 2 would remain
-- required. Simulate directly.
select public.set_property_addon_capacity('aeae0000-0000-0000-0000-000000000001'::uuid, 5);
insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type, created_at)
select gen_random_uuid(), 'aeae0000-0000-0000-0000-000000000001', 'Extra ' || n, n || ' Extra St', 'Cape Town', 'ZA', 'house', now()
from generate_series(1, 10) as n;
select is(
  (select count(*)::int from public.properties where org_id = 'aeae0000-0000-0000-0000-000000000001' and status = 'active'),
  27, 'setup: 27 properties now in use (over Business''s 25 base)'
);
select public.reconcile_addon_capacity_on_upgrade('aeae0000-0000-0000-0000-000000000001'::uuid);
select is(
  (select purchased_extra_properties from public.organization_subscriptions where org_id = 'aeae0000-0000-0000-0000-000000000001'),
  2, 'reconcile_addon_capacity_on_upgrade() only reduces to what''s STILL required (27 - 25 = 2), never below it'
);

-- === Owner add-on: negative/invalid quantity, no-subscription org ===
select throws_ok(
  $$select public.set_owner_addon_capacity('aeae0000-0000-0000-0000-000000000001'::uuid, -1)$$,
  'invalid_addon_quantity: target quantity cannot be negative',
  'a negative target quantity is rejected'
);

insert into public.organizations (id, legal_name, org_type, status)
values ('aeae0000-0000-0000-0000-000000000003', 'No Subscription Org', 'agency', 'trial');
select throws_ok(
  $$select public.set_property_addon_capacity('aeae0000-0000-0000-0000-000000000003'::uuid, 1)$$,
  'no_subscription: organization has no subscription on record',
  'an org with no organization_subscriptions row at all is rejected, not silently allowed'
);

select is(
  (select public.set_owner_addon_capacity('aeae0000-0000-0000-0000-000000000001'::uuid, 1, null, 'ae000000-0000-0000-0000-000000000001'::uuid)),
  1, 'Business org can purchase an owner add-on'
);
select is(
  (select count(*)::int from public.audit_events where org_id = 'aeae0000-0000-0000-0000-000000000001' and action = 'billing.owner_addon_capacity_changed'),
  1, 'an audit event was written for the owner add-on purchase'
);

select * from finish();
rollback;
