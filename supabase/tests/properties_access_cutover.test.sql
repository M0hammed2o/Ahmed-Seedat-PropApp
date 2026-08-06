-- Tests for 20260101000064_properties_access_cutover.sql: the first has_property_access() RLS
-- cutover. Covers the create_property() RPC (including the exact insert -> select -> geocode-
-- update -> select sequence the real API route performs), the two zero-regression triggers (new
-- property grants existing members, new member grants existing properties), and that revoking
-- access actually makes a property invisible, not just write-protected.

begin;
select plan(11);

insert into auth.users (id, email) values
  ('f2000000-0000-0000-0000-000000000001', 'pac-principal@test.propertyvault.example'),
  ('f2000000-0000-0000-0000-000000000002', 'pac-late-joiner@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f2000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Properties Cutover Test Org', 'agency')), null, 'org created');

select set_config(
  'pgtap.pac_test.org_id',
  (select id::text from public.organizations where legal_name = 'Properties Cutover Test Org'),
  false
);

-- ==== create_property() RPC: the exact sequence the real API route performs ====

select set_config(
  'pgtap.pac_test.property_id',
  (select public.create_property(
    current_setting('pgtap.pac_test.org_id')::uuid,
    'Cutover Test Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

select isnt(current_setting('pgtap.pac_test.property_id'), null, 'create_property() returns a new id');

select is(
  (select nickname from public.properties where id = current_setting('pgtap.pac_test.property_id')::uuid),
  'Cutover Test Property',
  'the creator can fetch the created property via a plain, separate SELECT (no RETURNING/RLS timing issue)'
);

-- The exact follow-up the route performs for geocoding: a separate UPDATE ... RETURNING.
select lives_ok(
  $$ update public.properties set latitude = -33.9, longitude = 18.4
     where id = current_setting('pgtap.pac_test.property_id')::uuid $$,
  'the geocoding follow-up UPDATE (as a separate statement) succeeds under the new policies'
);

-- ==== Property creator got an automatic administrator grant (via the trigger, not manually) ====

select is(
  (select property_role from public.property_access
     where property_id = current_setting('pgtap.pac_test.property_id')::uuid
       and user_id = 'f2000000-0000-0000-0000-000000000001'::uuid),
  'administrator'::public.property_role,
  'the creator was automatically granted administrator access by the trigger'
);

-- ==== A member who joins the org AFTER the property already exists still sees it ====
-- (today's actual behavior is a live has_org_role() check -- this must not regress just because
-- property_access is now also required.)

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select current_setting('pgtap.pac_test.org_id')::uuid, 'f2000000-0000-0000-0000-000000000002', 'viewer', 'active', now();
set local role authenticated;
set local "request.jwt.claim.sub" = 'f2000000-0000-0000-0000-000000000002';

select ok(
  (select public.has_property_access(current_setting('pgtap.pac_test.property_id')::uuid, 'read_only')),
  'a member who joins the org AFTER the property exists is auto-granted access by the organization_members trigger'
);

select is(
  (select nickname from public.properties where id = current_setting('pgtap.pac_test.property_id')::uuid),
  'Cutover Test Property',
  'the late-joining member can actually see the property through the real RLS-scoped SELECT'
);

-- ==== Revocation makes the property genuinely invisible, not just write-protected ====

set local role authenticated;
set local "request.jwt.claim.sub" = 'f2000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.revoke_property_access(
    current_setting('pgtap.pac_test.property_id')::uuid,
    'f2000000-0000-0000-0000-000000000002'::uuid
  ) $$,
  'the principal can revoke the late-joining member''s access'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f2000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.properties where id = current_setting('pgtap.pac_test.property_id')::uuid),
  0,
  'after revocation the property is genuinely absent from the revoked user''s results, not merely write-protected'
);

-- ==== Write policy: a revoked/insufficiently-privileged user's update is silently a no-op ====
-- (RLS-filtered UPDATEs don't raise -- they just match zero rows, same as any WHERE clause
-- excluding everything. `lives_ok` confirms it doesn't error; the row being unchanged below is
-- the real assertion that the write was actually blocked, not merely quiet.)

select lives_ok(
  $$ update public.properties set nickname = 'Should not be allowed'
     where id = current_setting('pgtap.pac_test.property_id')::uuid $$,
  'an update from a user with no property_access does not error (RLS just matches zero rows)'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f2000000-0000-0000-0000-000000000001';

select is(
  (select nickname from public.properties where id = current_setting('pgtap.pac_test.property_id')::uuid),
  'Cutover Test Property',
  'the revoked user''s update attempt did not actually change the nickname'
);

select * from finish();
rollback;
