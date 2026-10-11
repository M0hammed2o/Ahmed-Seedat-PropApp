-- Tests for migration 20260101000175 (Smart Utility Monitoring, Phase 1): tenant isolation,
-- property-level access (incl. the migration-163 gap fix), meter ownership/binding integrity,
-- duplicate prevention, hashed-token column privacy, and server-only write paths.

begin;
select plan(34);

-- Users: A = accountant ('all' mode), V = viewer, S = accountant in 'selected' mode with NO grant on
-- the property, W = portal owner (property_access 'owner', not an org member), O = other org.
insert into auth.users (id, email) values
  ('d7000000-0000-0000-0000-00000000000a', 'su-accountant@test.propertyvault.example'),
  ('d7000000-0000-0000-0000-00000000000b', 'su-viewer@test.propertyvault.example'),
  ('d7000000-0000-0000-0000-00000000000c', 'su-selected@test.propertyvault.example'),
  ('d7000000-0000-0000-0000-00000000000d', 'su-owner@test.propertyvault.example'),
  ('d7000000-0000-0000-0000-00000000000e', 'su-other@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type) values
  ('d7111111-0000-0000-0000-000000000001', 'SU Org', 'agency'),
  ('d7111111-0000-0000-0000-000000000002', 'SU Other Org', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode) values
  ('d7111111-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-00000000000a', 'accountant', 'active', now(), 'all'),
  ('d7111111-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-00000000000b', 'viewer', 'active', now(), 'all'),
  ('d7111111-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-00000000000c', 'accountant', 'active', now(), 'selected'),
  ('d7111111-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-00000000000e', 'accountant', 'active', now(), 'all');

insert into public.properties (id, org_id, owner_user_id, nickname, address_line1, city, province, postal_code) values
  ('d7222222-0000-0000-0000-000000000001', 'd7111111-0000-0000-0000-000000000001', null, 'SU Block', '1 Meter St', 'Durban', 'KwaZulu-Natal', '4001'),
  ('d7222222-0000-0000-0000-000000000002', 'd7111111-0000-0000-0000-000000000002', null, 'SU Other', '2 Meter St', 'Durban', 'KwaZulu-Natal', '4001');

insert into public.property_access (property_id, user_id, property_role, granted_by) values
  ('d7222222-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-00000000000d', 'owner', 'd7000000-0000-0000-0000-00000000000a');

insert into public.units (id, property_id, org_id, unit_label, status) values
  ('d7333333-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'd7111111-0000-0000-0000-000000000001', 'Unit A', 'occupied'),
  ('d7333333-0000-0000-0000-000000000002', 'd7222222-0000-0000-0000-000000000001', 'd7111111-0000-0000-0000-000000000001', 'Unit B', 'vacant');

insert into public.meter_integrations (id, org_id, property_id, provider, name, token_prefix, token_hash) values
  ('d7444444-0000-0000-0000-000000000001', 'd7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001',
   'milesight_lorawan', 'Block gateway', 'abcdefabcdef', repeat('a', 64)),
  ('d7444444-0000-0000-0000-000000000002', 'd7111111-0000-0000-0000-000000000002', 'd7222222-0000-0000-0000-000000000002',
   'generic_json', 'Other gateway', 'bbbbbbbbbbbb', repeat('b', 64));

insert into public.utility_meters (id, org_id, property_id, unit_id, utility_type, meter_number, responsibility_mode, meter_role, ownership) values
  ('d7555555-0000-0000-0000-000000000001', 'd7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', null,
   'water', 'MUNI-001', 'owner_paid', 'main', 'municipal');

insert into public.utility_meters (id, org_id, property_id, unit_id, utility_type, meter_number, responsibility_mode, meter_role, parent_meter_id,
                                   connectivity, integration_id, external_device_id, multiplier, register_digits) values
  ('d7555555-0000-0000-0000-000000000002', 'd7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001',
   'd7333333-0000-0000-0000-000000000001', 'water', 'SUB-A', 'tenant_paid_direct', 'submeter', 'd7555555-0000-0000-0000-000000000001',
   'lorawan', 'd7444444-0000-0000-0000-000000000001', '24E124136B000001', 0.5, 8);

insert into public.meter_telemetry_readings (org_id, property_id, meter_id, read_at, raw_value, multiplier, value, source, integration_id, external_event_id) values
  ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'd7555555-0000-0000-0000-000000000002',
   '2026-10-01 00:00+02', 1000, 0.5, 500, 'device', 'd7444444-0000-0000-0000-000000000001', 'evt-1');

-- ---------------------------------------------------------------- integrity (as postgres)
select is(
  (select meter_role from public.utility_meters where id = 'd7555555-0000-0000-0000-000000000001'),
  'main', 'property-level meter stores role main');

select throws_ok(
  $$insert into public.meter_telemetry_readings (org_id, property_id, meter_id, read_at, raw_value, multiplier, value, source)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'd7555555-0000-0000-0000-000000000002',
            '2026-10-01 00:00+02', 1001, 0.5, 500.5, 'device')$$,
  '23505', null, 'a second reading at the same timestamp for the same meter is rejected (duplicate detection)');

select throws_ok(
  $$insert into public.meter_telemetry_readings (org_id, property_id, meter_id, read_at, raw_value, multiplier, value, source, integration_id, external_event_id)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'd7555555-0000-0000-0000-000000000002',
            '2026-10-01 01:00+02', 1002, 0.5, 501, 'device', 'd7444444-0000-0000-0000-000000000001', 'evt-1')$$,
  '23505', null, 'a replayed gateway event id is rejected (idempotent ingestion)');

select throws_ok(
  $$insert into public.utility_meters (org_id, property_id, unit_id, utility_type, responsibility_mode, meter_role, integration_id, external_device_id)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'd7333333-0000-0000-0000-000000000002',
            'water', 'tenant_paid_direct', 'submeter', 'd7444444-0000-0000-0000-000000000001', '24E124136B000001')$$,
  '23505', null, 'one device/channel can feed only one active meter');

select throws_ok(
  $$insert into public.utility_meters (org_id, property_id, utility_type, responsibility_mode, meter_role, integration_id, external_device_id)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001',
            'water', 'owner_paid', 'check', 'd7444444-0000-0000-0000-000000000002', 'X1')$$,
  'P0001', 'Integration does not belong to this property', 'a meter cannot bind to another org''s integration');

select throws_ok(
  $$insert into public.utility_meters (org_id, property_id, unit_id, utility_type, responsibility_mode, meter_role, parent_meter_id)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'd7333333-0000-0000-0000-000000000002',
            'electricity', 'tenant_paid_direct', 'submeter', 'd7555555-0000-0000-0000-000000000001')$$,
  'P0001', 'Parent meter must be a main/check meter of the same property and utility type',
  'an electricity submeter cannot hang under a water main meter');

insert into public.property_buildings (id, org_id, property_id, name) values
  ('d7666666-0000-0000-0000-000000000002', 'd7111111-0000-0000-0000-000000000002', 'd7222222-0000-0000-0000-000000000002', 'Other Block');
select throws_ok(
  $$update public.units set building_id = 'd7666666-0000-0000-0000-000000000002'
    where id = 'd7333333-0000-0000-0000-000000000001'$$,
  'P0001', 'Building does not belong to this property', 'a unit cannot be assigned to another property''s building');

-- Replacement keeps history: decommission + new meter pointing at the old one.
update public.utility_meters set active = false, decommissioned_at = now()
  where id = 'd7555555-0000-0000-0000-000000000002';
insert into public.utility_meters (id, org_id, property_id, unit_id, utility_type, responsibility_mode, meter_role, parent_meter_id,
                                   integration_id, external_device_id, replaced_meter_id) values
  ('d7555555-0000-0000-0000-000000000003', 'd7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001',
   'd7333333-0000-0000-0000-000000000001', 'water', 'tenant_paid_direct', 'submeter', 'd7555555-0000-0000-0000-000000000001',
   'd7444444-0000-0000-0000-000000000001', '24E124136B000001', 'd7555555-0000-0000-0000-000000000002');
select is(
  (select count(*) from public.meter_telemetry_readings where meter_id = 'd7555555-0000-0000-0000-000000000002'),
  1::bigint, 'replacing a meter keeps the old meter''s readings, and the device can rebind to the new active meter');

-- ---------------------------------------------------------------- accountant (all mode)
set local role authenticated;
set local "request.jwt.claim.sub" = 'd7000000-0000-0000-0000-00000000000a';

select is((select count(*) from public.utility_meters where property_id = 'd7222222-0000-0000-0000-000000000001'),
  3::bigint, 'accountant with access reads all three meters');
select is((select count(*) from public.meter_telemetry_readings), 1::bigint, 'accountant reads own-org telemetry only');
select throws_ok(
  $$select token_hash from public.meter_integrations$$,
  '42501', null, 'token hashes are not readable by API clients, even with property access');
select is((select count(*) from public.meter_integrations), 1::bigint, 'accountant sees only own-org integrations (non-secret columns)');
select throws_ok(
  $$insert into public.meter_telemetry_readings (org_id, property_id, meter_id, read_at, raw_value, multiplier, value, source)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'd7555555-0000-0000-0000-000000000003',
            '2026-10-02 00:00+02', 5, 1, 5, 'manual')$$,
  '42501', null, 'clients cannot insert telemetry directly (server-only write path)');
select throws_ok(
  $$insert into public.municipal_submissions (org_id, property_id, period_start, period_end, mode, report)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', '2026-09-25', '2026-10-25', 'manual', '{}')$$,
  '42501', null, 'clients cannot insert submissions directly');
select lives_ok(
  $$insert into public.municipal_submission_recipients (org_id, property_id, email, recipient_type)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'agent@example.com', 'managing_agent')$$,
  'accountant can add a submission recipient');
select lives_ok(
  $$insert into public.municipal_submission_settings (property_id, org_id, municipality_code, mode)
    values ('d7222222-0000-0000-0000-000000000001', 'd7111111-0000-0000-0000-000000000001', 'ethekwini', 'approval_required')$$,
  'accountant can configure municipal submission settings');
select lives_ok(
  $$insert into public.property_buildings (org_id, property_id, name)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'Block A')$$,
  'accountant can add a building');
select isnt(
  public.record_utility_reading('d7555555-0000-0000-0000-000000000001', '2026-10-01', '2026-10-01', 1234, 'L'),
  null, 'record_utility_reading still works for an accountant with property access');
update public.meter_telemetry_readings set value = 0; -- silently matches no rows (no update policy)
select lives_ok($$select 1$$, 'accountant update against telemetry runs (checked as postgres below)');

-- ---------------------------------------------------------------- viewer
set local "request.jwt.claim.sub" = 'd7000000-0000-0000-0000-00000000000b';
select is((select count(*) from public.utility_meters), 3::bigint, 'viewer can read meters');
select is((select count(*) from public.municipal_submission_recipients), 1::bigint, 'viewer can read recipients');
select throws_ok(
  $$insert into public.municipal_submission_recipients (org_id, property_id, email, recipient_type)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'x@example.com', 'custom')$$,
  '42501', null, 'viewer cannot add a recipient');
select throws_ok(
  $$insert into public.utility_alert_settings (property_id, org_id) values ('d7222222-0000-0000-0000-000000000001', 'd7111111-0000-0000-0000-000000000001')$$,
  '42501', null, 'viewer cannot change alert thresholds');

-- ---------------------------------------------------------------- selected-mode accountant, no grant (gap fix)
set local "request.jwt.claim.sub" = 'd7000000-0000-0000-0000-00000000000c';
select is((select count(*) from public.utility_meters), 0::bigint,
  'GAP FIX: a selected-mode staff member without a grant can no longer read the property''s meters');
select is((select count(*) from public.utility_readings), 0::bigint, 'GAP FIX: ... nor its monthly readings');
select throws_ok(
  $$select public.record_utility_reading('d7555555-0000-0000-0000-000000000001', '2026-11-01', '2026-11-01', 1300, 'L')$$,
  'P0001', 'Caller does not have accountant+ rights on this property',
  'GAP FIX: record_utility_reading refuses an accountant without property access');

-- ---------------------------------------------------------------- portal owner (not an org member)
set local "request.jwt.claim.sub" = 'd7000000-0000-0000-0000-00000000000d';
select is((select count(*) from public.utility_meters), 3::bigint, 'portal owner can now read their property''s meters');
-- 2 = the device reading + the monthly reading recorded above, mirrored into telemetry by migration 181 (TD-54).
select is((select count(*) from public.meter_telemetry_readings), 2::bigint, 'portal owner can read telemetry for their property');
select throws_ok(
  $$insert into public.municipal_submission_recipients (org_id, property_id, email, recipient_type)
    values ('d7111111-0000-0000-0000-000000000001', 'd7222222-0000-0000-0000-000000000001', 'owner@example.com', 'custom')$$,
  '42501', null, 'portal owner (not an org member) cannot change submission recipients');

-- ---------------------------------------------------------------- other org
set local "request.jwt.claim.sub" = 'd7000000-0000-0000-0000-00000000000e';
select is((select count(*) from public.utility_meters where org_id = 'd7111111-0000-0000-0000-000000000001'), 0::bigint,
  'TENANT ISOLATION: other org sees none of this org''s meters');
select is((select count(*) from public.meter_telemetry_readings), 0::bigint, 'TENANT ISOLATION: ... nor telemetry');
select is((select count(*) from public.municipal_submission_recipients), 0::bigint, 'TENANT ISOLATION: ... nor recipients');
select is((select count(*) from public.meter_integrations), 1::bigint, 'TENANT ISOLATION: other org sees only its own integration');

reset role;
select is((select value from public.meter_telemetry_readings where external_event_id = 'evt-1'), 500::numeric,
  'telemetry is append-only: the accountant''s UPDATE changed nothing');

select * from finish();
rollback;
