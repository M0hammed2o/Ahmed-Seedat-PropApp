-- Tests for migrations 20260101000179 (utilities hardening) and 20260101000180 (portfolio intelligence candidates).
-- docs/UTILITIES_SECURITY_FINDINGS.md / docs/UTILITIES_FINANCIAL_VALIDATION.md.

begin;
select plan(17);

insert into auth.users (id, email) values
  ('fa000000-0000-0000-0000-00000000000a', 'uh-attacker@test.propertyvault.example'),
  ('fa000000-0000-0000-0000-00000000000b', 'uh-victim@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type) values
  ('fa111111-0000-0000-0000-000000000001', 'UH Attacker Org', 'agency'),
  ('fa111111-0000-0000-0000-000000000002', 'UH Victim Org', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode) values
  ('fa111111-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-00000000000a', 'principal', 'active', now(), 'all'),
  ('fa111111-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-00000000000b', 'principal', 'active', now(), 'all');

insert into public.properties (id, org_id, nickname, address_line1, city, province, postal_code) values
  ('fa222222-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000001', 'UH Own', '1', 'Durban', 'KwaZulu-Natal', '4001'),
  ('fa222222-0000-0000-0000-000000000002', 'fa111111-0000-0000-0000-000000000002', 'UH Victim', '2', 'Durban', 'KwaZulu-Natal', '4001');

-- The attacker holds an OWNER grant on the victim org's property (portal owner), and is principal of their own org.
insert into public.property_access (property_id, user_id, property_role) values
  ('fa222222-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-00000000000a', 'owner');

insert into public.units (id, property_id, org_id, unit_label) values
  ('fa333333-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000002', 'fa111111-0000-0000-0000-000000000002', 'V1');

insert into public.utility_meters (id, org_id, property_id, unit_id, utility_type, responsibility_mode, meter_role, measurement_kind) values
  ('fa444444-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000002', 'fa222222-0000-0000-0000-000000000002', 'fa333333-0000-0000-0000-000000000001', 'electricity', 'owner_paid', 'submeter', 'consumption'),
  ('fa444444-0000-0000-0000-000000000002', 'fa111111-0000-0000-0000-000000000002', 'fa222222-0000-0000-0000-000000000002', null, 'electricity', 'owner_paid', 'check', 'generation');

-- ------------------------------------------------ SEC-01: property must belong to the row's org
select throws_ok($$insert into public.utility_meters (org_id, property_id, utility_type, responsibility_mode, meter_role)
  values ('fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000002', 'water', 'owner_paid', 'main')$$,
  'P0001', 'Property does not belong to this organisation', 'a meter cannot be filed under another org''s property (any write path)');
select throws_ok($$insert into public.utility_tariffs (org_id, property_id, utility_type, name, blocks, effective_from)
  values ('fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000002', 'water', 'x', '[{"upTo":null,"rate":1}]', '2026-01-01')$$,
  'P0001', 'Property does not belong to this organisation', 'a tariff cannot be injected into another org''s property');
select throws_ok($$insert into public.utility_responsibility_settings (org_id, property_id, utility_type, responsibility_mode)
  values ('fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000002', 'water', 'owner_paid')$$,
  'P0001', 'Property does not belong to this organisation', 'legacy responsibility settings are bound to the property''s org');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(public.can_write_property_utilities('fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000002'), false,
  'own-org principal + owner grant elsewhere cannot write utilities with a mismatched org/property pair');
select is(public.can_read_property_utilities('fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000002'), false,
  'nor read with a mismatched pair');
select throws_ok($$insert into public.utility_meters (org_id, property_id, utility_type, responsibility_mode, meter_role)
  values ('fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000002', 'electricity', 'owner_paid', 'main')$$,
  null, null, 'RLS + trigger: the attacker cannot plant a meter on the victim property');
reset role;

-- ------------------------------------------------ shared meters only on consumption meters
select throws_ok($$insert into public.utility_allocation_groups (org_id, property_id, meter_id, name, method)
  values ('fa111111-0000-0000-0000-000000000002', 'fa222222-0000-0000-0000-000000000002', 'fa444444-0000-0000-0000-000000000002', 'x', 'equal')$$,
  'P0001', 'Only a consumption meter can be shared between units', 'a solar generation meter can never be split across tenants');

-- ------------------------------------------------ FIN: no overlapping live charges
insert into public.utility_charges (org_id, property_id, unit_id, meter_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption_quality, total_amount) values
  ('fa111111-0000-0000-0000-000000000002', 'fa222222-0000-0000-0000-000000000002', 'fa333333-0000-0000-0000-000000000001', 'fa444444-0000-0000-0000-000000000001', 'electricity', 'consumption', '2026-10-01', '2026-11-01', '2026-10-01', '2026-11-01', 'complete', 300);
select throws_ok($$insert into public.utility_charges (org_id, property_id, unit_id, meter_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption_quality, total_amount)
  values ('fa111111-0000-0000-0000-000000000002', 'fa222222-0000-0000-0000-000000000002', 'fa333333-0000-0000-0000-000000000001', null, 'electricity', 'consumption', '2026-10-01', '2026-11-01', '2026-10-16', '2026-11-01', 'complete', 100)$$,
  '23P01', null, 'an overlapping live charge for the same unit/utility/type is refused (replacement or arrangement change)');
select lives_ok($$insert into public.utility_charges (org_id, property_id, unit_id, meter_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption_quality, total_amount)
  values ('fa111111-0000-0000-0000-000000000002', 'fa222222-0000-0000-0000-000000000002', 'fa333333-0000-0000-0000-000000000001', 'fa444444-0000-0000-0000-000000000001', 'electricity', 'consumption', '2026-11-01', '2026-12-01', '2026-11-01', '2026-12-01', 'complete', 100)$$,
  'the next month is not an overlap');
select lives_ok($$insert into public.utility_charges (org_id, property_id, unit_id, meter_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption_quality, total_amount)
  values ('fa111111-0000-0000-0000-000000000002', 'fa222222-0000-0000-0000-000000000002', 'fa333333-0000-0000-0000-000000000001', null, 'electricity', 'allowance_fee', '2026-10-01', '2026-11-01', '2026-10-01', '2026-11-01', 'complete', 100)$$,
  'a different charge type (fixed allowance fee) for the same days is allowed');
update public.utility_charges set status = 'void' where period_start = '2026-10-01' and charge_type = 'consumption' and unit_id = 'fa333333-0000-0000-0000-000000000001';
select lives_ok($$insert into public.utility_charges (org_id, property_id, unit_id, meter_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption_quality, total_amount)
  values ('fa111111-0000-0000-0000-000000000002', 'fa222222-0000-0000-0000-000000000002', 'fa333333-0000-0000-0000-000000000001', 'fa444444-0000-0000-0000-000000000001', 'electricity', 'consumption', '2026-10-01', '2026-11-01', '2026-10-01', '2026-10-16', 'complete', 150)$$,
  'after voiding, the period can be recalculated (and split at a tariff change: two pieces, same meter)');
select lives_ok($$insert into public.utility_charges (org_id, property_id, unit_id, meter_id, utility_type, charge_type, period_start, period_end, segment_start, segment_end, consumption_quality, total_amount)
  values ('fa111111-0000-0000-0000-000000000002', 'fa222222-0000-0000-0000-000000000002', 'fa333333-0000-0000-0000-000000000001', 'fa444444-0000-0000-0000-000000000001', 'electricity', 'consumption', '2026-10-01', '2026-11-01', '2026-10-16', '2026-11-01', 'complete', 150)$$,
  'second tariff piece of the same period and meter');

-- ------------------------------------------------ FIN-06: voiding an invoice releases its utility charges
insert into public.tenants (id, org_id, full_name, status) values ('fa555555-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000002', 'UH T', 'active');
insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status) values ('fa666666-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000002', 'fa333333-0000-0000-0000-000000000001', '2026-01-01', 1000, 'active');
insert into public.invoices (id, org_id, lease_id, tenant_id, period, amount, status, source) values
  ('fa777777-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000002', 'fa666666-0000-0000-0000-000000000001', 'fa555555-0000-0000-0000-000000000001', '2026-11-15', 100, 'draft', 'manual');
update public.utility_charges set status = 'invoiced', invoice_id = 'fa777777-0000-0000-0000-000000000001'
 where period_start = '2026-11-01' and unit_id = 'fa333333-0000-0000-0000-000000000001';
delete from public.invoices where id = 'fa777777-0000-0000-0000-000000000001';
select is((select status from public.utility_charges where period_start = '2026-11-01' and unit_id = 'fa333333-0000-0000-0000-000000000001'), 'approved',
  'deleting a draft invoice returns its utility charges to approved (not stuck as invoiced)');

-- ------------------------------------------------ SEC-04: reading evidence must be the meter property's document
select throws_ok($$insert into public.documents (id, org_id, property_id, storage_path, original_file_name, mime_type, file_size_bytes)
  values ('fa888888-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000001/x.jpg', 'x.jpg', 'image/jpeg', 10);
  insert into public.utility_readings (org_id, meter_id, period_month, reading_date, reading_value, unit_of_measure, source, document_id)
  values ('fa111111-0000-0000-0000-000000000002', 'fa444444-0000-0000-0000-000000000001', '2026-10-01', '2026-10-31', 10, 'kWh', 'manual', 'fa888888-0000-0000-0000-000000000001')$$,
  null, null, 'a reading cannot cite another organisation''s photo as evidence');

-- ------------------------------------------------ 180: candidate organisations
select ok(not exists (select 1 from public.portfolio_intelligence_candidate_orgs() c where c.org_id = 'fa111111-0000-0000-0000-000000000001'),
  'an organisation with no rule input is not a portfolio-intelligence candidate');
select ok(exists (select 1 from public.portfolio_intelligence_candidate_orgs() c where c.org_id = 'fa111111-0000-0000-0000-000000000002' and c.has_meters),
  'an organisation with an active meter is a candidate, flagged has_meters');
select throws_ok($$set local role authenticated; select * from public.portfolio_intelligence_candidate_orgs()$$,
  '42501', null, 'the candidate list (every org id) is not callable by signed-in users');

select * from finish();
rollback;
