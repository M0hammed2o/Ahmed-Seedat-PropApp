-- Tests for migration 20260101000181 (utilities Phase 3) plus tenant write-denial on utility billing tables.
-- docs/UTILITIES_PHASE3_COMPLETION_REPORT.md.

begin;
select plan(21);

insert into auth.users (id, email) values
  ('fb000000-0000-0000-0000-00000000000a', 'p3-manager@test.propertyvault.example'),
  ('fb000000-0000-0000-0000-00000000000c', 'p3-tenant@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type) values
  ('fb111111-0000-0000-0000-000000000001', 'P3 Org', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode) values
  ('fb111111-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000a', 'principal', 'active', now(), 'all');
insert into public.properties (id, org_id, nickname, address_line1, city, province, postal_code) values
  ('fb222222-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'P3 Court', '1', 'Durban', 'KwaZulu-Natal', '4001');
insert into public.units (id, property_id, org_id, unit_label) values
  ('fb333333-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'Flat 1');
insert into public.tenants (id, org_id, full_name, status, user_id) values
  ('fb444444-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'P3 Tenant', 'active', 'fb000000-0000-0000-0000-00000000000c');
insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status) values
  ('fb555555-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', '2026-01-01', 5000, 'active');
insert into public.lease_tenants (lease_id, tenant_id, is_primary) values
  ('fb555555-0000-0000-0000-000000000001', 'fb444444-0000-0000-0000-000000000001', true);
insert into public.utility_meters (id, org_id, property_id, unit_id, utility_type, responsibility_mode, meter_role, measurement_kind, multiplier, value_offset) values
  ('fb666666-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', 'electricity', 'owner_paid', 'submeter', 'consumption', 1, 0);
insert into public.utility_tariffs (id, org_id, property_id, utility_type, name, blocks, effective_from) values
  ('fb777777-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'electricity', 'FICTIONAL R3', '[{"upTo":null,"rate":3}]', '2026-01-01');
insert into public.utility_billing_arrangements (id, org_id, property_id, unit_id, utility_type, arrangement, effective_from) values
  ('fb888888-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', 'electricity', 'metered_recharge', '2026-01-01');
insert into public.utility_charges (id, org_id, property_id, unit_id, meter_id, lease_id, tenant_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption_quality, total_amount, status) values
  ('fb999999-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', 'fb666666-0000-0000-0000-000000000001',
   'fb555555-0000-0000-0000-000000000001', 'fb444444-0000-0000-0000-000000000001', 'electricity', 'consumption', '2026-09-01', '2026-10-01', '2026-09-01', '2026-10-01', 'complete', 300, 'invoiced');

-- ------------------------------------------------ tenants never set prices or bills (brief: tariffs by landlords/managers only)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fb000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select throws_ok($$insert into public.utility_tariffs (org_id, property_id, utility_type, name, blocks, effective_from)
  values ('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'electricity', 'cheap', '[{"upTo":null,"rate":0.01}]', '2026-01-01')$$,
  '42501', null, 'a tenant cannot create a tariff');
update public.utility_tariffs set blocks = '[{"upTo":null,"rate":0.01}]' where id = 'fb777777-0000-0000-0000-000000000001';
select throws_ok($$insert into public.utility_billing_arrangements (org_id, property_id, unit_id, utility_type, arrangement, effective_from)
  values ('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', 'electricity', 'landlord_paid', '2026-01-01')$$,
  '42501', null, 'a tenant cannot change their billing arrangement');
update public.utility_billing_arrangements set arrangement = 'landlord_paid' where id = 'fb888888-0000-0000-0000-000000000001';
select throws_ok($$insert into public.utility_charges (org_id, property_id, unit_id, utility_type, charge_type, period_start, period_end, consumption_quality, total_amount)
  values ('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', 'electricity', 'consumption', '2026-11-01', '2026-12-01', 'complete', 1)$$,
  '42501', null, 'a tenant cannot create a charge');
update public.utility_charges set total_amount = 0, status = 'void' where id = 'fb999999-0000-0000-0000-000000000001';
select throws_ok($$insert into public.utility_credits (org_id, property_id, lease_id, amount, remaining, reason)
  values ('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb555555-0000-0000-0000-000000000001', 300, 300, 'self-credit')$$,
  '42501', null, 'a tenant cannot credit themselves');
select is(public.can_write_property_utilities('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001'), false,
  'a tenant has no utilities write permission on their own property');
reset role;
select is((select blocks::text from public.utility_tariffs where id = 'fb777777-0000-0000-0000-000000000001'), '[{"rate": 3, "upTo": null}]', 'the tenant''s tariff update changed nothing');
select is((select arrangement from public.utility_billing_arrangements where id = 'fb888888-0000-0000-0000-000000000001'), 'metered_recharge', 'the tenant''s arrangement update changed nothing');
select is((select (status, total_amount)::text from public.utility_charges where id = 'fb999999-0000-0000-0000-000000000001'), '(invoiced,300.00)', 'the tenant''s charge update changed nothing');

-- ------------------------------------------------ Phase 3 functions are service-role only
select is(has_function_privilege('authenticated', 'public.ingest_telemetry_batch(jsonb)', 'execute'), false, 'ingest_telemetry_batch: not callable by signed-in users');
select is(has_function_privilege('anon', 'public.ingest_telemetry_batch(jsonb)', 'execute'), false, 'ingest_telemetry_batch: not callable anonymously');
select is(has_function_privilege('authenticated', 'public.downsample_meter_telemetry(timestamptz, integer)', 'execute'), false, 'downsample_meter_telemetry: not callable by signed-in users');
select is(has_function_privilege('service_role', 'public.downsample_meter_telemetry(timestamptz, integer)', 'execute'), true, 'downsample_meter_telemetry: callable by the service role');

-- ------------------------------------------------ batch ingestion is idempotent
select is((select count(*)::int from public.ingest_telemetry_batch(
  '[{"org_id":"fb111111-0000-0000-0000-000000000001","property_id":"fb222222-0000-0000-0000-000000000001","meter_id":"fb666666-0000-0000-0000-000000000001","read_at":"2026-08-01T00:00:00+02:00","raw_value":100,"multiplier":1,"value":100,"source":"device","status":"valid"}]'::jsonb)),
  1, 'a new reading is inserted');
select is((select count(*)::int from public.ingest_telemetry_batch(
  '[{"org_id":"fb111111-0000-0000-0000-000000000001","property_id":"fb222222-0000-0000-0000-000000000001","meter_id":"fb666666-0000-0000-0000-000000000001","read_at":"2026-08-01T00:00:00+02:00","raw_value":100,"multiplier":1,"value":100,"source":"device","status":"valid"}]'::jsonb)),
  0, 'the same reading replayed is ignored');

-- ------------------------------------------------ retention never touches young telemetry
select throws_ok($$select public.downsample_meter_telemetry(now() - interval '30 days', 10)$$, 'P0001', null, 'a cutoff younger than 400 days is refused');

-- ------------------------------------------------ TD-54: monthly readings appear in the telemetry series
insert into public.utility_readings (id, org_id, meter_id, period_month, reading_date, reading_value, unit_of_measure, recorded_by) values
  ('fbaaaaaa-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb666666-0000-0000-0000-000000000001', '2026-09-01', '2026-09-30', 450, 'kWh', 'fb000000-0000-0000-0000-00000000000a');
select is((select (value, source, verification_status, read_at = '2026-09-30 10:00:00+00')::text from public.meter_telemetry_readings
  where external_event_id = 'utility_reading:fbaaaaaa-0000-0000-0000-000000000001'),
  '(450.0000,manual,unverified,t)', 'a captured monthly reading is mirrored as an unverified manual reading at 12:00 SAST');
delete from public.utility_readings where id = 'fbaaaaaa-0000-0000-0000-000000000001';
select is((select count(*)::int from public.meter_telemetry_readings where external_event_id = 'utility_reading:fbaaaaaa-0000-0000-0000-000000000001'),
  0, 'deleting (replacing) the reading removes its mirror');

-- ------------------------------------------------ estimates / true-up
select lives_ok($$insert into public.utility_charges (org_id, property_id, unit_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption_quality, total_amount)
  values ('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', 'electricity', 'true_up', '2026-09-01', '2026-10-01', '2026-09-01', '2026-10-01', 'complete', 30)$$,
  'a true_up charge type exists');
select throws_ok($$insert into public.utility_charges (org_id, property_id, unit_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption_quality, total_amount)
  values ('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', 'electricity', 'true_up', '2026-09-01', '2026-10-01', '2026-09-01', '2026-10-01', 'complete', 30)$$,
  '23505', null, 'only one live true-up per unit, utility and segment');
insert into public.utility_credits (org_id, property_id, lease_id, source_charge_id, amount, remaining, reason) values
  ('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb555555-0000-0000-0000-000000000001', 'fb999999-0000-0000-0000-000000000001', 20, 20, 'True-up: actual 90 vs estimated 100');
select throws_ok($$insert into public.utility_credits (org_id, property_id, lease_id, source_charge_id, amount, remaining, reason)
  values ('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb555555-0000-0000-0000-000000000001', 'fb999999-0000-0000-0000-000000000001', 20, 20, 'True-up: actual 90 vs estimated 100')$$,
  '23505', null, 'only one true-up credit per estimated charge');

-- ------------------------------------------------ migration 182: Smart Utilities is off unless switched on
insert into public.organizations (id, legal_name, org_type) values ('fb111111-0000-0000-0000-000000000009', 'P3 New Org', 'agency');
select is((select utilities_enabled from public.organizations where id = 'fb111111-0000-0000-0000-000000000009'), false,
  'a newly created organisation has Smart Utilities switched off');

select * from finish();
rollback;
