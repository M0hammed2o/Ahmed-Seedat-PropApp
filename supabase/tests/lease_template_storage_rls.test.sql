-- Lease-template storage RLS audit (WORKLOG.md 2026-08-25): proves the fix in
-- 20260101000130 -- a lease-template storage object (`{org_id}/lease-templates/{uuid}.ext`, no
-- property, no `documents` row) can be uploaded (INSERT) only by manager+ org members, matching
-- `lease_templates_insert_manager_plus`, and read (SELECT) by any org viewer+, matching
-- `lease_templates_select_org_member` -- and that the pre-existing property-scoped INSERT/SELECT
-- branches are untouched. Before this fix, INSERT threw (not just denied) with
-- `invalid input syntax for type uuid: "lease-templates"` for every caller, and SELECT matched no
-- branch for anyone. Same direct-SQL-against-storage.objects technique as
-- storage_property_scoping.test.sql / property_photo_derivative_storage_rls.test.sql.

begin;
select plan(10);

insert into auth.users (id, email) values
  ('b4000000-0000-0000-0000-000000000001', 'lt-principal@test.propertyvault.example'),
  ('b4000000-0000-0000-0000-000000000002', 'lt-manager@test.propertyvault.example'),
  ('b4000000-0000-0000-0000-000000000003', 'lt-agent@test.propertyvault.example'),
  ('b4000000-0000-0000-0000-000000000004', 'lt-other-org-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Lease Template Storage RLS Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Lease Template Storage RLS Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000001';
select set_config('pgtap.lt.org_id', (select id::text from public.organizations where legal_name = 'Lease Template Storage RLS Test Org'), false);

set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000004';
select isnt((select public.create_organization('Lease Template Storage RLS Other Org', 'agency')), null, 'other org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Lease Template Storage RLS Other Org'));

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode)
values
  (current_setting('pgtap.lt.org_id')::uuid, 'b4000000-0000-0000-0000-000000000002', 'manager', 'active', now(), 'all'),
  (current_setting('pgtap.lt.org_id')::uuid, 'b4000000-0000-0000-0000-000000000003', 'agent', 'active', now(), 'all');

select set_config('pgtap.lt.path', current_setting('pgtap.lt.org_id') || '/lease-templates/template-uuid.docx', false);

-- === Manager can upload (INSERT) a lease-template-shaped path -- was a hard uuid-cast error before the fix ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000002';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.lt.path'), 'b4000000-0000-0000-0000-000000000002') $$,
  'a manager can upload into the lease-templates path shape (no more uuid-cast throw on "lease-templates")'
);

insert into public.lease_templates (org_id, name, storage_path, original_file_name, mime_type, file_size_bytes, created_by)
values (current_setting('pgtap.lt.org_id')::uuid, 'RLS Test Template', current_setting('pgtap.lt.path'), 'template.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1024, 'b4000000-0000-0000-0000-000000000002');

-- === Agent (below manager) is denied INSERT into the same path shape ===
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000003';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.lt.org_id') || '/lease-templates/agent-attempt.docx', 'b4000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'an agent (below manager) cannot upload into the lease-templates path shape'
);

-- === Cross-org manager is denied INSERT ===
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000004';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.lt.org_id') || '/lease-templates/cross-org-attempt.docx', 'b4000000-0000-0000-0000-000000000004') $$,
  '42501',
  null,
  'a principal of a different org cannot upload into this org''s lease-templates path'
);

-- === Manager (viewer+) can read the template back (SELECT) -- previously matched no branch at all ===
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.lt.path')),
  1,
  'the uploading manager can read the lease-template storage object back'
);

-- === Agent (viewer+, below manager) can still read it -- read access is viewer+, only write is manager+ ===
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.lt.path')),
  1,
  'an org agent (viewer+ but below manager) can read the lease-template storage object'
);

-- === Cross-org principal is denied SELECT ===
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.lt.path')),
  0,
  'a principal of a different org cannot read this org''s lease-template storage object'
);

-- === Unauthenticated (anon) is denied SELECT ===
reset role;
set local role anon;
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.lt.path')),
  0,
  'an unauthenticated (anon) request cannot read the lease-template storage object'
);
reset role;

-- === The fix does not weaken the pre-existing property-scoped branch: unrelated agent with zero
-- property grants still cannot upload into a real property path ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000003';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.lt.org_id') || '/' || gen_random_uuid()::text || '/unrelated-attempt.pdf', 'b4000000-0000-0000-0000-000000000003') $$,
  null,
  null,
  'the pre-existing property-scoped INSERT branch is untouched -- an unassigned agent still cannot upload against a property path'
);

select * from finish();
rollback;
