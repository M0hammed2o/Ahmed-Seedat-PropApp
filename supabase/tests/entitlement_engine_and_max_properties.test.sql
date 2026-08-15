-- Tests for 20260101000102_entitlement_engine_and_max_properties.sql: maxProperties is now
-- actually enforced (create_property() RPC-level, the only client-facing creation path), and the
-- new generic org_feature_enabled() resolver for the boolean feature_limits keys.

begin;
select plan(19);

insert into auth.users (id, email) values
  ('e5000000-0000-0000-0000-000000000001', 'ent2-unlimited-principal@test.propertyvault.example'),
  ('e5000000-0000-0000-0000-000000000002', 'ent2-starter-principal@test.propertyvault.example');

-- === Org with no organization_subscriptions row at all: unlimited, unchanged ===
insert into public.organizations (id, legal_name, org_type)
values ('e6000000-0000-0000-0000-000000000001', 'Entitlement2 Test Org A (unlimited)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('e6000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'principal', 'active', now());

select is(
  (select public.available_property_slots('e6000000-0000-0000-0000-000000000001')),
  null,
  'available_property_slots() is null (unlimited) for an org with no organization_subscriptions row'
);
select ok(
  (select public.org_feature_enabled('e6000000-0000-0000-0000-000000000001', 'ocrEnabled')),
  'org_feature_enabled() defaults to TRUE for an org with no subscription row at all (trial, full access)'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'e5000000-0000-0000-0000-000000000001';
select isnt(
  (select public.create_property('e6000000-0000-0000-0000-000000000001', 'Unlimited Property 1', '1 St', 'Cape Town', 'ZA', 'apartment'::public.property_type)),
  null,
  'an unlimited-plan org can create a property (unaffected by this migration)'
);

-- === Starter-plan org: maxProperties = 5, ocrEnabled/ownerPortalEnabled/advancedReporting/bulkCommunications = false ===
reset role;
insert into public.organizations (id, legal_name, org_type)
values ('e6000000-0000-0000-0000-000000000002', 'Entitlement2 Test Org B (starter)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('e6000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000002', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'e6000000-0000-0000-0000-000000000002',
  (select id from public.plans where code = 'starter'),
  'monthly', current_date, current_date + interval '1 month', 'active'
);

select is(
  (select public.org_property_limit('e6000000-0000-0000-0000-000000000002')), 5,
  'org_property_limit() reads the starter plan''s feature_limits.maxProperties (5)'
);
select is(
  (select public.org_active_property_count('e6000000-0000-0000-0000-000000000002')), 0,
  'org_active_property_count() is 0 before any properties are created'
);
select is(
  (select public.available_property_slots('e6000000-0000-0000-0000-000000000002')), 5,
  'available_property_slots() is 5 (5 limit - 0 properties)'
);
select is((select public.org_feature_enabled('e6000000-0000-0000-0000-000000000002', 'ocrEnabled')), false,
  'org_feature_enabled(ocrEnabled) is false on Starter (seeded explicitly false, not just absent)');
select is((select public.org_feature_enabled('e6000000-0000-0000-0000-000000000002', 'ownerPortalEnabled')), false,
  'org_feature_enabled(ownerPortalEnabled) is false on Starter');
select is((select public.org_feature_enabled('e6000000-0000-0000-0000-000000000002', 'advancedReporting')), false,
  'org_feature_enabled(advancedReporting) is false on Starter');
select is((select public.org_feature_enabled('e6000000-0000-0000-0000-000000000002', 'apiAccess')), false,
  'org_feature_enabled(apiAccess) is false on Starter (key entirely absent from Starter''s feature_limits -- still resolves false, not null/error)');

set local role authenticated;
set local "request.jwt.claim.sub" = 'e5000000-0000-0000-0000-000000000002';

-- Fill the 5-property limit.
select lives_ok(
  $$ select public.create_property('e6000000-0000-0000-0000-000000000002', 'Starter Property 1', '1 St', 'Cape Town', 'ZA', 'apartment'::public.property_type) $$,
  'property 1 of 5 creates successfully'
);
select lives_ok(
  $$ select public.create_property('e6000000-0000-0000-0000-000000000002', 'Starter Property 2', '2 St', 'Cape Town', 'ZA', 'apartment'::public.property_type) $$,
  'property 2 of 5 creates successfully'
);
select lives_ok(
  $$ select public.create_property('e6000000-0000-0000-0000-000000000002', 'Starter Property 3', '3 St', 'Cape Town', 'ZA', 'apartment'::public.property_type) $$,
  'property 3 of 5 creates successfully'
);
select lives_ok(
  $$ select public.create_property('e6000000-0000-0000-0000-000000000002', 'Starter Property 4', '4 St', 'Cape Town', 'ZA', 'apartment'::public.property_type) $$,
  'property 4 of 5 creates successfully'
);
select lives_ok(
  $$ select public.create_property('e6000000-0000-0000-0000-000000000002', 'Starter Property 5', '5 St', 'Cape Town', 'ZA', 'apartment'::public.property_type) $$,
  'property 5 of 5 creates successfully'
);

reset role;
select is(
  (select public.available_property_slots('e6000000-0000-0000-0000-000000000002')), 0,
  'available_property_slots() drops to 0 once the 5-property Starter limit is reached'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'e5000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.create_property('e6000000-0000-0000-0000-000000000002', 'Starter Property 6 (over limit)', '6 St', 'Cape Town', 'ZA', 'apartment'::public.property_type) $$,
  'P0001',
  'property_limit_reached: You have reached the property limit for your current plan. Upgrade your plan to add more properties.',
  'the 6th property on a Starter (5-limit) org is rejected, RPC-level, not just at the API route'
);

-- Archiving one property frees a slot -- confirms only ACTIVE properties count.
reset role;
update public.properties set status = 'archived'
where org_id = 'e6000000-0000-0000-0000-000000000002' and nickname = 'Starter Property 1';

select is(
  (select public.available_property_slots('e6000000-0000-0000-0000-000000000002')), 1,
  'archiving one property frees a slot (only active/non-archived properties count toward the plan limit)'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'e5000000-0000-0000-0000-000000000002';
select lives_ok(
  $$ select public.create_property('e6000000-0000-0000-0000-000000000002', 'Starter Property 7 (replaces archived)', '7 St', 'Cape Town', 'ZA', 'apartment'::public.property_type) $$,
  'a freed slot (from archiving) can be used to create a new property'
);

select * from finish();
rollback;
