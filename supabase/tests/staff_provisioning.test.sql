-- Tests for 20260101000124_staff_provisioning.sql: provision_staff_member() and
-- activate_staff_provision(). True concurrent-final-seat racing (two real simultaneous
-- connections) can't be exercised inside a single pgTAP transaction -- that case belongs in a
-- real-local-Supabase vitest integration test, same split invite_acceptance_seat_check.test.sql
-- already documents for accept_organization_invite().

begin;
select plan(28);

insert into auth.users (id, email, encrypted_password) values
  ('a1000000-0000-0000-0000-000000000001', 'staffprov-principal@test.propertyvault.example', 'x'),
  ('a1000000-0000-0000-0000-000000000002', 'staffprov-manager@test.propertyvault.example', 'x'),
  ('a1000000-0000-0000-0000-000000000003', 'staffprov-existing-customer@test.propertyvault.example', 'x'),
  ('a1000000-0000-0000-0000-000000000004', 'staffprov-second-invitee@test.propertyvault.example', 'x');
-- Passwordless identity -- simulates an orphan left by a previously-interrupted provisioning
-- attempt (generateLink() created the auth user, but the row-update/email step never completed).
insert into auth.users (id, email, encrypted_password) values
  ('a1000000-0000-0000-0000-000000000005', 'staffprov-orphan@test.propertyvault.example', null);
-- The employee who will call activate_staff_provision() themselves -- brand new, no password yet
-- (mirrors what generateLink({type:'invite'}) + verifyOtp() produces before updateUser()).
insert into auth.users (id, email, encrypted_password) values
  ('a1000000-0000-0000-0000-000000000006', 'staffprov-new-hire@test.propertyvault.example', null);

-- a2...0001: principal only -- kept with a completely free seat for the branch/seat-flow tests
-- below (new-email, orphan, existing-user, seat-limit-at-provisioning). The manager-ceiling
-- authorization test uses a SEPARATE org (a2...0005) precisely so its manager fixture member
-- never consumes this org's one and only seat.
insert into public.organizations (id, legal_name, org_type)
values ('a2000000-0000-0000-0000-000000000001', 'Staff Provisioning Test Org (limited)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'a2000000-0000-0000-0000-000000000001',
  (select id from public.plans where code = 'starter'),
  'monthly', current_date, current_date + interval '1 month', 'active'
);
select is(
  (select public.org_staff_seat_limit('a2000000-0000-0000-0000-000000000001')),
  1,
  'fixture sanity check: starter plan maxStaff is 1'
);

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type, created_at)
values ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Unit A', '1 Main Rd', 'Cape Town', 'ZA', 'house', now());

-- Dedicated org for the manager-ceiling test only -- the role-ceiling check fires before any
-- seat check in provision_staff_member(), so this manager fixture consuming the org's one seat
-- is irrelevant to that test, but keeping it on a separate org avoids any coupling.
insert into public.organizations (id, legal_name, org_type)
values ('a2000000-0000-0000-0000-000000000005', 'Staff Provisioning Test Org (manager ceiling)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('a2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('a2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', 'manager', 'active', now());

-- ============================================================================================
-- Authorization/validation guards (no seat consumed by any of these -- each raises before its
-- respective org's seat count is ever compared).
-- ============================================================================================
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.provision_staff_member('a2000000-0000-0000-0000-000000000001'::uuid, 'x@test.propertyvault.example'::citext, null, 'principal'::public.organization_member_role, 'all'::public.property_access_mode) $$,
  'P0001',
  'Principal cannot be assigned through staff provisioning',
  'principal role is rejected regardless of caller rank'
);

select throws_ok(
  $$ select public.provision_staff_member('a2000000-0000-0000-0000-000000000005'::uuid, 'x@test.propertyvault.example'::citext, null, 'manager'::public.organization_member_role, 'all'::public.property_access_mode) $$,
  'P0001',
  'A manager cannot provision a member with the manager or principal role',
  'a manager caller cannot grant the manager role (role-ceiling)'
);

select throws_ok(
  $$ select public.provision_staff_member('a2000000-0000-0000-0000-000000000001'::uuid, 'x@test.propertyvault.example'::citext, null, 'agent'::public.organization_member_role, 'selected'::public.property_access_mode) $$,
  'P0001',
  'Select at least one property, or choose All properties.',
  'selected mode with zero properties is rejected'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000004';
select throws_ok(
  $$ select public.provision_staff_member('a2000000-0000-0000-0000-000000000001'::uuid, 'x@test.propertyvault.example'::citext, null, 'agent'::public.organization_member_role, 'all'::public.property_access_mode) $$,
  'P0001',
  'Only manager+ org members may provision staff',
  'a caller with no active membership in the org cannot provision staff'
);

-- ============================================================================================
-- Commercial-setup gate.
-- ============================================================================================
reset role;
insert into public.organizations (id, legal_name, org_type, commercial_setup_required)
values ('a2000000-0000-0000-0000-000000000002', 'Staff Provisioning Test Org (not set up)', 'agency', true);
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'principal', 'active', now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select public.provision_staff_member('a2000000-0000-0000-0000-000000000002'::uuid, 'x@test.propertyvault.example'::citext, null, 'agent'::public.organization_member_role, 'all'::public.property_access_mode) $$,
  'P0001',
  'org_not_commercially_active: this organization has not completed billing setup yet',
  'provisioning is blocked for an org that has not completed commercial setup'
);

-- ============================================================================================
-- New-email branch: no auth.users row for the email at all -- 'pending' row created, no seat
-- consumed, membership not activated.
-- ============================================================================================
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select is_existing_active_user, auth_user_id, membership_activated
     from public.provision_staff_member(
       'a2000000-0000-0000-0000-000000000001'::uuid, 'staffprov-brand-new@test.propertyvault.example'::citext,
       'Brand New', 'agent'::public.organization_member_role, 'all'::public.property_access_mode
     ) $$,
  $$ values (false, null::uuid, false) $$,
  'a genuinely new email returns is_existing_active_user=false, no auth_user_id, not activated'
);
select is(
  (select status from public.organization_staff_provisions where email = 'staffprov-brand-new@test.propertyvault.example'::citext),
  'pending',
  'the new-email provision row is left in pending status (caller still owes the GoTrue call)'
);
select is(
  (select public.org_active_billable_staff_count('a2000000-0000-0000-0000-000000000001')),
  0,
  'no seat was consumed by the new-email (not-yet-activated) provision'
);

-- Duplicate request for the SAME still-in-flight email/org -- rejected by the partial unique
-- index (test scenario D, "repeated provision request never creates a duplicate").
select throws_ok(
  $$ select public.provision_staff_member(
       'a2000000-0000-0000-0000-000000000001'::uuid, 'staffprov-brand-new@test.propertyvault.example'::citext,
       'Brand New', 'agent'::public.organization_member_role, 'all'::public.property_access_mode
     ) $$,
  '23505',
  'duplicate key value violates unique constraint "organization_staff_provisions_org_email_inflight_idx"',
  'a second in-flight provision request for the same org+email is rejected, not duplicated'
);

-- ============================================================================================
-- Orphan/passwordless-existing-identity branch: auth.users row exists but encrypted_password is
-- null -- treated identically to a brand-new email (pending row, auth_user_id populated so the
-- caller's generateLink() call reuses rather than duplicates this identity).
-- ============================================================================================
select results_eq(
  $$ select is_existing_active_user, auth_user_id, membership_activated
     from public.provision_staff_member(
       'a2000000-0000-0000-0000-000000000001'::uuid, 'staffprov-orphan@test.propertyvault.example'::citext,
       null, 'agent'::public.organization_member_role, 'all'::public.property_access_mode
     ) $$,
  $$ values (false, 'a1000000-0000-0000-0000-000000000005'::uuid, false) $$,
  'a passwordless existing identity (orphan recovery) is treated as the new-email branch, with its real auth_user_id carried through'
);

-- ============================================================================================
-- Existing, password-capable identity: provisioning IS activation. Immediate membership, seat
-- consumed now, provisions row created already 'activated'.
-- ============================================================================================
select results_eq(
  $$ select is_existing_active_user, auth_user_id, membership_activated
     from public.provision_staff_member(
       'a2000000-0000-0000-0000-000000000001'::uuid, 'staffprov-existing-customer@test.propertyvault.example'::citext,
       null, 'agent'::public.organization_member_role, 'selected'::public.property_access_mode,
       jsonb_build_array(jsonb_build_object('propertyId', 'a3000000-0000-0000-0000-000000000001', 'propertyRole', 'read_only'))
     ) $$,
  $$ values (true, 'a1000000-0000-0000-0000-000000000003'::uuid, true) $$,
  'an existing password-capable identity is activated immediately by provisioning itself'
);
select ok(
  exists(select 1 from public.organization_members
    where org_id = 'a2000000-0000-0000-0000-000000000001'
      and user_id = 'a1000000-0000-0000-0000-000000000003' and status = 'active' and role = 'agent'),
  'the existing user''s membership row was created active'
);
select ok(
  exists(select 1 from public.property_access
    where property_id = 'a3000000-0000-0000-0000-000000000001'
      and user_id = 'a1000000-0000-0000-0000-000000000003' and property_role = 'read_only'),
  'selected-property access was applied atomically for the existing user'
);
select is(
  (select status from public.organization_staff_provisions
    where email = 'staffprov-existing-customer@test.propertyvault.example'::citext),
  'activated',
  'the existing-user provisions row is created already activated, never left in-flight'
);
select is(
  (select public.org_active_billable_staff_count('a2000000-0000-0000-0000-000000000001')),
  1,
  'the org''s one seat is now occupied by the existing-user activation'
);

-- ============================================================================================
-- Seat-limit enforcement at provisioning time: the org's one seat is now taken -- a second
-- new-email provision attempt is fast-rejected before any row is created.
-- ============================================================================================
select throws_ok(
  $$ select public.provision_staff_member(
       'a2000000-0000-0000-0000-000000000001'::uuid, 'staffprov-should-be-rejected@test.propertyvault.example'::citext,
       null, 'agent'::public.organization_member_role, 'all'::public.property_access_mode
     ) $$,
  'P0001',
  'staff_seat_limit_reached: this organization has no remaining staff seats available.',
  'provisioning a new email is rejected once the org''s one seat is already occupied'
);
select ok(
  not exists(select 1 from public.organization_staff_provisions
    where email = 'staffprov-should-be-rejected@test.propertyvault.example'::citext),
  'the rejected provision attempt left no row behind -- no partial state'
);

-- ============================================================================================
-- activate_staff_provision(): simulate the new-hire's own session after verifyOtp()+updateUser().
-- Uses a SECOND org (fresh seat) so activation-time seat enforcement is isolated from the
-- provisioning-time checks above.
-- ============================================================================================
reset role;
insert into public.organizations (id, legal_name, org_type)
values ('a2000000-0000-0000-0000-000000000003', 'Staff Provisioning Test Org (activation)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'a2000000-0000-0000-0000-000000000003',
  (select id from public.plans where code = 'starter'),
  'monthly', current_date, current_date + interval '1 month', 'active'
);
insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type, created_at)
values ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000003', 'Unit B', '2 Main Rd', 'Cape Town', 'ZA', 'house', now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.provision_staff_member(
       'a2000000-0000-0000-0000-000000000003'::uuid, 'staffprov-new-hire@test.propertyvault.example'::citext,
       'New Hire', 'agent'::public.organization_member_role, 'selected'::public.property_access_mode,
       jsonb_build_array(jsonb_build_object('propertyId', 'a3000000-0000-0000-0000-000000000002', 'propertyRole', 'property_manager'))
     ) $$,
  'principal provisions a brand-new hire with selected-property access'
);

-- Simulate the caller's own generateLink()-driven row update (the TypeScript orchestration layer
-- normally does this) -- moves the row to awaiting_activation with a token_hash, exactly what
-- sendActivationLink() does after a successful GoTrue call.
reset role;
update public.organization_staff_provisions
  set auth_user_id = 'a1000000-0000-0000-0000-000000000006', token_hash = 'test-hashed-token', status = 'awaiting_activation'
  where org_id = 'a2000000-0000-0000-0000-000000000003' and email = 'staffprov-new-hire@test.propertyvault.example'::citext;

select is(
  (select public.org_active_billable_staff_count('a2000000-0000-0000-0000-000000000003')),
  0,
  'the new hire''s seat is still NOT consumed while merely awaiting_activation'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000006';
select lives_ok(
  $$ select public.activate_staff_provision() $$,
  'the new hire activates their own provision via auth.uid() alone'
);
select ok(
  exists(select 1 from public.organization_members
    where org_id = 'a2000000-0000-0000-0000-000000000003'
      and user_id = 'a1000000-0000-0000-0000-000000000006' and status = 'active' and role = 'agent'),
  'activation created the new hire''s membership row'
);
select ok(
  exists(select 1 from public.property_access
    where property_id = 'a3000000-0000-0000-0000-000000000002'
      and user_id = 'a1000000-0000-0000-0000-000000000006' and property_role = 'property_manager'),
  'activation copied the pending selected-property grant into property_access'
);
select is(
  (select status from public.organization_staff_provisions
    where org_id = 'a2000000-0000-0000-0000-000000000003' and email = 'staffprov-new-hire@test.propertyvault.example'::citext),
  'activated',
  'the provisions row is marked activated'
);
select is(
  (select public.org_active_billable_staff_count('a2000000-0000-0000-0000-000000000003')),
  1,
  'the org''s seat is now consumed at activation time'
);

-- A caller with no awaiting_activation row of their own (e.g. already activated, or none ever
-- existed) gets a clear error, never a silent no-op.
select throws_ok(
  $$ select public.activate_staff_provision() $$,
  'P0001',
  'No pending staff activation found for this account, or it has expired.',
  're-calling activate_staff_provision() with nothing pending raises a clear error'
);

-- ============================================================================================
-- Revoke-then-re-provision: a revoked row does not collide with the partial unique index, so the
-- same org+email can be provisioned again later. Uses a FRESH, seat-unconstrained org -- every
-- other org above already has its one seat spoken for by this point, which would otherwise
-- conflate "blocked by the unique index" with "blocked by the seat limit" in this one test.
-- ============================================================================================
reset role;
insert into public.organizations (id, legal_name, org_type)
values ('a2000000-0000-0000-0000-000000000006', 'Staff Provisioning Test Org (revoke re-provision)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('a2000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', 'principal', 'active', now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.provision_staff_member(
       'a2000000-0000-0000-0000-000000000006'::uuid, 'staffprov-revoke-retest@test.propertyvault.example'::citext,
       'Revoke Retest', 'agent'::public.organization_member_role, 'all'::public.property_access_mode
     ) $$,
  'first provision for a fresh org+email succeeds'
);

reset role;
update public.organization_staff_provisions
  set status = 'revoked'
  where org_id = 'a2000000-0000-0000-0000-000000000006' and email = 'staffprov-revoke-retest@test.propertyvault.example'::citext;

set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.provision_staff_member(
       'a2000000-0000-0000-0000-000000000006'::uuid, 'staffprov-revoke-retest@test.propertyvault.example'::citext,
       'Revoke Retest', 'agent'::public.organization_member_role, 'all'::public.property_access_mode
     ) $$,
  'the same org+email can be re-provisioned once the earlier attempt is revoked (no unique-index collision)'
);

select * from finish();
rollback;
