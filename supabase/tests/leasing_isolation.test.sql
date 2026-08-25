-- RLS isolation + business-logic tests for applications/leases/lease_tenants/rent_schedules
-- (TASKS.md M9/M10, migrations 20260101000029-31), and specifically approve_application() -- the
-- highest-risk piece of this milestone since it's a multi-table atomic write, not just an RLS
-- policy shape already proven elsewhere.
--
-- Updated by 20260101000131_application_approval_draft_lease.sql: approval itself now only ever
-- produces a DRAFT lease (tenant assigned, no occupancy, no rent schedule) -- the
-- occupied-unit/rent-schedule assertions that used to follow directly from approval now instead
-- follow an explicit activate_lease() call, proving the full approve -> (prepare) -> activate
-- chain still ends in exactly the same real-world state as before, just gated by an extra step.

begin;
select plan(24);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'leasing-agent-a@test.propertyvault.example'),
  ('e2000000-0000-0000-0000-000000000001', 'leasing-agent-b@test.propertyvault.example'),
  ('e4000000-0000-0000-0000-000000000001', 'leasing-viewer-a@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('aeaeaeae-0000-0000-0000-000000000001', 'Leasing Test Org A', 'agency'),
  ('bebebebe-0000-0000-0000-000000000001', 'Leasing Test Org B', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('aeaeaeae-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  ('bebebebe-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  ('aeaeaeae-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'viewer', 'active', now());

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values ('9e9e9e9e-0000-0000-0000-000000000001', 'aeaeaeae-0000-0000-0000-000000000001',
        'Leasing Test Property', '1 Test Street', 'Cape Town', 'ZA', 'apartment');

insert into public.units (id, property_id, org_id, unit_label, status)
values ('9f9f9f9f-0000-0000-0000-000000000001', '9e9e9e9e-0000-0000-0000-000000000001',
        'aeaeaeae-0000-0000-0000-000000000001', 'Unit 1', 'vacant');

insert into public.applications (id, org_id, property_id, unit_id, applicant_name, applicant_email)
values ('9a9a9a9a-0000-0000-0000-000000000001', 'aeaeaeae-0000-0000-0000-000000000001',
        '9e9e9e9e-0000-0000-0000-000000000001', '9f9f9f9f-0000-0000-0000-000000000001',
        'Test Applicant', 'applicant@test.propertyvault.example');

set local role authenticated;

-- === Cross-org isolation: Org B's agent cannot see Org A's application ===
set local "request.jwt.claim.sub" = 'e2000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.applications where id = '9a9a9a9a-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B agent cannot SELECT Org A''s application'
);

-- approve_application() relies entirely on RLS (not security definer) -- calling it as an
-- outsider should fail with "Application not found" via the same SELECT ... FOR UPDATE RLS
-- filtering, proving this function cannot be used to bypass org isolation.
select throws_ok(
  $$ select public.approve_application('9a9a9a9a-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'Application not found (or not visible to the caller)',
  'Org B agent calling approve_application() on Org A''s application raises -- RLS blocks the internal SELECT, not a security bypass'
);

-- === Role-scoped write denial: Org A's viewer can read but not write applications ===
set local "request.jwt.claim.sub" = 'e4000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.applications where org_id = 'aeaeaeae-0000-0000-0000-000000000001'),
  1::bigint,
  'Org A viewer CAN SELECT their own org''s application'
);

select lives_ok(
  $$ update public.applications set applicant_name = 'viewer-write-attempt'
     where id = '9a9a9a9a-0000-0000-0000-000000000001' $$,
  'Org A viewer UPDATE against their own org''s application runs without error (agent+ required, filtered to zero rows, verified next)'
);

select is(
  (select applicant_name from public.applications where id = '9a9a9a9a-0000-0000-0000-000000000001'),
  'Test Applicant',
  'the viewer''s write attempt did not change the application'
);

-- === approve_application(): the real, correctly-authorized path ===
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.approve_application('9a9a9a9a-0000-0000-0000-000000000001'::uuid) $$,
  'Org A agent can approve Org A''s application, creating tenant + draft lease atomically'
);

select is(
  (select status from public.applications where id = '9a9a9a9a-0000-0000-0000-000000000001'),
  'decided'::public.application_status,
  'the application is marked decided after approval'
);

select is(
  (select decision from public.applications where id = '9a9a9a9a-0000-0000-0000-000000000001'),
  'approved'::public.application_decision,
  'the application''s decision is approved'
);

select is(
  (select full_name from public.tenants where org_id = 'aeaeaeae-0000-0000-0000-000000000001'),
  'Test Applicant',
  'a tenant was created from the applicant''s details'
);

select is(
  (select l.status from public.leases l
     join public.applications a on a.id = l.source_application_id
     where a.id = '9a9a9a9a-0000-0000-0000-000000000001'),
  'draft'::public.lease_status,
  'the created lease is a DRAFT, sourced from application_approved -- not active yet'
);

select is(
  (select count(*) from public.lease_tenants lt
     join public.leases l on l.id = lt.lease_id
     join public.applications a on a.id = l.source_application_id
     where a.id = '9a9a9a9a-0000-0000-0000-000000000001' and lt.is_primary = true),
  1::bigint,
  'the new tenant is linked to the lease as the primary tenant, even though the lease is still a draft'
);

select is(
  (select count(*) from public.rent_schedules rs
     join public.leases l on l.id = rs.lease_id
     join public.applications a on a.id = l.source_application_id
     where a.id = '9a9a9a9a-0000-0000-0000-000000000001'),
  0::bigint,
  'no rent_schedules row exists yet -- approval alone never generates one'
);

select is(
  (select status from public.units where id = '9f9f9f9f-0000-0000-0000-000000000001'),
  'vacant'::public.unit_status,
  'the unit is still vacant after approval alone -- only an activated lease occupies it'
);

-- === Preparing and activating the draft lease drives occupancy/rent-schedule, same as any lease ===
select set_config(
  'pgtap.li.draft_lease_id',
  (select l.id::text from public.leases l
     join public.applications a on a.id = l.source_application_id
     where a.id = '9a9a9a9a-0000-0000-0000-000000000001'),
  false
);

update public.leases set rent_amount = 8500, deposit_amount = 8500, start_date = '2026-08-01'::date
where id = current_setting('pgtap.li.draft_lease_id')::uuid;

-- An application-sourced lease additionally requires the review-gate/send/acceptance chain
-- (20260101000134) before activate_lease() will allow it -- a manual lease never touches any of
-- this (see storage_property_scoping.test.sql / the e2e "manual lease" tests for that path).
select throws_ok(
  $$ select public.activate_lease(current_setting('pgtap.li.draft_lease_id')::uuid) $$,
  'P0001',
  'The lease must be sent to the tenant before it can be activated',
  'an application-sourced draft lease cannot be activated before it has been reviewed and sent'
);

insert into public.lease_documents (lease_id, org_id, kind, status, version, storage_path, mime_type, file_size_bytes)
values (
  current_setting('pgtap.li.draft_lease_id')::uuid, 'aeaeaeae-0000-0000-0000-000000000001',
  'uploaded', 'draft', 1, 'aeaeaeae-0000-0000-0000-000000000001/9e9e9e9e-0000-0000-0000-000000000001/lease-v1.pdf',
  'application/pdf', 1024
);

select lives_ok(
  $$ select public.acknowledge_lease_review(current_setting('pgtap.li.draft_lease_id')::uuid) $$,
  'the review gate passes once tenant/rent/dates/document all exist'
);

select throws_ok(
  $$ select public.activate_lease(current_setting('pgtap.li.draft_lease_id')::uuid) $$,
  'P0001',
  'The lease must be sent to the tenant before it can be activated',
  'reviewed but not yet sent is still not enough to activate'
);

select lives_ok(
  $$ select public.send_lease(current_setting('pgtap.li.draft_lease_id')::uuid) $$,
  'the reviewed lease can be sent'
);

select throws_ok(
  $$ select public.activate_lease(current_setting('pgtap.li.draft_lease_id')::uuid) $$,
  'P0001',
  'The tenant must acknowledge the lease (or staff must record a signed copy) before activation',
  'sent but not yet acknowledged/signed is still not enough to activate'
);

update public.lease_preparations
set staff_confirmed_signed_at = now(), staff_confirmed_signed_by = 'e1000000-0000-0000-0000-000000000001'
where lease_id = current_setting('pgtap.li.draft_lease_id')::uuid;

select lives_ok(
  $$ select public.activate_lease(current_setting('pgtap.li.draft_lease_id')::uuid) $$,
  'Org A agent can activate the prepared, reviewed, sent, and staff-confirmed-signed draft lease'
);

select is(
  (select status from public.leases where id = current_setting('pgtap.li.draft_lease_id')::uuid),
  'active'::public.lease_status,
  'the lease is active after explicit activation'
);

select is(
  (select status from public.units where id = '9f9f9f9f-0000-0000-0000-000000000001'),
  'occupied'::public.unit_status,
  'the unit is marked occupied as a side effect of activate_lease(), not of approval'
);

select is(
  (select count(*)::int from public.rent_schedules rs
     where rs.lease_id = current_setting('pgtap.li.draft_lease_id')::uuid and rs.amount = 8500),
  (select count(*)::int from public.rent_schedules rs where rs.lease_id = current_setting('pgtap.li.draft_lease_id')::uuid),
  'rent_schedules row(s) were generated by activate_lease(), all matching the prepared rent amount'
);

select ok(
  (select count(*)::int from public.rent_schedules rs where rs.lease_id = current_setting('pgtap.li.draft_lease_id')::uuid) >= 1,
  'at least one rent_schedules row was generated by activate_lease()'
);

-- === Cannot re-decide an already-decided application (data-integrity guard, not RLS) ===
select throws_ok(
  $$ select public.approve_application('9a9a9a9a-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'Application 9a9a9a9a-0000-0000-0000-000000000001 has already been decided',
  'approving an already-decided application raises rather than silently creating a second lease'
);

select * from finish();
rollback;
