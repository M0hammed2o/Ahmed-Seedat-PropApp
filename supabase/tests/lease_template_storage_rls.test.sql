-- Lease-template storage RLS (WORKLOG.md 2026-08-25, updated 2026-09-14 for migration
-- 20260101000171). A lease-template storage object (`{org_id}/lease-templates/{uuid}.ext`, no
-- property, no `documents` row) is read (SELECT) by any org viewer+, matching
-- `lease_templates_select_org_member` -- 20260101000130 fixed that branch, which before then matched
-- no one (and INSERT threw `invalid input syntax for type uuid: "lease-templates"`).
--
-- Since 20260101000171 NO client can write storage.objects at all: uploads go client -> Proplyst API
-- -> malware scan -> service-role Storage write (apps/admin/lib/protectedStorage.ts). So this file
-- proves every client role, manager+ included, is refused a direct INSERT or UPDATE, and tests the
-- read policy against an object created the way the server creates it -- as service_role -- rather
-- than one a client uploaded. Same direct-SQL-against-storage.objects technique as
-- storage_property_scoping.test.sql / property_photo_derivative_storage_rls.test.sql.

begin;
select plan(13);

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

-- === No client role can upload (INSERT) into the lease-templates path directly -- not even manager+ ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.lt.org_id') || '/lease-templates/manager-attempt.docx', 'b4000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'a manager cannot upload directly into the lease-templates path -- uploads are server-only (20260101000171)'
);

set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.lt.org_id') || '/lease-templates/principal-attempt.docx', 'b4000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'the org principal (highest org role) cannot upload directly into the lease-templates path either'
);

set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000003';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.lt.org_id') || '/lease-templates/agent-attempt.docx', 'b4000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'an agent (below manager) cannot upload into the lease-templates path shape'
);

set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000004';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.lt.org_id') || '/lease-templates/cross-org-attempt.docx', 'b4000000-0000-0000-0000-000000000004') $$,
  '42501',
  null,
  'a principal of a different org cannot upload into this org''s lease-templates path'
);

-- === The legitimate path: the server writes the object with the service role ===
reset role;
set local role service_role;
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('documents', current_setting('pgtap.lt.path')) $$,
  'the server (service_role) can write the lease-template object, as the lease-templates API route does'
);
reset role;

-- The route then records the template through the manager's own session
-- (lease_templates_insert_manager_plus).
set local role authenticated;
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000002';
insert into public.lease_templates (org_id, name, storage_path, original_file_name, mime_type, file_size_bytes, created_by)
values (current_setting('pgtap.lt.org_id')::uuid, 'RLS Test Template', current_setting('pgtap.lt.path'), 'template.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1024, 'b4000000-0000-0000-0000-000000000002');

-- === Read (SELECT) of the server-created object: viewer+ in the org, no one else ===
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.lt.path')),
  1,
  'a manager can read the server-created lease-template storage object'
);

set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.lt.path')),
  1,
  'an org agent (viewer+ but below manager) can read the server-created lease-template storage object'
);

set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.lt.path')),
  0,
  'a principal of a different org cannot read this org''s lease-template storage object'
);

reset role;
set local role anon;
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.lt.path')),
  0,
  'an unauthenticated (anon) request cannot read the lease-template storage object'
);
reset role;

-- === A manager who CAN read the object still cannot replace (UPDATE) it ===
-- With no UPDATE policy the row is simply not updatable by the client: the statement affects zero
-- rows rather than raising, so the proof is that the stored row is unchanged afterwards.
set local role authenticated;
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000002';
update storage.objects
   set metadata = jsonb_build_object('replaced_by_client', true)
 where bucket_id = 'documents' and name = current_setting('pgtap.lt.path');
reset role;
select is(
  (select coalesce(metadata ->> 'replaced_by_client', 'unchanged') from storage.objects where name = current_setting('pgtap.lt.path')),
  'unchanged',
  'a manager with read access cannot replace (UPDATE) the lease-template storage object'
);

-- === An unassigned agent still cannot upload against a real property path ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000003';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.lt.org_id') || '/' || gen_random_uuid()::text || '/unrelated-attempt.pdf', 'b4000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'an agent cannot upload directly against a property path'
);

select * from finish();
rollback;
