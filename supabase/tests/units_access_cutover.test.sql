-- Tests for 20260101000065_units_access_cutover.sql: units gated on has_property_access(), no
-- bootstrapping problem (verified empirically before this migration was written -- the parent
-- property, and the creator's grant on it, always already exists).

begin;
select plan(6);

insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001', 'uac-principal@test.propertyvault.example'),
  ('f3000000-0000-0000-0000-000000000002', 'uac-outsider@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f3000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Units Cutover Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Units Cutover Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f3000000-0000-0000-0000-000000000001';

select set_config(
  'pgtap.uac_test.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Units Cutover Test Org'),
    'Units Cutover Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

-- Exact API route sequence: insert ... select ... single()
select lives_ok(
  $$ insert into public.units (property_id, org_id, unit_label, status)
     select current_setting('pgtap.uac_test.property_id')::uuid, id, 'U1', 'vacant'
     from public.organizations where legal_name = 'Units Cutover Test Org' $$,
  'the property owner can create a unit under it (no bootstrapping problem, verified)'
);

select set_config(
  'pgtap.uac_test.unit_id',
  (select id::text from public.units where unit_label = 'U1'),
  false
);

select is(
  (select unit_label from public.units where id = current_setting('pgtap.uac_test.unit_id')::uuid),
  'U1',
  'the creator can fetch the unit via a plain, separate SELECT'
);

-- A total outsider (no org membership at all) cannot see it -- units_select_org_member_and_
-- property_access requires BOTH has_org_role() and has_property_access(); property_access alone
-- (the future Owner Portal path, Phase 5, not built yet) is not sufficient in THIS pass.
set local role authenticated;
set local "request.jwt.claim.sub" = 'f3000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.units where id = current_setting('pgtap.uac_test.unit_id')::uuid),
  0,
  'a total outsider (no org membership) cannot see the unit'
);

-- The realistic scenario this feature exists for: a coworker joins the SAME org (auto-granted
-- administrator on every existing property by grant_new_member_property_access_trigger, same
-- zero-regression behavior as properties itself) -- confirm that grant correctly cascades to
-- units too, then confirm revoking it removes unit visibility as well, even though the coworker
-- remains an active org member throughout.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'f3000000-0000-0000-0000-000000000002', 'viewer', 'active', now()
from public.organizations where legal_name = 'Units Cutover Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'f3000000-0000-0000-0000-000000000002';

select is(
  (select unit_label from public.units where id = current_setting('pgtap.uac_test.unit_id')::uuid),
  'U1',
  'a coworker who joins the org is auto-granted property access that correctly cascades to units'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f3000000-0000-0000-0000-000000000001';

select public.revoke_property_access(
  current_setting('pgtap.uac_test.property_id')::uuid,
  'f3000000-0000-0000-0000-000000000002'::uuid
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f3000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.units where id = current_setting('pgtap.uac_test.unit_id')::uuid),
  0,
  'revoking property access removes unit visibility too, even though org membership is unchanged'
);

select * from finish();
rollback;
