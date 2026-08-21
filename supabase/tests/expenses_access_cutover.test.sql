-- Tests for 20260101000068_expenses_access_cutover.sql: expenses gated on has_property_access()
-- via its direct property_id column, with an 'accountant'-flavored write gate (matching the
-- table's own pre-existing org-role choice). No bootstrapping problem (verified empirically
-- before this migration was written).

begin;
select plan(5);

insert into auth.users (id, email) values
  ('f6000000-0000-0000-0000-000000000001', 'eac-principal@test.propertyvault.example'),
  ('f6000000-0000-0000-0000-000000000002', 'eac-coworker@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Expenses Cutover Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Expenses Cutover Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000001';

select set_config(
  'pgtap.eac_test.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Expenses Cutover Test Org'),
    'Expenses Cutover Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

-- Exact API route sequence: insert ... select ... single() (principal counts as accountant+ via
-- has_org_role ranking, same reasoning owner_statements.test.sql documents)
select lives_ok(
  $$ insert into public.expenses (org_id, property_id, category, amount, status)
     select id, current_setting('pgtap.eac_test.property_id')::uuid, 'maintenance', 500, 'pending'
     from public.organizations where legal_name = 'Expenses Cutover Test Org' $$,
  'the property owner (principal, accountant+ by role ranking) can create an expense (no bootstrapping problem, verified)'
);

select is(
  (select category from public.expenses where property_id = current_setting('pgtap.eac_test.property_id')::uuid),
  'maintenance',
  'the creator can fetch the expense via a plain, separate SELECT'
);

-- A coworker who joins the org is auto-granted access (zero-regression trigger); revoking removes it.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'f6000000-0000-0000-0000-000000000002', 'viewer', 'active', now()
from public.organizations where legal_name = 'Expenses Cutover Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.expenses where property_id = current_setting('pgtap.eac_test.property_id')::uuid),
  1,
  'a coworker who joins the org is auto-granted access that cascades to expenses'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000001';

select public.revoke_property_access(
  current_setting('pgtap.eac_test.property_id')::uuid,
  'f6000000-0000-0000-0000-000000000002'::uuid
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.expenses where property_id = current_setting('pgtap.eac_test.property_id')::uuid),
  0,
  'revoking property access removes expense visibility too'
);

select * from finish();
rollback;
