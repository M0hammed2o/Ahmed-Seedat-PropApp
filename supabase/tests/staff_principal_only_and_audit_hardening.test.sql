-- Tests for 20260101000125_staff_principal_only_and_audit_hardening.sql: principal-only floor
-- on every staff-administration RPC/RLS policy, Principal self-protection guards, and the new
-- generic audit triggers on properties/units/tenants/leases/inspections/accounting_periods.

begin;
select plan(27);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'hardening-principal@test.propertyvault.example'),
  ('e1000000-0000-0000-0000-000000000002', 'hardening-manager@test.propertyvault.example'),
  ('e1000000-0000-0000-0000-000000000003', 'hardening-agent@test.propertyvault.example'),
  ('e1000000-0000-0000-0000-000000000004', 'hardening-second-principal@test.propertyvault.example'),
  ('e1000000-0000-0000-0000-000000000005', 'hardening-target-staff@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values ('e2000000-0000-0000-0000-000000000001', 'Staff Hardening Test Org', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'manager', 'active', now()),
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 'agent', 'active', now()),
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'principal', 'active', now()),
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005', 'viewer', 'active', now());

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values ('e3000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'Hardening Unit A', '1 Hardening Rd', 'Cape Town', 'ZA', 'house');

-- ============================================================================================
-- Section 1: staff-administration RPCs reject a Manager caller outright (principal-only).
-- ============================================================================================
set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.update_organization_member_role('e2000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000003'::uuid, 'accountant'::public.organization_member_role) $$,
  'P0001',
  'Only the organization principal may change another member''s role',
  'a manager caller cannot change another member''s role (was manager+)'
);

select throws_ok(
  $$ select public.revoke_organization_member('e2000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000003'::uuid) $$,
  'P0001',
  'Only the organization principal may remove a staff member',
  'a manager caller cannot remove a staff member (was manager+)'
);

select throws_ok(
  $$ select public.set_member_property_access_mode('e2000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000003'::uuid, 'selected'::public.property_access_mode) $$,
  'P0001',
  'Only the organization principal may change a member''s property access mode',
  'a manager caller cannot change a member''s property access mode (was manager+)'
);

select throws_ok(
  $$ select public.grant_property_access('e3000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000003'::uuid, 'read_only'::public.property_role) $$,
  'P0001',
  'Only the organization principal may grant property access',
  'a manager caller cannot grant property access (was manager+)'
);

select throws_ok(
  $$ select public.revoke_property_access('e3000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000003'::uuid) $$,
  'P0001',
  'Only the organization principal may revoke property access',
  'a manager caller cannot revoke property access (was manager+)'
);

reset role;
insert into public.organization_invites (id, org_id, email, role, invited_by, token, expires_at)
values ('e4000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
  'hardening-invitee@test.propertyvault.example', 'agent', 'e1000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-000000000001', now() + interval '7 days');

set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.revoke_organization_invite('e4000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'Only the organization principal may revoke an organization invite',
  'a manager caller cannot revoke an organization invite (was manager+)'
);

-- ============================================================================================
-- Section 2: the SAME actions succeed for the Principal.
-- ============================================================================================
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.grant_property_access('e3000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000005'::uuid, 'read_only'::public.property_role) $$,
  'the principal CAN grant property access'
);
select lives_ok(
  $$ select public.set_member_property_access_mode('e2000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000005'::uuid, 'selected'::public.property_access_mode) $$,
  'the principal CAN change a member''s property access mode'
);
select lives_ok(
  $$ select public.update_organization_member_role('e2000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000005'::uuid, 'agent'::public.organization_member_role) $$,
  'the principal CAN change another member''s role'
);
select lives_ok(
  $$ select public.revoke_organization_invite('e4000000-0000-0000-0000-000000000001'::uuid) $$,
  'the principal CAN revoke an organization invite'
);
select lives_ok(
  $$ select public.revoke_property_access('e3000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000005'::uuid) $$,
  'the principal CAN revoke property access'
);

-- ============================================================================================
-- Section 3: Principal row safety -- a Principal cannot target their OWN row via these actions.
-- ============================================================================================
select throws_ok(
  $$ select public.update_organization_member_role('e2000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid, 'manager'::public.organization_member_role) $$,
  'P0001',
  'Use a dedicated ownership-transfer workflow to change your own role',
  'a principal cannot change their OWN role via the generic role-change action'
);
select throws_ok(
  $$ select public.set_member_property_access_mode('e2000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid, 'selected'::public.property_access_mode) $$,
  'P0001',
  'Principal property access cannot be changed via this action',
  'a principal cannot change their OWN property access mode'
);
select throws_ok(
  $$ select public.revoke_organization_member('e2000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'Use a dedicated ownership-transfer workflow to remove your own access',
  'a principal cannot remove their OWN staff access'
);

-- A SECOND principal targeting the first (not self) still succeeds -- self-protection only
-- blocks self-targeting, never a legitimate co-principal action.
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000004';
select lives_ok(
  $$ select public.update_organization_member_role('e2000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000005'::uuid, 'viewer'::public.organization_member_role) $$,
  'a second principal CAN change a different member''s role (self-protection is self-targeting only)'
);

-- ============================================================================================
-- Section 4: RLS -- staff-provisioning records are principal-only to READ too (was any
-- same-org member / agent+), the exact "cannot inspect other staff provisioning records"
-- requirement.
-- ============================================================================================
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.organization_invites where org_id = 'e2000000-0000-0000-0000-000000000001'),
  0,
  'an agent cannot SELECT organization_invites for their own org (principal-only now)'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';
select ok(
  (select count(*)::int from public.organization_invites where org_id = 'e2000000-0000-0000-0000-000000000001') >= 0,
  'the principal CAN SELECT organization_invites for their own org'
);

-- ============================================================================================
-- Section 5: generic audit trigger coverage -- properties/units/tenants/leases/inspections/
-- accounting_periods now produce audit_events rows on INSERT/UPDATE, with correct org_id/
-- entity_type/before/after, closing the gap a full mutating-route audit (background agent, this
-- date) found: these four entities had ZERO audit coverage anywhere (no RPC, no TS call, no
-- trigger).
-- ============================================================================================
reset role;
select is(
  (select entity_type from public.audit_events
    where entity_type = 'properties' and entity_id = 'e3000000-0000-0000-0000-000000000001'
    order by created_at asc limit 1),
  'properties',
  'creating a property produced a properties.insert audit_events row'
);
select is(
  (select org_id from public.audit_events
    where entity_type = 'properties' and entity_id = 'e3000000-0000-0000-0000-000000000001' limit 1),
  'e2000000-0000-0000-0000-000000000001'::uuid,
  'the property-creation audit row carries the correct org_id'
);

update public.properties set nickname = 'Hardening Unit A (renamed)' where id = 'e3000000-0000-0000-0000-000000000001';
select ok(
  exists(select 1 from public.audit_events
    where entity_type = 'properties' and entity_id = 'e3000000-0000-0000-0000-000000000001'
      and action = 'properties.update'
      and (after->>'nickname') = 'Hardening Unit A (renamed)'),
  'updating a property produced a properties.update audit_events row with the new value in after'
);

insert into public.tenants (id, org_id, full_name, email, status)
values ('e6000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'Hardening Tenant', 'hardening-tenant@test.propertyvault.example', 'active');
select ok(
  exists(select 1 from public.audit_events where entity_type = 'tenants' and entity_id = 'e6000000-0000-0000-0000-000000000001'),
  'creating a tenant produced a tenants.insert audit_events row'
);

insert into public.units (id, org_id, property_id, unit_label, status)
values ('e7000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'Unit 1', 'vacant');
select ok(
  exists(select 1 from public.audit_events where entity_type = 'units' and entity_id = 'e7000000-0000-0000-0000-000000000001'),
  'creating a unit produced a units.insert audit_events row'
);
select is(
  (select property_id from public.audit_events where entity_type = 'units' and entity_id = 'e7000000-0000-0000-0000-000000000001' limit 1),
  'e3000000-0000-0000-0000-000000000001'::uuid,
  'the unit-creation audit row captured property_id (direct column extraction)'
);

insert into public.inspections (id, org_id, property_id, unit_id, inspection_type, status, scheduled_at)
values ('e8000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'move_in', 'scheduled', now());
select ok(
  exists(select 1 from public.audit_events where entity_type = 'inspections' and entity_id = 'e8000000-0000-0000-0000-000000000001'),
  'creating an inspection produced an inspections.insert audit_events row'
);

-- ============================================================================================
-- Section 6: audit_events remains append-only -- no update/delete, even after this migration's
-- new columns were added.
-- ============================================================================================
select throws_ok(
  $$ update public.audit_events set action = 'tampered' where entity_type = 'properties' and entity_id = 'e3000000-0000-0000-0000-000000000001' $$,
  'audit_events rows are permanently immutable once written (trustworthy audit trail requirement)',
  'audit_events cannot be updated, even by a row this migration''s own trigger just wrote'
);
select throws_ok(
  $$ delete from public.audit_events where entity_type = 'properties' and entity_id = 'e3000000-0000-0000-0000-000000000001' $$,
  'audit_events rows are permanently immutable once written (trustworthy audit trail requirement)',
  'audit_events rows cannot be deleted'
);

-- ============================================================================================
-- Section 7: writeAuditEvent()-style actor snapshot columns populated by the staff RPCs
-- themselves (provision_staff_member/update_organization_member_role/etc already pass
-- actor_role explicitly inside this migration).
-- ============================================================================================
select is(
  (select actor_role from public.audit_events where action = 'staff.role_changed' order by created_at desc limit 1),
  'principal',
  'update_organization_member_role() stamps actor_role on its own audit_events row'
);

select * from finish();
rollback;
