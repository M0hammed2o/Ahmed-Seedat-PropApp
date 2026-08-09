-- Tests for 20260101000078_lease_tenant_assignment_and_activation.sql and
-- 20260101000079_unit_status_derivation.sql: assign_lease_tenant(), activate_lease(), end_lease(),
-- the units.status derivation trigger, and the one-active-lease-per-unit guard.

begin;
select plan(17);

insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'lwa-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Lease Workflow Test Org', 'agency')), null, 'org created');

select set_config(
  'pgtap.lwa.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Lease Workflow Test Org'),
    'Lease Workflow Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
select current_setting('pgtap.lwa.property_id')::uuid, id, 'U1', 'vacant'
from public.organizations where legal_name = 'Lease Workflow Test Org';

select set_config(
  'pgtap.lwa.unit_id',
  (select id::text from public.units where property_id = current_setting('pgtap.lwa.property_id')::uuid),
  false
);

insert into public.tenants (org_id, full_name, status)
select id, 'Workflow Tenant', 'active' from public.organizations where legal_name = 'Lease Workflow Test Org';

select set_config(
  'pgtap.lwa.tenant_id',
  (select id::text from public.tenants where full_name = 'Workflow Tenant'),
  false
);

insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
select id, current_setting('pgtap.lwa.unit_id')::uuid, '2026-01-01', 10000, 'draft', 'manual'
from public.organizations where legal_name = 'Lease Workflow Test Org';

select set_config(
  'pgtap.lwa.lease_id',
  (select id::text from public.leases where unit_id = current_setting('pgtap.lwa.unit_id')::uuid),
  false
);

-- === activation guards ===
select throws_ok(
  $$ select public.activate_lease(current_setting('pgtap.lwa.lease_id')::uuid) $$,
  'Assign a tenant to this lease before activating it',
  'activation rejected with no tenant assigned'
);

select lives_ok(
  $$ select public.assign_lease_tenant(current_setting('pgtap.lwa.lease_id')::uuid, current_setting('pgtap.lwa.tenant_id')::uuid) $$,
  'assign_lease_tenant attaches an existing tenant'
);

select is(
  (select is_primary from public.lease_tenants
   where lease_id = current_setting('pgtap.lwa.lease_id')::uuid and tenant_id = current_setting('pgtap.lwa.tenant_id')::uuid),
  true,
  'assigned tenant is marked primary by default'
);

select lives_ok(
  $$ select public.activate_lease(current_setting('pgtap.lwa.lease_id')::uuid) $$,
  'activation succeeds once a tenant is assigned, rent > 0, and start_date is set'
);

select is(
  (select status from public.leases where id = current_setting('pgtap.lwa.lease_id')::uuid),
  'active'::public.lease_status,
  'lease status is now active'
);

select is(
  (select status from public.units where id = current_setting('pgtap.lwa.unit_id')::uuid),
  'occupied'::public.unit_status,
  'unit status derived to occupied by the trigger, not set manually'
);

-- generate_rent_schedules_for_lease() fills every period from start_date up to
-- current_date+1month by default (not just the first) -- assert "at least one row exists" rather
-- than a literal count, which would be brittle against the environment's current_date.
select ok(
  (select count(*)::int from public.rent_schedules where lease_id = current_setting('pgtap.lwa.lease_id')::uuid) >= 1,
  'activation generated at least the first rent-schedule row'
);

select set_config(
  'pgtap.lwa.rent_schedule_count',
  (select count(*)::text from public.rent_schedules where lease_id = current_setting('pgtap.lwa.lease_id')::uuid),
  false
);

-- Idempotency: re-activating an already-active lease is a no-op, not an error, and does not
-- duplicate any rent-schedule row (Stage 12's "duplicate activation" requirement).
select lives_ok(
  $$ select public.activate_lease(current_setting('pgtap.lwa.lease_id')::uuid) $$,
  'activating an already-active lease is idempotent'
);

select is(
  (select count(*)::int from public.rent_schedules where lease_id = current_setting('pgtap.lwa.lease_id')::uuid),
  current_setting('pgtap.lwa.rent_schedule_count')::int,
  'idempotent re-activation did not duplicate the rent-schedule row'
);

-- === overlapping active lease guard ===
insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
select id, current_setting('pgtap.lwa.unit_id')::uuid, '2026-02-01', 12000, 'draft', 'manual'
from public.organizations where legal_name = 'Lease Workflow Test Org';

select set_config(
  'pgtap.lwa.lease2_id',
  (select id::text from public.leases where unit_id = current_setting('pgtap.lwa.unit_id')::uuid and start_date = '2026-02-01'),
  false
);

select lives_ok(
  $$ select public.assign_lease_tenant(current_setting('pgtap.lwa.lease2_id')::uuid, current_setting('pgtap.lwa.tenant_id')::uuid) $$,
  'second lease can also be assigned the same tenant'
);

select throws_ok(
  $$ select public.activate_lease(current_setting('pgtap.lwa.lease2_id')::uuid) $$,
  'This unit already has another active lease',
  'a second lease on the same unit cannot be activated while the first is active'
);

-- === ending a lease reverts the unit ===
select throws_ok(
  $$ select public.end_lease(current_setting('pgtap.lwa.lease_id')::uuid, 'draft'::public.lease_status) $$,
  'end_lease can only set status to expired or terminated (got draft)',
  'end_lease rejects a non-terminal target status'
);

select lives_ok(
  $$ select public.end_lease(current_setting('pgtap.lwa.lease_id')::uuid, 'terminated'::public.lease_status) $$,
  'ending the active lease succeeds'
);

select is(
  (select status from public.units where id = current_setting('pgtap.lwa.unit_id')::uuid),
  'vacant'::public.unit_status,
  'unit status reverts to vacant once its active lease ends'
);

-- Now that the unit has no active lease, the second (still-draft) lease can be activated.
select lives_ok(
  $$ select public.activate_lease(current_setting('pgtap.lwa.lease2_id')::uuid) $$,
  'a different lease on the same unit can now be activated after the first ended'
);

select is(
  (select status from public.units where id = current_setting('pgtap.lwa.unit_id')::uuid),
  'occupied'::public.unit_status,
  'unit is occupied again via the second lease'
);

select * from finish();
rollback;
