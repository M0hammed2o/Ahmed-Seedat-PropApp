-- Tests for 20260101000081_approve_application_tenant_dedup.sql: approve_application() must not
-- create a duplicate tenants row when an existing tenant already shares the applicant's email, and
-- must support explicitly linking a given tenant.

begin;
select plan(7);

insert into auth.users (id, email) values
  ('f7000000-0000-0000-0000-000000000001', 'aatd-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f7000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Application Dedup Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Application Dedup Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f7000000-0000-0000-0000-000000000001';

select set_config(
  'pgtap.aatd.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Application Dedup Test Org'),
    'Dedup Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
select current_setting('pgtap.aatd.property_id')::uuid, id, 'U1', 'vacant'
from public.organizations where legal_name = 'Application Dedup Test Org';

select set_config(
  'pgtap.aatd.unit_id',
  (select id::text from public.units where property_id = current_setting('pgtap.aatd.property_id')::uuid),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
select current_setting('pgtap.aatd.property_id')::uuid, id, 'U2', 'vacant'
from public.organizations where legal_name = 'Application Dedup Test Org';

select set_config(
  'pgtap.aatd.unit2_id',
  (select id::text from public.units where property_id = current_setting('pgtap.aatd.property_id')::uuid and unit_label = 'U2'),
  false
);

-- === email-match path: an existing tenant shares the new applicant's email ===
insert into public.tenants (org_id, full_name, email, status)
select id, 'Existing Tenant', 'dedup@example.com', 'active'
from public.organizations where legal_name = 'Application Dedup Test Org';

select set_config(
  'pgtap.aatd.existing_tenant_id',
  (select id::text from public.tenants where email = 'dedup@example.com'),
  false
);

insert into public.applications (org_id, property_id, unit_id, applicant_name, applicant_email, status)
select id, current_setting('pgtap.aatd.property_id')::uuid, current_setting('pgtap.aatd.unit_id')::uuid,
  'Existing Tenant', 'DEDUP@example.com', 'submitted'
from public.organizations where legal_name = 'Application Dedup Test Org';

select set_config(
  'pgtap.aatd.app1_id',
  (select id::text from public.applications where unit_id = current_setting('pgtap.aatd.unit_id')::uuid),
  false
);

select lives_ok(
  $$ select public.approve_application(current_setting('pgtap.aatd.app1_id')::uuid, 10000) $$,
  'approval succeeds for an applicant matching an existing tenant email'
);

select is(
  (select count(*)::int from public.tenants where org_id = (select id from public.organizations where legal_name = 'Application Dedup Test Org')),
  1,
  'no duplicate tenant row was created for a case-insensitive email match'
);

select is(
  (select tenant_id from public.lease_tenants lt join public.leases l on l.id = lt.lease_id where l.unit_id = current_setting('pgtap.aatd.unit_id')::uuid),
  current_setting('pgtap.aatd.existing_tenant_id')::uuid,
  'the lease is linked to the pre-existing tenant, not a new one'
);

-- === no email / no match path: a genuinely new person still gets created ===
insert into public.applications (org_id, property_id, unit_id, applicant_name, applicant_email, status)
select id, current_setting('pgtap.aatd.property_id')::uuid, current_setting('pgtap.aatd.unit2_id')::uuid,
  'Brand New Applicant', 'brandnew@example.com', 'submitted'
from public.organizations where legal_name = 'Application Dedup Test Org';

select set_config(
  'pgtap.aatd.app2_id',
  (select id::text from public.applications where unit_id = current_setting('pgtap.aatd.unit2_id')::uuid),
  false
);

select lives_ok(
  $$ select public.approve_application(current_setting('pgtap.aatd.app2_id')::uuid, 8000) $$,
  'approval succeeds for a genuinely new applicant'
);

select is(
  (select count(*)::int from public.tenants where org_id = (select id from public.organizations where legal_name = 'Application Dedup Test Org')),
  2,
  'a new tenant row is created when no existing tenant matches'
);

-- === explicit p_tenant_id path ===
insert into public.units (property_id, org_id, unit_label, status)
select current_setting('pgtap.aatd.property_id')::uuid, id, 'U3', 'vacant'
from public.organizations where legal_name = 'Application Dedup Test Org';

insert into public.applications (org_id, property_id, unit_id, applicant_name, applicant_email, status)
select id, current_setting('pgtap.aatd.property_id')::uuid,
  (select id from public.units where property_id = current_setting('pgtap.aatd.property_id')::uuid and unit_label = 'U3'),
  'Same Person Different Email', 'different-email@example.com', 'submitted'
from public.organizations where legal_name = 'Application Dedup Test Org';

select set_config(
  'pgtap.aatd.lease3_id',
  (select public.approve_application(
    (select id from public.applications where applicant_name = 'Same Person Different Email'),
    9000, 0, current_date, null, 'monthly',
    current_setting('pgtap.aatd.existing_tenant_id')::uuid
  )::text),
  false
);

select is(
  (select tenant_id from public.lease_tenants where lease_id = current_setting('pgtap.aatd.lease3_id')::uuid),
  current_setting('pgtap.aatd.existing_tenant_id')::uuid,
  'an explicit p_tenant_id links to that tenant even with a different applicant email'
);

select * from finish();
rollback;
