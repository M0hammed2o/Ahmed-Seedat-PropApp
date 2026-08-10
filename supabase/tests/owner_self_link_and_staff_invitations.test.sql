-- Owner + staff access completion pass (WORKLOG.md this date). Covers the two reported
-- workflow gaps end to end: link_owner_to_self() (20260101000088) and the
-- property-scoped staff invitation flow (20260101000089/090), plus the Principal
-- all-properties safety guard and staff removal. Numbered comments match the task brief's own
-- OWNER (1-11) / STAFF (12-23) test lists.

begin;
select plan(21);

insert into auth.users (id, email) values
  ('d4000000-0000-0000-0000-000000000001', 'osl-mohammed@test.propertyvault.example'),
  ('d4000000-0000-0000-0000-000000000002', 'osl-junaid@test.propertyvault.example'),
  ('d4000000-0000-0000-0000-000000000003', 'osl-attacker@test.propertyvault.example'),
  ('d4000000-0000-0000-0000-000000000004', 'osl-staffA@test.propertyvault.example'),
  ('d4000000-0000-0000-0000-000000000005', 'osl-other-principal@test.propertyvault.example'),
  ('d4000000-0000-0000-0000-000000000006', 'osl-manager@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Owner Self-Link Test Org', 'agency')), null, 'org created');
select set_config('pgtap.osl.org_id', (select id::text from public.organizations where legal_name = 'Owner Self-Link Test Org'), false);

select set_config(
  'pgtap.osl.musgrave_id',
  (select public.create_property(current_setting('pgtap.osl.org_id')::uuid, 'Musgrave Flats', '1 Musgrave Rd', 'Durban', 'ZA', 'apartment'::public.property_type)::text),
  false
);
select set_config(
  'pgtap.osl.property3_id',
  (select public.create_property(current_setting('pgtap.osl.org_id')::uuid, 'Property 3', '3 Third St', 'Durban', 'ZA', 'house'::public.property_type)::text),
  false
);

-- Mohammed's own owner row: created by the Principal setting up ownership, no email on file --
-- exactly the reported bug's real shape.
insert into public.owners (org_id, name, email) values (current_setting('pgtap.osl.org_id')::uuid, 'Mohammed Moosa', null);
select set_config('pgtap.osl.mohammed_owner_id', (select id::text from public.owners where name = 'Mohammed Moosa'), false);
-- Junaid's owner row: has an email on file (the normal invitation path).
insert into public.owners (org_id, name, email) values (current_setting('pgtap.osl.org_id')::uuid, 'Junaid', 'osl-junaid@test.propertyvault.example');
select set_config('pgtap.osl.junaid_owner_id', (select id::text from public.owners where name = 'Junaid'), false);

insert into public.property_owners (property_id, owner_id, ownership_pct)
values (current_setting('pgtap.osl.musgrave_id')::uuid, current_setting('pgtap.osl.mohammed_owner_id')::uuid, 50);
insert into public.property_owners (property_id, owner_id, ownership_pct)
values (current_setting('pgtap.osl.musgrave_id')::uuid, current_setting('pgtap.osl.junaid_owner_id')::uuid, 50);

-- === OWNER 1/2: Mohammed deliberately links his own valid owner profile ===
select is(
  (select success from public.link_owner_to_self(current_setting('pgtap.osl.mohammed_owner_id')::uuid)),
  true,
  '1: Mohammed deliberately links his own owner profile'
);
select is(
  (select user_id from public.owners where id = current_setting('pgtap.osl.mohammed_owner_id')::uuid),
  'd4000000-0000-0000-0000-000000000001'::uuid,
  '2: the owner profile is now linked to Mohammed''s user id'
);
-- (3/4 are UI-rendering assertions -- OwnerAccountStatus's hasAccount branch and the Invite-vs-
-- "This is me" mutual exclusivity -- not independently expressible as a database assertion here.)

-- === OWNER 5: Mohammed cannot claim Junaid's owner record (different email on file) ===
select is(
  (select error_code from public.link_owner_to_self(current_setting('pgtap.osl.junaid_owner_id')::uuid)),
  'email_mismatch',
  '5: Mohammed cannot claim Junaid''s owner record -- its on-file email does not match his own'
);

-- === OWNER 6/7: another user cannot claim Mohammed's now-linked owner record ===
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values (current_setting('pgtap.osl.org_id')::uuid, 'd4000000-0000-0000-0000-000000000003', 'manager', 'active', now());
set local role authenticated;
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000003';
select is(
  (select error_code from public.link_owner_to_self(current_setting('pgtap.osl.mohammed_owner_id')::uuid)),
  'already_linked',
  '6/7: a second, different manager-role user cannot claim Mohammed''s already-linked owner record'
);

-- === OWNER 8/9: Junaid's normal invitation still works, and he sees the same canonical property ===
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000001';
select set_config(
  'pgtap.osl.junaid_token',
  (select token from public.create_owner_invitation(current_setting('pgtap.osl.junaid_owner_id')::uuid, 'email')),
  false
);
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000002';
select is(
  (select success from public.accept_owner_invitation(current_setting('pgtap.osl.junaid_token'))),
  true,
  '8: Junaid''s normal owner invitation is accepted successfully'
);
select ok(
  public.has_property_access(current_setting('pgtap.osl.musgrave_id')::uuid, 'owner'),
  '9: after accepting, Junaid can access the same canonical Musgrave Flats property'
);

-- === OWNER 10/11: no duplicate property or ownership rows were created by any of the above ===
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.properties where nickname = 'Musgrave Flats' and org_id = current_setting('pgtap.osl.org_id')::uuid),
  1,
  '10: Musgrave Flats still exists exactly once'
);
select is(
  (select count(*)::int from public.property_owners where property_id = current_setting('pgtap.osl.musgrave_id')::uuid),
  2,
  '11: exactly two ownership rows (Mohammed + Junaid), no duplicates'
);

-- === STAFF 12/13: Principal can invite staff; the pending invitation is visible ===
insert into public.organization_invites (org_id, email, role, invited_by, invitee_name, property_access_mode)
values (current_setting('pgtap.osl.org_id')::uuid, 'osl-staffA@test.propertyvault.example', 'agent', 'd4000000-0000-0000-0000-000000000001', 'Staff A', 'selected')
returning id;
select set_config('pgtap.osl.staffA_invite_id', (select id::text from public.organization_invites where email = 'osl-staffa@test.propertyvault.example'), false);
-- Captured now, while still authenticated as the inviting manager -- organization_invites' own
-- SELECT policy (organization_invites_select_same_org) requires org membership, which the
-- accepting user deliberately does not have yet, so they could never read this back themselves.
select set_config('pgtap.osl.staffA_token', (select token::text from public.organization_invites where id = current_setting('pgtap.osl.staffA_invite_id')::uuid), false);
insert into public.organization_invite_properties (invite_id, property_id, property_role)
values (current_setting('pgtap.osl.staffA_invite_id')::uuid, current_setting('pgtap.osl.musgrave_id')::uuid, 'property_manager');
select is(
  (select count(*)::int from public.organization_invites where org_id = current_setting('pgtap.osl.org_id')::uuid and accepted_at is null and revoked_at is null),
  1,
  '12/13: the Principal''s staff invitation exists and is visible as pending'
);

-- === STAFF 14/15/16: an authenticated user (whether pre-existing or freshly "registered") accepts securely, membership gets the configured role ===
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000004';
select is(
  (select public.accept_organization_invite(current_setting('pgtap.osl.staffA_token')::uuid)),
  current_setting('pgtap.osl.org_id')::uuid,
  '14/15: Staff A (an already-existing auth.users row, standing in for either "already has Proplyst" or "just registered" -- both paths converge on the same accept RPC) accepts securely'
);
select is(
  (select role from public.organization_members where org_id = current_setting('pgtap.osl.org_id')::uuid and user_id = 'd4000000-0000-0000-0000-000000000004'),
  'agent'::public.organization_member_role,
  '16: Staff A''s membership received exactly the role configured at invite time'
);

-- === STAFF 18/19/20: SELECTED_PROPERTIES staff sees only selected properties; direct access to an unassigned property (and its related resources) fails ===
select ok(
  public.has_property_access(current_setting('pgtap.osl.musgrave_id')::uuid, 'property_manager'),
  '18: Staff A (selected mode, granted Musgrave Flats) can access Musgrave Flats'
);
select is(
  (select count(*)::int from public.properties where id = current_setting('pgtap.osl.property3_id')::uuid),
  0,
  '19: Staff A cannot open Property 3 (not in their selected set) by direct query -- same as a direct URL hit'
);
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000001';
insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.osl.property3_id')::uuid, current_setting('pgtap.osl.org_id')::uuid, 'P3-1', 'vacant');
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.units where property_id = current_setting('pgtap.osl.property3_id')::uuid),
  0,
  '20: related resources (units) under the unassigned property are also denied to Staff A'
);

-- === STAFF 17: an ALL_PROPERTIES staff member sees every permitted organization property ===
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values (current_setting('pgtap.osl.org_id')::uuid, 'd4000000-0000-0000-0000-000000000006', 'agent', 'active', now());
set local role authenticated;
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000006';
select is(
  (select count(*)::int from public.properties where org_id = current_setting('pgtap.osl.org_id')::uuid),
  2,
  '17: an all-properties-mode staff member sees both organization properties (Musgrave Flats + Property 3)'
);

-- === STAFF 21: the Principal cannot accidentally lose required administrative access ===
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select public.set_member_property_access_mode(current_setting('pgtap.osl.org_id')::uuid, 'd4000000-0000-0000-0000-000000000001', 'selected') $$,
  'A Principal always retains all-properties access and cannot be restricted to selected properties',
  '21: the Principal cannot be narrowed to selected-properties mode, by themselves or anyone else'
);

-- === STAFF 22: revoked/removed staff loses access ===
select public.revoke_organization_member(current_setting('pgtap.osl.org_id')::uuid, 'd4000000-0000-0000-0000-000000000004');
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.properties where id = current_setting('pgtap.osl.musgrave_id')::uuid),
  0,
  '22: a revoked staff member immediately loses access to a property they used to be granted'
);

-- === STAFF 23: cross-organization invitation acceptance fails ===
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000005';
select throws_ok(
  $$ select public.accept_organization_invite(gen_random_uuid()) $$,
  'Invite not found, expired, or does not match the signed-in user''s email',
  '23: a token with no matching pending invite for the caller''s own email is rejected outright'
);

-- === REGRESSION 24: multiple-owner percentages remain correct after all of the above ===
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000001';
select is(
  (select sum(ownership_pct)::int from public.property_owners where property_id = current_setting('pgtap.osl.musgrave_id')::uuid),
  100,
  '24: Musgrave Flats ownership percentages still total exactly 100'
);

-- === REGRESSION 25: maintenance tickets still work (unit-aware, from the prior pass) ===
insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.osl.musgrave_id')::uuid, current_setting('pgtap.osl.org_id')::uuid, '601', 'vacant');
select set_config('pgtap.osl.unit601_id', (select id::text from public.units where unit_label = '601'), false);
insert into public.maintenance_tickets (org_id, property_id, unit_id, submitted_by_user_id, summary)
values (current_setting('pgtap.osl.org_id')::uuid, current_setting('pgtap.osl.musgrave_id')::uuid, current_setting('pgtap.osl.unit601_id')::uuid, 'd4000000-0000-0000-0000-000000000001', 'Regression check ticket');
select is(
  (select unit_id from public.maintenance_tickets where summary = 'Regression check ticket'),
  current_setting('pgtap.osl.unit601_id')::uuid,
  '25: unit-aware maintenance tickets still work'
);

select * from finish();
rollback;
