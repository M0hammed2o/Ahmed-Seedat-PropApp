-- Storage path ownership (migration 20260101000172, 2026-09-14).
--
-- A protected Storage path must sit inside the organisation of the row that references it. Before
-- 172 a principal of organisation A could point a documents row at organisation B's object and read
-- B's bytes (the Storage SELECT policies trust any visible row that names an object). This file
-- proves:
--   1. public.storage_path_in_org() accepts and rejects exactly the cases the application's
--      isStoragePathInOrg() does (apps/admin/lib/__tests__/protectedStorage.test.ts -- keep in step);
--   2. no forged documents / lease_documents / lease_templates / property_photos row can be written
--      or updated to reference another organisation's path -- by a principal, or even the service role;
--   3. same-organisation rows still write, and organisation A still cannot read B's object.

begin;
select plan(42);

-- === 1. The rule itself ======================================================================

select ok(public.storage_path_in_org('11111111-1111-4111-8111-111111111111', v.path), 'accepts ' || v.label)
from (values
  ('a property document', '11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/file.pdf'),
  ('a lease template', '11111111-1111-4111-8111-111111111111/lease-templates/template.docx'),
  ('a file directly in the org folder', '11111111-1111-4111-8111-111111111111/file.pdf'),
  ('a dotted file name', '11111111-1111-4111-8111-111111111111/property/photo.hero.webp')
) as v(label, path);

select ok(not public.storage_path_in_org('11111111-1111-4111-8111-111111111111', v.path), 'rejects ' || v.label)
from (values
  ('another organisation', '22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/file.pdf'),
  ('the org id without a "/" boundary', '11111111-1111-4111-8111-111111111111evil/property/file.pdf'),
  ('a leading traversal', '../11111111-1111-4111-8111-111111111111/file.pdf'),
  ('a traversal inside the path', '11111111-1111-4111-8111-111111111111/../22222222-2222-4222-8222-222222222222/file.pdf'),
  ('a "." segment', '11111111-1111-4111-8111-111111111111/./file.pdf'),
  ('no organisation prefix', 'file.pdf'),
  ('only the organisation folder', '11111111-1111-4111-8111-111111111111/'),
  ('the bare organisation id', '11111111-1111-4111-8111-111111111111'),
  ('a leading slash', '/11111111-1111-4111-8111-111111111111/file.pdf'),
  ('an empty segment', '11111111-1111-4111-8111-111111111111//file.pdf'),
  ('a trailing slash', '11111111-1111-4111-8111-111111111111/property/'),
  ('a backslash', '11111111-1111-4111-8111-111111111111/..' || chr(92) || '22222222-2222-4222-8222-222222222222/file.pdf'),
  ('a percent-encoded dot', '11111111-1111-4111-8111-111111111111/%2e%2e/22222222-2222-4222-8222-222222222222/file.pdf'),
  ('a percent-encoded slash', '11111111-1111-4111-8111-111111111111%2F..%2F22222222-2222-4222-8222-222222222222/file.pdf'),
  ('a percent-encoded backslash', '11111111-1111-4111-8111-111111111111/%5c22222222-2222-4222-8222-222222222222/file.pdf'),
  ('a control character', '11111111-1111-4111-8111-111111111111/file' || chr(1) || '.pdf'),
  ('an empty path', '')
) as v(label, path);

select ok(not public.storage_path_in_org(null, '11111111-1111-4111-8111-111111111111/property/file.pdf'), 'rejects a null organisation');
select ok(not public.storage_path_in_org('11111111-1111-4111-8111-111111111111', null), 'rejects a null path');

-- === Fixtures: organisation A (principal A) with a property, unit and lease; organisation B with an object

insert into auth.users (id, email) values
  ('b5000000-0000-0000-0000-000000000001', 'spo-principal-a@test.propertyvault.example'),
  ('b5000000-0000-0000-0000-000000000002', 'spo-principal-b@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select isnt((select public.create_organization('Storage Path Ownership Org A', 'agency')), null, 'org A created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Storage Path Ownership Org A'));
select set_config('pgtap.spo.org_a', (select id::text from public.organizations where legal_name = 'Storage Path Ownership Org A'), false);

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000002';
select isnt((select public.create_organization('Storage Path Ownership Org B', 'agency')), null, 'org B created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Storage Path Ownership Org B'));
select set_config('pgtap.spo.org_b', (select id::text from public.organizations where legal_name = 'Storage Path Ownership Org B'), false);

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select set_config('pgtap.spo.property_a', (select public.create_property(current_setting('pgtap.spo.org_a')::uuid, 'SPO Property A', '1 A St', 'Cape Town', 'ZA', 'house'::public.property_type)::text), false);
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000002';
select set_config('pgtap.spo.property_b', (select public.create_property(current_setting('pgtap.spo.org_b')::uuid, 'SPO Property B', '2 B St', 'Cape Town', 'ZA', 'house'::public.property_type)::text), false);

set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select set_config('pgtap.spo.category', (select id::text from public.document_categories limit 1), false);
insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.spo.property_a')::uuid, current_setting('pgtap.spo.org_a')::uuid, 'SPO A1', 'vacant');
insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
values (current_setting('pgtap.spo.org_a')::uuid, (select id from public.units where unit_label = 'SPO A1'), '2026-01-01', 5000, 'draft', 'manual');
select set_config('pgtap.spo.lease_a', (select id::text from public.leases where unit_id = (select id from public.units where unit_label = 'SPO A1')), false);

select set_config('pgtap.spo.own_path', current_setting('pgtap.spo.org_a') || '/' || current_setting('pgtap.spo.property_a') || '/own.pdf', false);
select set_config('pgtap.spo.foreign_path', current_setting('pgtap.spo.org_b') || '/' || current_setting('pgtap.spo.property_b') || '/secret.pdf', false);

-- Organisation B's object and its own, legitimate documents row -- written as the server writes them.
reset role;
set local role service_role;
insert into storage.objects (bucket_id, name) values ('documents', current_setting('pgtap.spo.foreign_path'));
insert into public.documents (org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values (current_setting('pgtap.spo.org_b')::uuid, current_setting('pgtap.spo.property_b')::uuid, current_setting('pgtap.spo.category')::uuid,
        'other', current_setting('pgtap.spo.foreign_path'), 'secret.pdf', 'application/pdf', 100, 'checksum-b');
reset role;

-- === 2. documents: the exploit, and its variations ============================================

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ insert into public.documents (org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
     values (current_setting('pgtap.spo.org_a')::uuid, current_setting('pgtap.spo.property_a')::uuid, current_setting('pgtap.spo.category')::uuid,
             'other', current_setting('pgtap.spo.foreign_path') || '.forged', 'forged.pdf', 'application/pdf', 100, 'x') $$,
  '23514', null,
  'THE EXPLOIT: principal A cannot insert a documents row in A that points at organisation B''s path'
);

select throws_ok(
  $$ insert into public.documents (org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
     values (current_setting('pgtap.spo.org_a')::uuid, current_setting('pgtap.spo.property_a')::uuid, current_setting('pgtap.spo.category')::uuid,
             'other', current_setting('pgtap.spo.org_a') || '/../' || current_setting('pgtap.spo.foreign_path'), 'forged.pdf', 'application/pdf', 100, 'x') $$,
  '23514', null,
  'a traversal path through A''s folder into B''s is refused'
);

select throws_ok(
  $$ insert into public.documents (org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
     values (current_setting('pgtap.spo.org_a')::uuid, current_setting('pgtap.spo.property_a')::uuid, current_setting('pgtap.spo.category')::uuid,
             'other', current_setting('pgtap.spo.org_a') || 'evil/' || current_setting('pgtap.spo.property_a') || '/x.pdf', 'forged.pdf', 'application/pdf', 100, 'x') $$,
  '23514', null,
  'a path whose first segment only starts with A''s id is refused'
);

select lives_ok(
  $$ insert into public.documents (org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
     values (current_setting('pgtap.spo.org_a')::uuid, current_setting('pgtap.spo.property_a')::uuid, current_setting('pgtap.spo.category')::uuid,
             'other', current_setting('pgtap.spo.own_path'), 'own.pdf', 'application/pdf', 100, 'own') $$,
  'a documents row inside A''s own folder is still accepted'
);

select throws_ok(
  $$ update public.documents set storage_path = current_setting('pgtap.spo.foreign_path') || '.forged'
      where storage_path = current_setting('pgtap.spo.own_path') $$,
  '23514', null,
  'principal A cannot UPDATE their own documents row to point at organisation B''s path'
);

-- Even the service role -- and so any SECURITY DEFINER function such as record_application_document_upload()
reset role;
set local role service_role;
select throws_ok(
  $$ insert into public.documents (org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
     values (current_setting('pgtap.spo.org_a')::uuid, current_setting('pgtap.spo.property_a')::uuid, current_setting('pgtap.spo.category')::uuid,
             'other', current_setting('pgtap.spo.foreign_path') || '.server-forged', 'forged.pdf', 'application/pdf', 100, 'x') $$,
  '23514', null,
  'even the service role cannot write a documents row pointing outside its organisation'
);
reset role;

-- === 3. lease_templates ============================================================================

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ insert into public.lease_templates (org_id, name, storage_path, original_file_name, mime_type, file_size_bytes, created_by)
     values (current_setting('pgtap.spo.org_a')::uuid, 'Forged template', current_setting('pgtap.spo.foreign_path'), 'forged.docx',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 100, 'b5000000-0000-0000-0000-000000000001') $$,
  '23514', null,
  'principal A cannot insert a lease_templates row pointing at organisation B''s path'
);

select lives_ok(
  $$ insert into public.lease_templates (org_id, name, storage_path, original_file_name, mime_type, file_size_bytes, created_by)
     values (current_setting('pgtap.spo.org_a')::uuid, 'Own template', current_setting('pgtap.spo.org_a') || '/lease-templates/own.docx', 'own.docx',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 100, 'b5000000-0000-0000-0000-000000000001') $$,
  'a lease template inside A''s own lease-templates folder is still accepted'
);

select throws_ok(
  $$ update public.lease_templates set storage_path = current_setting('pgtap.spo.foreign_path') where name = 'Own template' $$,
  '23514', null,
  'principal A cannot UPDATE a lease template to point at organisation B''s path'
);

-- === 4. lease_documents ============================================================================

select throws_ok(
  $$ insert into public.lease_documents (lease_id, org_id, kind, status, version, storage_path, original_file_name, mime_type, file_size_bytes)
     values (current_setting('pgtap.spo.lease_a')::uuid, current_setting('pgtap.spo.org_a')::uuid, 'uploaded', 'draft', 1,
             current_setting('pgtap.spo.foreign_path'), 'forged.pdf', 'application/pdf', 100) $$,
  '23514', null,
  'principal A cannot insert a lease_documents row pointing at organisation B''s path'
);

select lives_ok(
  $$ insert into public.lease_documents (lease_id, org_id, kind, status, version, storage_path, original_file_name, mime_type, file_size_bytes)
     values (current_setting('pgtap.spo.lease_a')::uuid, current_setting('pgtap.spo.org_a')::uuid, 'uploaded', 'draft', 1,
             current_setting('pgtap.spo.org_a') || '/' || current_setting('pgtap.spo.property_a') || '/lease.pdf', 'lease.pdf', 'application/pdf', 100) $$,
  'a lease document inside A''s own folder is still accepted'
);

select throws_ok(
  $$ update public.lease_documents set storage_path = current_setting('pgtap.spo.foreign_path') where lease_id = current_setting('pgtap.spo.lease_a')::uuid $$,
  '23514', null,
  'principal A cannot UPDATE a lease document to point at organisation B''s path'
);

-- === 5. property_photos (paths checked against the photo's property organisation) ===================

select throws_ok(
  $$ insert into public.property_photos (property_id, document_id, hero_storage_path)
     values (current_setting('pgtap.spo.property_a')::uuid, (select id from public.documents where storage_path = current_setting('pgtap.spo.own_path')),
             current_setting('pgtap.spo.foreign_path')) $$,
  '23514', null,
  'principal A cannot insert a property photo whose hero path is in organisation B'
);

select lives_ok(
  $$ insert into public.property_photos (property_id, document_id, hero_storage_path, card_storage_path)
     values (current_setting('pgtap.spo.property_a')::uuid, (select id from public.documents where storage_path = current_setting('pgtap.spo.own_path')),
             current_setting('pgtap.spo.org_a') || '/' || current_setting('pgtap.spo.property_a') || '/own-hero.webp',
             current_setting('pgtap.spo.org_a') || '/' || current_setting('pgtap.spo.property_a') || '/own-card.webp') $$,
  'a property photo with hero and card paths inside A''s folder is still accepted'
);

select throws_ok(
  $$ update public.property_photos set card_storage_path = current_setting('pgtap.spo.foreign_path')
      where property_id = current_setting('pgtap.spo.property_a')::uuid $$,
  '23514', null,
  'principal A cannot UPDATE a property photo''s card path to point at organisation B'
);

-- === 6. Reads: nothing A holds references B's object, so A cannot see it ============================

select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.spo.foreign_path')),
  0,
  'principal A cannot read organisation B''s storage object'
);
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.spo.foreign_path')),
  1,
  'organisation B''s own principal still reads the object through B''s own documents row'
);

select * from finish();
rollback;
