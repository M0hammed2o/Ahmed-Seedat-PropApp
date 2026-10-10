-- Tests for migration 20260101000178 (hybrid utilities: sources, tariffs v2, billing v2, statements).

begin;
select plan(26);

insert into auth.users (id, email) values
  ('f9000000-0000-0000-0000-00000000000a', 'hy-accountant@test.propertyvault.example'),
  ('f9000000-0000-0000-0000-00000000000b', 'hy-viewer@test.propertyvault.example'),
  ('f9000000-0000-0000-0000-00000000000c', 'hy-tenant1@test.propertyvault.example'),
  ('f9000000-0000-0000-0000-00000000000d', 'hy-tenant2@test.propertyvault.example'),
  ('f9000000-0000-0000-0000-00000000000e', 'hy-other@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type) values
  ('f9111111-0000-0000-0000-000000000001', 'HY Org', 'agency'),
  ('f9111111-0000-0000-0000-000000000002', 'HY Other', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode) values
  ('f9111111-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-00000000000a', 'accountant', 'active', now(), 'all'),
  ('f9111111-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-00000000000b', 'viewer', 'active', now(), 'all'),
  ('f9111111-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-00000000000e', 'accountant', 'active', now(), 'all');

insert into public.properties (id, org_id, nickname, address_line1, city, province, postal_code) values
  ('f9222222-0000-0000-0000-000000000001', 'f9111111-0000-0000-0000-000000000001', 'HY Block', '1', 'Durban', 'KwaZulu-Natal', '4001'),
  ('f9222222-0000-0000-0000-000000000002', 'f9111111-0000-0000-0000-000000000002', 'HY Other', '2', 'Durban', 'KwaZulu-Natal', '4001');

insert into public.units (id, property_id, org_id, unit_label, size_sqm) values
  ('f9333333-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9111111-0000-0000-0000-000000000001', 'Flat 1', 60),
  ('f9333333-0000-0000-0000-000000000002', 'f9222222-0000-0000-0000-000000000001', 'f9111111-0000-0000-0000-000000000001', 'Flat 2', 40),
  ('f9333333-0000-0000-0000-000000000009', 'f9222222-0000-0000-0000-000000000002', 'f9111111-0000-0000-0000-000000000002', 'Other 1', 50);

insert into public.tenants (id, org_id, full_name, status, user_id) values
  ('f9444444-0000-0000-0000-000000000001', 'f9111111-0000-0000-0000-000000000001', 'Tenant One', 'active', 'f9000000-0000-0000-0000-00000000000c'),
  ('f9444444-0000-0000-0000-000000000002', 'f9111111-0000-0000-0000-000000000001', 'Tenant Two', 'active', 'f9000000-0000-0000-0000-00000000000d');
insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status) values
  ('f9555555-0000-0000-0000-000000000001', 'f9111111-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000001', '2026-01-01', 8000, 'active'),
  ('f9555555-0000-0000-0000-000000000002', 'f9111111-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000002', '2026-01-01', 6000, 'active');
insert into public.lease_tenants (lease_id, tenant_id, is_primary) values
  ('f9555555-0000-0000-0000-000000000001', 'f9444444-0000-0000-0000-000000000001', true),
  ('f9555555-0000-0000-0000-000000000002', 'f9444444-0000-0000-0000-000000000002', true);

insert into public.utility_supply_sources (id, org_id, property_id, utility_type, source_type, name) values
  ('f9666666-0000-0000-0000-000000000001', 'f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'electricity', 'solar_pv', 'Roof PV'),
  ('f9666666-0000-0000-0000-000000000002', 'f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'water', 'borehole', 'Borehole');

insert into public.utility_meters (id, org_id, property_id, unit_id, utility_type, responsibility_mode, meter_role, measurement_kind, supply_source_id) values
  ('f9777777-0000-0000-0000-000000000001', 'f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000001', 'electricity', 'owner_paid', 'submeter', 'consumption', null),
  ('f9777777-0000-0000-0000-000000000002', 'f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', null, 'electricity', 'owner_paid', 'main', 'generation', 'f9666666-0000-0000-0000-000000000001');

insert into public.utility_tariffs (id, org_id, property_id, utility_type, name, blocks, effective_from) values
  ('f9888888-0000-0000-0000-000000000001', 'f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'electricity', 'Illustrative', '[{"upTo":null,"rate":3}]', '2026-07-01');

insert into public.utility_charges (id, org_id, property_id, unit_id, meter_id, lease_id, tenant_id, utility_type, period_start, period_end, consumption_quality, total_amount, status, tariff_id) values
  ('f9999999-0000-0000-0000-000000000001', 'f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000001', 'f9777777-0000-0000-0000-000000000001', 'f9555555-0000-0000-0000-000000000001', 'f9444444-0000-0000-0000-000000000001', 'electricity', '2026-09-01', '2026-10-01', 'complete', 300, 'invoiced', 'f9888888-0000-0000-0000-000000000001'),
  ('f9999999-0000-0000-0000-000000000002', 'f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000001', 'f9777777-0000-0000-0000-000000000001', 'f9555555-0000-0000-0000-000000000001', 'f9444444-0000-0000-0000-000000000001', 'electricity', '2026-10-01', '2026-11-01', 'complete', 310, 'draft', 'f9888888-0000-0000-0000-000000000001');

insert into public.utility_statements (org_id, property_id, audience, lease_id, period_start, period_end, status, snapshot) values
  ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'tenant', 'f9555555-0000-0000-0000-000000000001', '2026-09-01', '2026-10-01', 'approved', '{}'),
  ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'tenant', 'f9555555-0000-0000-0000-000000000001', '2026-10-01', '2026-11-01', 'draft', '{}'),
  ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'tenant', 'f9555555-0000-0000-0000-000000000002', '2026-09-01', '2026-10-01', 'approved', '{}');

-- ------------------------------------------------ integrity (as postgres)
select throws_ok($$insert into public.utility_supply_sources (org_id, property_id, utility_type, source_type, name)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'water', 'solar_pv', 'x')$$,
  '23514', null, 'a water source cannot be solar');
select throws_ok($$insert into public.utility_supply_sources (org_id, property_id, unit_id, utility_type, source_type, name)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000009', 'water', 'borehole', 'x')$$,
  'P0001', 'Unit does not belong to this property', 'a source cannot be scoped to another property''s unit');
select throws_ok($$insert into public.utility_meters (org_id, property_id, utility_type, responsibility_mode, meter_role, measurement_kind)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'water', 'owner_paid', 'main', 'grid_import')$$,
  '23514', null, 'a water meter cannot measure grid import');
select lives_ok($$insert into public.utility_meters (org_id, property_id, utility_type, responsibility_mode, meter_role, measurement_kind, supply_source_id)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'electricity', 'owner_paid', 'check', 'pump_energy', 'f9666666-0000-0000-0000-000000000002')$$,
  'an electricity pump-energy meter may attach to a borehole (water) source');
select throws_ok($$insert into public.utility_meters (org_id, property_id, utility_type, responsibility_mode, meter_role, measurement_kind, supply_source_id)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'electricity', 'owner_paid', 'check', 'consumption', 'f9666666-0000-0000-0000-000000000002')$$,
  'P0001', 'Supply source must belong to this property and match the meter utility', 'a consumption meter cannot attach to a source of the other utility');
select throws_ok($$update public.utility_tariffs set blocks = '[{"upTo":null,"rate":4}]' where id = 'f9888888-0000-0000-0000-000000000001'$$,
  'P0001', null, 'a tariff used by charges cannot have its rates edited');
select lives_ok($$update public.utility_tariffs set effective_to = '2027-06-30' where id = 'f9888888-0000-0000-0000-000000000001'$$,
  'a used tariff can still be closed (effective_to)');
select throws_ok($$update public.utility_charges set total_amount = 1 where id = 'f9999999-0000-0000-0000-000000000001'$$,
  'P0001', null, 'an invoiced charge cannot be changed');
select lives_ok($$update public.utility_charges set total_amount = 311 where id = 'f9999999-0000-0000-0000-000000000002'$$,
  'a draft charge can be recalculated');
select throws_ok($$insert into public.utility_charges (org_id, property_id, unit_id, meter_id, lease_id, utility_type, period_start, period_end, consumption_quality)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000001', 'f9777777-0000-0000-0000-000000000001', 'f9555555-0000-0000-0000-000000000001', 'electricity', '2026-10-01', '2026-11-01', 'complete')$$,
  '23505', null, 'DOUBLE BILLING: a second live consumption charge for the same meter, lease and period is refused');
select lives_ok($$insert into public.utility_charges (org_id, property_id, unit_id, meter_id, lease_id, utility_type, period_start, period_end, consumption_quality, charge_type)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000001', 'f9777777-0000-0000-0000-000000000001', 'f9555555-0000-0000-0000-000000000001', 'electricity', '2026-10-01', '2026-11-01', 'complete', 'fixed')$$,
  'a different charge type (fixed) for the same meter and period is allowed');
select throws_ok($$insert into public.utility_billing_arrangements (org_id, property_id, unit_id, utility_type, arrangement, effective_from)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000001', 'electricity', 'shared_allocation', '2026-01-01')$$,
  '23514', null, 'a shared-allocation arrangement needs an allocation group');
insert into public.utility_billing_arrangements (org_id, property_id, unit_id, utility_type, arrangement, effective_from)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000001', 'electricity', 'metered_recharge', '2026-01-01');
select throws_ok($$insert into public.utility_billing_arrangements (org_id, property_id, unit_id, utility_type, arrangement, effective_from)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9333333-0000-0000-0000-000000000001', 'electricity', 'landlord_paid', '2026-06-01')$$,
  '23505', null, 'only one open arrangement per unit and utility');
select throws_ok($$update public.utility_statements set snapshot = '{"x":1}' where status = 'approved' and lease_id = 'f9555555-0000-0000-0000-000000000001'$$,
  'P0001', null, 'an approved statement cannot be changed');

-- ------------------------------------------------ staff
set local role authenticated;
set local "request.jwt.claim.sub" = 'f9000000-0000-0000-0000-00000000000a';
select is((select count(*) from public.utility_supply_sources), 2::bigint, 'accountant reads own sources');
select lives_ok($$insert into public.utility_source_logs (org_id, property_id, source_id, log_type, occurred_at, quantity, quantity_unit, cost_amount)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9666666-0000-0000-0000-000000000002', 'maintenance', now(), 1, 'hours', 850)$$,
  'accountant logs a borehole maintenance cost');
select throws_ok($$insert into public.utility_source_readings (org_id, property_id, source_id, metric, read_at, value, source)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9666666-0000-0000-0000-000000000002', 'tank_level_pct', now(), 50, 'manual')$$,
  '42501', null, 'level readings are server-written only');
select throws_ok($$insert into public.utility_credits (org_id, property_id, lease_id, amount, remaining, reason)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'f9555555-0000-0000-0000-000000000001', 10, 10, 'test')$$,
  '42501', null, 'credits are server-written only');
select is((select count(*) from public.utility_statements), 3::bigint, 'staff see all statements of the property');

set local "request.jwt.claim.sub" = 'f9000000-0000-0000-0000-00000000000b';
select throws_ok($$insert into public.utility_supply_sources (org_id, property_id, utility_type, source_type, name)
  values ('f9111111-0000-0000-0000-000000000001', 'f9222222-0000-0000-0000-000000000001', 'electricity', 'generator', 'Genset')$$,
  '42501', null, 'viewer cannot add a source');

-- ------------------------------------------------ tenants
set local "request.jwt.claim.sub" = 'f9000000-0000-0000-0000-00000000000c';
select is((select count(*) from public.utility_charges), 1::bigint, 'TENANT: sees only their own INVOICED charge (not the draft)');
select is((select count(*) from public.utility_statements), 1::bigint, 'TENANT: sees only their own APPROVED statement');
select is((select count(*) from public.utility_supply_sources), 0::bigint, 'TENANT: sees no landlord source configuration');
set local "request.jwt.claim.sub" = 'f9000000-0000-0000-0000-00000000000d';
select is((select count(*) from public.utility_charges), 0::bigint, 'TENANT ISOLATION: another tenant sees none of tenant one''s charges');
select is((select count(*) from public.utility_statements), 1::bigint, 'TENANT ISOLATION: tenant two sees only their own statement');

-- ------------------------------------------------ other org
set local "request.jwt.claim.sub" = 'f9000000-0000-0000-0000-00000000000e';
select is((select count(*) from public.utility_supply_sources) + (select count(*) from public.utility_billing_arrangements) + (select count(*) from public.utility_statements), 0::bigint,
  'ORG ISOLATION: another org sees no sources, arrangements or statements');

select * from finish();
rollback;
