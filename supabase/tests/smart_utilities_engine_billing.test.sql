-- Tests for migration 20260101000176 (Smart Utilities engine, evidence, reporting, billing).

begin;
select plan(20);

insert into auth.users (id, email) values
  ('e8000000-0000-0000-0000-00000000000a', 'su2-accountant@test.propertyvault.example'),
  ('e8000000-0000-0000-0000-00000000000b', 'su2-viewer@test.propertyvault.example'),
  ('e8000000-0000-0000-0000-00000000000e', 'su2-other@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type) values
  ('e8111111-0000-0000-0000-000000000001', 'SU2 Org', 'agency'),
  ('e8111111-0000-0000-0000-000000000002', 'SU2 Other', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode) values
  ('e8111111-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-00000000000a', 'accountant', 'active', now(), 'all'),
  ('e8111111-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-00000000000b', 'viewer', 'active', now(), 'all'),
  ('e8111111-0000-0000-0000-000000000002', 'e8000000-0000-0000-0000-00000000000e', 'accountant', 'active', now(), 'all');

insert into public.properties (id, org_id, nickname, address_line1, city, province, postal_code) values
  ('e8222222-0000-0000-0000-000000000001', 'e8111111-0000-0000-0000-000000000001', 'SU2', '1 St', 'Durban', 'KwaZulu-Natal', '4001'),
  ('e8222222-0000-0000-0000-000000000002', 'e8111111-0000-0000-0000-000000000002', 'SU2 Other', '2 St', 'Durban', 'KwaZulu-Natal', '4001');

insert into public.meter_integrations (id, org_id, property_id, provider, name, token_prefix, token_hash, sync_mode, credentials_ciphertext, provider_config)
values ('e8444444-0000-0000-0000-000000000001', 'e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001',
        'thingsboard', 'TB', 'tbtbtbtbtbtb', repeat('c', 64), 'poll', 'v1:aaa:bbb:ccc', '{"baseUrl":"https://tb.example.com"}');

insert into public.utility_meters (id, org_id, property_id, utility_type, responsibility_mode, meter_role, ownership)
values ('e8555555-0000-0000-0000-000000000001', 'e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'water', 'owner_paid', 'main', 'municipal');

-- ------------------------------------------------ constraints (as postgres)
select lives_ok(
  $$insert into public.meter_integrations (org_id, property_id, provider, name, token_prefix, token_hash)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'chirpstack_v4', 'CS', 'cscscscscscs', repeat('d', 64))$$,
  'new providers (chirpstack_v4) are accepted');
select throws_ok(
  $$insert into public.meter_integrations (org_id, property_id, provider, name, token_prefix, token_hash)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'unknown_vendor', 'X', 'xxxxxxxxxxxx', repeat('e', 64))$$,
  '23514', null, 'unknown providers are rejected');
select throws_ok(
  $$insert into public.municipal_submission_settings (property_id, org_id, schedule_enabled)
    values ('e8222222-0000-0000-0000-000000000001', 'e8111111-0000-0000-0000-000000000001', true)$$,
  '23514', null, 'scheduled sending cannot be enabled without an approved template');
select lives_ok(
  $$insert into public.municipal_submission_settings (property_id, org_id, schedule_enabled, template_hash, template_approved_at)
    values ('e8222222-0000-0000-0000-000000000001', 'e8111111-0000-0000-0000-000000000001', true, repeat('f', 64), now())$$,
  'scheduled sending is allowed once a template is approved');
select throws_ok(
  $$update public.municipal_submission_settings set cc_emails = array['a@x.com','b@x.com','c@x.com','d@x.com','e@x.com','f@x.com']
    where property_id = 'e8222222-0000-0000-0000-000000000001'$$,
  '23514', null, 'at most 5 CC recipients');
select lives_ok(
  $$insert into public.municipal_submissions (org_id, property_id, period_start, period_end, status, mode, report, scheduled_for)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', '2026-09-25', '2026-10-25', 'scheduled', 'automatic', '{}', now())$$,
  'the scheduled status exists');
select throws_ok(
  $$insert into public.utility_tariffs (org_id, property_id, utility_type, name, blocks, effective_from)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'water', 'Bad', '[]', '2026-07-01')$$,
  '23514', null, 'a tariff needs at least one block');
insert into public.utility_charges (org_id, property_id, meter_id, utility_type, period_start, period_end, consumption_quality, total_amount)
values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'e8555555-0000-0000-0000-000000000001', 'water', '2026-09-25', '2026-10-25', 'complete', 100);
select throws_ok(
  $$insert into public.utility_charges (org_id, property_id, meter_id, utility_type, period_start, period_end, consumption_quality)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'e8555555-0000-0000-0000-000000000001', 'water', '2026-09-25', '2026-10-25', 'complete')$$,
  '23505', null, 'one live charge per meter per period (no duplicate billing)');
update public.utility_charges set status = 'void' where meter_id = 'e8555555-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into public.utility_charges (org_id, property_id, meter_id, utility_type, period_start, period_end, consumption_quality)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'e8555555-0000-0000-0000-000000000001', 'water', '2026-09-25', '2026-10-25', 'complete')$$,
  'a voided charge can be re-generated');

-- ------------------------------------------------ accountant
set local role authenticated;
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-00000000000a';

select throws_ok($$select credentials_ciphertext from public.meter_integrations$$, '42501', null,
  'encrypted credentials are not selectable by API clients');
select is((select provider_config->>'baseUrl' from public.meter_integrations where provider = 'thingsboard'), 'https://tb.example.com',
  'non-secret provider config is readable');
select lives_ok(
  $$insert into public.utility_tariffs (org_id, property_id, utility_type, name, blocks, effective_from)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'water', 'Muni 2026/27', '[{"upTo":null,"rate":40}]', '2026-07-01')$$,
  'accountant can add a tariff');
select throws_ok(
  $$insert into public.utility_charges (org_id, property_id, meter_id, utility_type, period_start, period_end, consumption_quality)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'e8555555-0000-0000-0000-000000000001', 'water', '2026-08-25', '2026-09-25', 'complete')$$,
  '42501', null, 'charges are server-written only');
select lives_ok(
  $$insert into public.meter_integration_requests (org_id, property_id, requested_by, utility_type, manufacturer, model)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-00000000000a', 'water', 'Acme', 'X1')$$,
  'a member can request an integration');
select throws_ok(
  $$insert into public.meter_integration_requests (org_id, requested_by, utility_type, manufacturer, model)
    values ('e8111111-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-00000000000b', 'water', 'Acme', 'X2')$$,
  '42501', null, 'a request cannot be filed in someone else''s name');
select is((select count(*) from public.utility_charges), 2::bigint, 'accountant reads own-org charges');

-- ------------------------------------------------ viewer
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-00000000000b';
select throws_ok(
  $$insert into public.utility_tariffs (org_id, property_id, utility_type, name, blocks, effective_from)
    values ('e8111111-0000-0000-0000-000000000001', 'e8222222-0000-0000-0000-000000000001', 'water', 'V', '[{"upTo":null,"rate":1}]', '2026-07-01')$$,
  '42501', null, 'viewer cannot add a tariff');

-- ------------------------------------------------ other org
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-00000000000e';
select is((select count(*) from public.utility_charges), 0::bigint, 'TENANT ISOLATION: other org sees no charges');
select is((select count(*) from public.utility_tariffs), 0::bigint, 'TENANT ISOLATION: other org sees no tariffs');
select is((select count(*) from public.meter_integration_requests), 0::bigint, 'TENANT ISOLATION: other org sees no integration requests');

select * from finish();
rollback;
