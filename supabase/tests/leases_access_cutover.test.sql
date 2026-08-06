-- Tests for 20260101000066_leases_access_cutover.sql: leases (and lease_tenants, inherited with
-- no policy changes of its own) gated on has_property_access() via a join through units. No
-- bootstrapping problem (verified empirically before this migration was written).

begin;
select plan(7);

insert into auth.users (id, email) values
  ('f4000000-0000-0000-0000-000000000001', 'lac-principal@test.propertyvault.example'),
  ('f4000000-0000-0000-0000-000000000002', 'lac-coworker@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f4000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Leases Cutover Test Org', 'agency')), null, 'org created');

select set_config(
  'pgtap.lac_test.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Leases Cutover Test Org'),
    'Leases Cutover Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
select current_setting('pgtap.lac_test.property_id')::uuid, id, 'U1', 'vacant'
from public.organizations where legal_name = 'Leases Cutover Test Org';

select set_config(
  'pgtap.lac_test.unit_id',
  (select id::text from public.units where property_id = current_setting('pgtap.lac_test.property_id')::uuid),
  false
);

insert into public.tenants (org_id, full_name, status)
select id, 'Cutover Tenant', 'active' from public.organizations where legal_name = 'Leases Cutover Test Org';

select set_config(
  'pgtap.lac_test.tenant_id',
  (select id::text from public.tenants where full_name = 'Cutover Tenant'),
  false
);

-- Exact API route sequence: insert ... select ... single()
select lives_ok(
  $$ insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
     select id, current_setting('pgtap.lac_test.unit_id')::uuid, '2026-01-01', 10000, 'draft', 'manual'
     from public.organizations where legal_name = 'Leases Cutover Test Org' $$,
  'the property owner can create a lease on their own unit (no bootstrapping problem, verified)'
);

select set_config(
  'pgtap.lac_test.lease_id',
  (select id::text from public.leases where unit_id = current_setting('pgtap.lac_test.unit_id')::uuid),
  false
);

select is(
  (select status from public.leases where id = current_setting('pgtap.lac_test.lease_id')::uuid),
  'draft'::public.lease_status,
  'the creator can fetch the lease via a plain, separate SELECT'
);

select lives_ok(
  $$ insert into public.lease_tenants (lease_id, tenant_id, is_primary)
     values (current_setting('pgtap.lac_test.lease_id')::uuid, current_setting('pgtap.lac_test.tenant_id')::uuid, true) $$,
  'the creator can attach a tenant to the lease'
);

-- A coworker who joins the org is auto-granted access (zero-regression trigger) -- confirm it
-- cascades through units -> leases -> lease_tenants, then confirm revocation removes all three.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'f4000000-0000-0000-0000-000000000002', 'viewer', 'active', now()
from public.organizations where legal_name = 'Leases Cutover Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'f4000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.leases where id = current_setting('pgtap.lac_test.lease_id')::uuid),
  1,
  'a coworker who joins the org is auto-granted access that cascades from property to lease'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f4000000-0000-0000-0000-000000000001';

select public.revoke_property_access(
  current_setting('pgtap.lac_test.property_id')::uuid,
  'f4000000-0000-0000-0000-000000000002'::uuid
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f4000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.leases where id = current_setting('pgtap.lac_test.lease_id')::uuid),
  0,
  'revoking property access removes lease visibility, even though org membership is unchanged'
);

select is(
  (select count(*)::int from public.lease_tenants where lease_id = current_setting('pgtap.lac_test.lease_id')::uuid),
  0,
  'lease_tenants inherits the restriction with no policy changes of its own -- verified, not assumed'
);

select * from finish();
rollback;
