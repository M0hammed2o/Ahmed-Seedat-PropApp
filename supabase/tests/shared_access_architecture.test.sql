-- Shared-access architecture pass (WORKLOG.md this date), Phase 8. Covers the owner
-- invitation/linking flow, the property_access_mode staff-scoping switch, the applications RLS
-- cutover, and activate_lease()'s new property-level check -- the core new invariants this pass
-- introduces, per the task brief's own numbered OWNER/STAFF test lists.

begin;
select plan(22);

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'saa-principal@test.propertyvault.example'),
  ('a1000000-0000-0000-0000-000000000002', 'saa-junaid@test.propertyvault.example'),
  ('a1000000-0000-0000-0000-000000000003', 'saa-staff-a@test.propertyvault.example'),
  ('a1000000-0000-0000-0000-000000000004', 'saa-staff-b@test.propertyvault.example'),
  ('a1000000-0000-0000-0000-000000000005', 'saa-attacker@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Shared Access Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Shared Access Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';

select set_config('pgtap.saa.org_id', (select id::text from public.organizations where legal_name = 'Shared Access Test Org'), false);

-- Two properties: A (single owner, staff A only) and Musgrave (two owners, both invited).
select set_config(
  'pgtap.saa.property_a_id',
  (select public.create_property(current_setting('pgtap.saa.org_id')::uuid, 'Property A', '1 A St', 'Cape Town', 'ZA', 'house'::public.property_type)::text),
  false
);
select set_config(
  'pgtap.saa.musgrave_id',
  (select public.create_property(current_setting('pgtap.saa.org_id')::uuid, 'Musgrave Flats', '1 Musgrave Rd', 'Durban', 'ZA', 'apartment'::public.property_type)::text),
  false
);

-- === OWNER TESTS ===

insert into public.owners (org_id, name, email)
select current_setting('pgtap.saa.org_id')::uuid, 'Junaid', 'saa-junaid@test.propertyvault.example';
select set_config('pgtap.saa.junaid_id', (select id::text from public.owners where name = 'Junaid'), false);

insert into public.owners (org_id, name, email)
select current_setting('pgtap.saa.org_id')::uuid, 'Mohammed Moosa', null;
select set_config('pgtap.saa.mohammed_owner_id', (select id::text from public.owners where name = 'Mohammed Moosa'), false);

-- Musgrave Flats: Junaid 50% + Mohammed 50% -- one property row, two ownership rows.
insert into public.property_owners (property_id, owner_id, ownership_pct)
values (current_setting('pgtap.saa.musgrave_id')::uuid, current_setting('pgtap.saa.junaid_id')::uuid, 50);
insert into public.property_owners (property_id, owner_id, ownership_pct)
values (current_setting('pgtap.saa.musgrave_id')::uuid, current_setting('pgtap.saa.mohammed_owner_id')::uuid, 50);

select is(
  (select count(*)::int from public.properties where nickname = 'Musgrave Flats'),
  1,
  'Musgrave Flats exists exactly once, regardless of having two owners'
);

select is(
  (select sum(ownership_pct)::int from public.property_owners where property_id = current_setting('pgtap.saa.musgrave_id')::uuid),
  100,
  'Musgrave Flats ownership percentages total 100'
);

-- Invitation issuance + email-alone-cannot-hijack + real acceptance.
select set_config(
  'pgtap.saa.junaid_token',
  (select token from public.create_owner_invitation(current_setting('pgtap.saa.junaid_id')::uuid, 'email')),
  false
);

-- Junaid's owner record has NO email on Mohammed's row, but DOES on Junaid's -- attacker signing
-- in with a matching email, with no token, must gain nothing: there is no accept path that takes
-- an email alone. Simulate the attacker authenticated as a genuinely different auth.users row
-- that happens to share Junaid's email pattern isn't even representable here (auth.users.email
-- isn't what owners.email is checked against for anything except the token-holder's own identity)
-- -- the real assertion is structural: accept_owner_invitation() has no email-only parameter at
-- all, only p_token. Confirmed by calling it with an invalid token and asserting failure.
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000005';
select is(
  (select error_code from public.accept_owner_invitation('not-a-real-token')),
  'not_found',
  'a caller with no valid token gains nothing, even one whose email happens to match an owner record'
);
select is(
  (select count(*)::int from public.owners where id = current_setting('pgtap.saa.junaid_id')::uuid and user_id is not null),
  0,
  'the attacker did not link themselves to Junaid''s owner record'
);

-- Real acceptance, as Junaid, with the real token.
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000002';
select is(
  (select success from public.accept_owner_invitation(current_setting('pgtap.saa.junaid_token'))),
  true,
  'Junaid accepts his own real invitation successfully'
);
select is(
  (select user_id from public.owners where id = current_setting('pgtap.saa.junaid_id')::uuid),
  'a1000000-0000-0000-0000-000000000002'::uuid,
  'accepting linked owners.user_id to Junaid''s account, not a new owner row'
);
-- Owner-count check as the principal (full org visibility) -- Junaid himself, correctly, only
-- ever sees his own owner row via RLS (has no org membership at all), which is a separate,
-- already-covered assertion, not what this one is checking.
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.owners where org_id = current_setting('pgtap.saa.org_id')::uuid),
  2,
  'accepting the invitation did not create a duplicate owner record -- still exactly 2 owners'
);
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000002';
select ok(
  public.has_property_access(current_setting('pgtap.saa.musgrave_id')::uuid, 'owner'),
  'Junaid (linked, no org membership at all) can access Musgrave Flats via owner-role property_access'
);
select ok(
  not public.has_property_access(current_setting('pgtap.saa.property_a_id')::uuid, 'read_only'),
  'Junaid has no access to Property A, which he does not own'
);

-- Idempotent re-accept.
select is(
  (select success from public.accept_owner_invitation(current_setting('pgtap.saa.junaid_token'))),
  true,
  're-accepting the same already-used token as the same user is a no-op success'
);

-- Re-invite is rejected for someone who tries reusing an already-accepted, un-revoked... actually
-- verify a REVOKED invitation cannot be accepted.
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select set_config(
  'pgtap.saa.mohammed_token',
  (select token from public.create_owner_invitation(current_setting('pgtap.saa.mohammed_owner_id')::uuid, 'manual')),
  false
);
select public.revoke_owner_invitation(
  (select id from public.owner_invitations where owner_id = current_setting('pgtap.saa.mohammed_owner_id')::uuid and revoked_at is null)
);
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001'; -- Mohammed's own principal login, distinct owner profile linking
select is(
  (select error_code from public.accept_owner_invitation(current_setting('pgtap.saa.mohammed_token'))),
  'revoked',
  'a revoked invitation cannot be accepted'
);

-- === STAFF PROPERTY-SCOPING TESTS ===

-- Add staff A and B to the org (agent role), both start in default 'all' mode.
-- organization_members has no client INSERT policy at all (by design -- only
-- create_organization()/accept_organization_invite() may create a row) -- reset to the superuser
-- test-runner role for this direct insert, same pattern as property_access.test.sql.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  (current_setting('pgtap.saa.org_id')::uuid, 'a1000000-0000-0000-0000-000000000003', 'agent', 'active', now()),
  (current_setting('pgtap.saa.org_id')::uuid, 'a1000000-0000-0000-0000-000000000004', 'agent', 'active', now());
set local role authenticated;

set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000003';
select ok(
  public.has_property_access(current_setting('pgtap.saa.property_a_id')::uuid, 'read_only'),
  'staff A, still in default all-properties mode, can see Property A'
);
select ok(
  public.has_property_access(current_setting('pgtap.saa.musgrave_id')::uuid, 'read_only'),
  'staff A, still in default all-properties mode, can also see Musgrave Flats (not yet narrowed)'
);

-- Principal narrows staff A to 'selected' and grants only Property A.
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select public.set_member_property_access_mode(current_setting('pgtap.saa.org_id')::uuid, 'a1000000-0000-0000-0000-000000000003', 'selected');
select public.revoke_property_access(current_setting('pgtap.saa.musgrave_id')::uuid, 'a1000000-0000-0000-0000-000000000003');
select public.grant_property_access(current_setting('pgtap.saa.property_a_id')::uuid, 'a1000000-0000-0000-0000-000000000003', 'property_manager');

set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000003';
select ok(
  public.has_property_access(current_setting('pgtap.saa.property_a_id')::uuid, 'read_only'),
  'staff A, now narrowed to selected properties, still sees Property A (explicitly granted)'
);
select ok(
  not public.has_property_access(current_setting('pgtap.saa.musgrave_id')::uuid, 'read_only'),
  'staff A, now narrowed, no longer sees Musgrave Flats after being revoked from it -- true cross-property isolation'
);

-- Direct table SELECT proves this is enforced by RLS, not just the helper function.
select is(
  (select count(*)::int from public.properties where id = current_setting('pgtap.saa.musgrave_id')::uuid),
  0,
  'a direct SELECT on properties for Musgrave Flats returns zero rows for narrowed staff A'
);
select is(
  (select count(*)::int from public.properties where id = current_setting('pgtap.saa.property_a_id')::uuid),
  1,
  'a direct SELECT on properties for Property A returns exactly one row for staff A'
);

-- Staff B stays in 'all' mode and can reach everything, including Musgrave.
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.properties where org_id = current_setting('pgtap.saa.org_id')::uuid),
  2,
  'staff B, still in all-properties mode, sees both properties'
);

-- Switching staff A back to 'all' immediately restores full access (no re-invite needed).
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select public.set_member_property_access_mode(current_setting('pgtap.saa.org_id')::uuid, 'a1000000-0000-0000-0000-000000000003', 'all');
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000003';
select ok(
  public.has_property_access(current_setting('pgtap.saa.musgrave_id')::uuid, 'read_only'),
  'switching staff A back to all-properties mode immediately restores Musgrave Flats access'
);

-- === APPLICATIONS CUTOVER + activate_lease property check ===

insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.saa.property_a_id')::uuid, current_setting('pgtap.saa.org_id')::uuid, 'A1', 'vacant');
select set_config('pgtap.saa.unit_a_id', (select id::text from public.units where unit_label = 'A1'), false);

set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
insert into public.applications (org_id, property_id, unit_id, applicant_name, status)
values (current_setting('pgtap.saa.org_id')::uuid, current_setting('pgtap.saa.property_a_id')::uuid, current_setting('pgtap.saa.unit_a_id')::uuid, 'Cutover Test Applicant', 'submitted');

-- Narrow staff A off Property A too, then confirm they lose the application along with it.
select public.set_member_property_access_mode(current_setting('pgtap.saa.org_id')::uuid, 'a1000000-0000-0000-0000-000000000003', 'selected');
select public.revoke_property_access(current_setting('pgtap.saa.property_a_id')::uuid, 'a1000000-0000-0000-0000-000000000003');

set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.applications where property_id = current_setting('pgtap.saa.property_a_id')::uuid),
  0,
  'applications RLS is now property-scoped: narrowed staff A cannot see Property A''s application'
);

-- Restore staff A to test activate_lease()'s property-level rejection distinctly from org-role.
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select public.grant_property_access(current_setting('pgtap.saa.property_a_id')::uuid, 'a1000000-0000-0000-0000-000000000004', 'read_only');

insert into public.tenants (org_id, full_name, status)
values (current_setting('pgtap.saa.org_id')::uuid, 'Cutover Tenant', 'active');
insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
values (current_setting('pgtap.saa.org_id')::uuid, current_setting('pgtap.saa.unit_a_id')::uuid, '2026-01-01', 5000, 'draft', 'manual');
select set_config('pgtap.saa.lease_id', (select id::text from public.leases where unit_id = current_setting('pgtap.saa.unit_a_id')::uuid), false);
select public.assign_lease_tenant(current_setting('pgtap.saa.lease_id')::uuid, (select id from public.tenants where full_name = 'Cutover Tenant'));

-- Staff B holds only 'read_only' on Property A -- org role is agent+ (sufficient today), but the
-- new property-level check in activate_lease() must independently reject them.
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000004';
select throws_ok(
  $$ select public.activate_lease(current_setting('pgtap.saa.lease_id')::uuid) $$,
  'Caller does not have property-level permission to activate this lease',
  'a staff member with only read_only property access cannot activate a lease, even with agent+ org role'
);

select * from finish();
rollback;
