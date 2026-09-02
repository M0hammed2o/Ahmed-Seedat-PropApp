-- Tests for migration 20260101000163 (V1 utilities/rates/levies pass):
-- recurring_property_costs (effective-dated rates/levy config), utility_responsibility_settings,
-- utility_meters, utility_readings.

begin;
select plan(23);

insert into auth.users (id, email) values
  ('c5000000-0000-0000-0000-000000000001', 'rc-accountant@test.propertyvault.example'),
  ('c5000000-0000-0000-0000-000000000002', 'rc-viewer@test.propertyvault.example'),
  ('c5000000-0000-0000-0000-000000000003', 'rc-other-org@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('c5111111-0000-0000-0000-000000000001', 'RC Test Org', 'agency'),
  ('c5111111-0000-0000-0000-000000000002', 'RC Other Org', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('c5111111-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'accountant', 'active', now()),
  ('c5111111-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'viewer', 'active', now()),
  ('c5111111-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000003', 'accountant', 'active', now());

insert into public.properties (id, org_id, owner_user_id, nickname, address_line1, city, province, postal_code)
values
  ('c5222222-0000-0000-0000-000000000001', 'c5111111-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'RC Test Property', '1 Test St', 'Cape Town', 'Western Cape', '8001'),
  ('c5222222-0000-0000-0000-000000000002', 'c5111111-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000003', 'RC Other Property', '2 Test St', 'Cape Town', 'Western Cape', '8001');

insert into public.units (id, property_id, org_id, unit_label)
values ('c5333333-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', 'c5111111-0000-0000-0000-000000000001', 'Unit 4B');

-- === recurring_property_costs: set_recurring_property_cost, effective dating ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001'; -- accountant

select isnt(
  public.set_recurring_property_cost(
    'c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001',
    'c5333333-0000-0000-0000-000000000001', 'levy', 2000, '2026-01-01'
  ),
  null,
  'accountant can set a unit-level levy (scenario 1: sectional-title unit)'
);

select is(
  (select amount from public.recurring_property_costs where unit_id = 'c5333333-0000-0000-0000-000000000001' and cost_type = 'levy' and effective_to is null),
  2000::numeric,
  'the current levy amount is 2000'
);

-- Rate increase -- must not overwrite the old row.
select isnt(public.set_recurring_property_cost(
  'c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001',
  'c5333333-0000-0000-0000-000000000001', 'levy', 2200, '2026-03-01'
), null, 'a levy increase creates a new current row');

select is(
  (select count(*) from public.recurring_property_costs where unit_id = 'c5333333-0000-0000-0000-000000000001' and cost_type = 'levy'),
  2::bigint,
  'both the old and new levy rows still exist -- history is never overwritten'
);

select is(
  (select effective_to from public.recurring_property_costs where unit_id = 'c5333333-0000-0000-0000-000000000001' and cost_type = 'levy' and amount = 2000),
  date '2026-02-28',
  'the superseded row''s effective_to is the day before the new row''s effective_from'
);

select is(
  (select amount from public.recurring_property_costs where unit_id = 'c5333333-0000-0000-0000-000000000001' and cost_type = 'levy' and effective_to is null),
  2200::numeric,
  'the current levy amount is now 2200'
);

-- Retiring a cost (levy not applicable) -- must not leave a bogus zero row.
select is(public.set_recurring_property_cost(
  'c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001',
  'c5333333-0000-0000-0000-000000000001', 'levy', null, '2026-06-01'
), null, 'p_amount = null retires the cost, returning no new row id');

select is(
  (select count(*) from public.recurring_property_costs where unit_id = 'c5333333-0000-0000-0000-000000000001' and cost_type = 'levy' and effective_to is null),
  0::bigint,
  'no current levy row exists after retiring -- never a bogus zero-amount placeholder'
);

-- Property-level rates (whole-building ownership, scenario 2) -- no unit_id.
select isnt(public.set_recurring_property_cost(
  'c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001',
  null, 'rates_and_taxes', 5000, '2026-01-01'
), null, 'a property-level rates row can be set with no unit_id (whole-building ownership)');

insert into public.recurring_property_costs (org_id, property_id, unit_id, cost_type, amount, effective_from, created_by)
values ('c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', 'c5333333-0000-0000-0000-000000000001', 'rates_and_taxes', 1500, '2026-01-01', 'c5000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ insert into public.recurring_property_costs (org_id, property_id, unit_id, cost_type, amount, effective_from, created_by)
     values ('c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', 'c5333333-0000-0000-0000-000000000001', 'rates_and_taxes', 1600, '2026-02-01', 'c5000000-0000-0000-0000-000000000001') $$,
  null, null,
  'a second CURRENT unit-level row for the same cost_type is rejected by the partial unique index'
);

reset role;

-- === org isolation ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000003'; -- other org accountant

select is(
  (select count(*) from public.recurring_property_costs where property_id = 'c5222222-0000-0000-0000-000000000001'),
  0::bigint,
  'another organization cannot see this org''s recurring_property_costs rows (org isolation)'
);

select throws_ok(
  $$ select public.set_recurring_property_cost('c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', null, 'rates_and_taxes', 9999, '2026-01-01') $$,
  null, null,
  'a caller from another org cannot set a recurring cost for this org (permission denied)'
);

reset role;

-- === utility_responsibility_settings ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001'; -- accountant

insert into public.utility_responsibility_settings (org_id, property_id, unit_id, utility_type, responsibility_mode)
values ('c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', 'c5333333-0000-0000-0000-000000000001', 'water', 'owner_paid');

select is(
  (select responsibility_mode from public.utility_responsibility_settings where unit_id = 'c5333333-0000-0000-0000-000000000001' and utility_type = 'water'),
  'owner_paid'::public.utility_responsibility_mode,
  'water responsibility can be set to owner_paid for a unit (scenario 4: owner-paid water)'
);

insert into public.utility_responsibility_settings (org_id, property_id, unit_id, utility_type, responsibility_mode)
values ('c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', 'c5333333-0000-0000-0000-000000000001', 'electricity', 'tenant_prepaid');

select is(
  (select responsibility_mode from public.utility_responsibility_settings where unit_id = 'c5333333-0000-0000-0000-000000000001' and utility_type = 'electricity'),
  'tenant_prepaid'::public.utility_responsibility_mode,
  'electricity responsibility can be set to tenant_prepaid for a unit (scenario 3: tenant prepaid electricity)'
);

select throws_ok(
  $$ insert into public.utility_responsibility_settings (org_id, property_id, unit_id, utility_type, responsibility_mode)
     values ('c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', 'c5333333-0000-0000-0000-000000000001', 'water', 'common_area_owner') $$,
  null, null,
  'common_area_owner cannot be set on a unit-scoped row -- it is inherently property-level'
);

insert into public.utility_responsibility_settings (org_id, property_id, unit_id, utility_type, responsibility_mode)
values ('c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', null, 'electricity', 'common_area_owner');

select is(
  (select responsibility_mode from public.utility_responsibility_settings where property_id = 'c5222222-0000-0000-0000-000000000001' and unit_id is null and utility_type = 'electricity'),
  'common_area_owner'::public.utility_responsibility_mode,
  'common_area_owner can be set property-wide with no unit_id (scenario 5: common-area electricity)'
);

select throws_ok(
  $$ insert into public.utility_responsibility_settings (org_id, property_id, unit_id, utility_type, responsibility_mode)
     values ('c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'water', 'owner_paid') $$,
  null, null,
  'a unit_id that does not belong to property_id is rejected by the validation trigger'
);

-- === utility_meters + utility_readings ===
insert into public.utility_meters (id, org_id, property_id, unit_id, utility_type, meter_number, responsibility_mode, is_prepaid)
values ('c5444444-0000-0000-0000-000000000001', 'c5111111-0000-0000-0000-000000000001', 'c5222222-0000-0000-0000-000000000001', 'c5333333-0000-0000-0000-000000000001', 'water', 'WM-001', 'owner_paid', false);

select isnt(public.record_utility_reading(
  'c5444444-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31', 1000, 'L'
), null, 'a first reading (no prior period) can be recorded -- August 1,000 L');

select is(
  (select consumption from public.utility_readings where meter_id = 'c5444444-0000-0000-0000-000000000001' and period_month = '2026-08-01'),
  null,
  'the first reading for a meter has null consumption (no prior period to derive it from)'
);

select isnt(public.record_utility_reading(
  'c5444444-0000-0000-0000-000000000001', '2026-09-01', '2026-09-30', 1200, 'L'
), null, 'a second reading can be recorded -- September 1,200 L');

select is(
  (select consumption from public.utility_readings where meter_id = 'c5444444-0000-0000-0000-000000000001' and period_month = '2026-09-01'),
  200::numeric,
  'September consumption is computed server-side as 1200 - 1000 = 200 L (20% increase scenario)'
);

select throws_ok(
  $$ select public.record_utility_reading('c5444444-0000-0000-0000-000000000001', '2026-09-01', '2026-09-30', 1300, 'L') $$,
  null, null,
  'recording a second reading for the same meter+period without p_replace_existing is rejected'
);

select throws_ok(
  $$ select public.record_utility_reading('c5444444-0000-0000-0000-000000000001', '2026-10-01', '2026-10-31', -5, 'L') $$,
  null, null,
  'a negative reading value is rejected'
);

select * from finish();
rollback;
