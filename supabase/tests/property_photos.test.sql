-- Tests for 20260101000080_property_photos.sql: staff-or-owner visibility, cross-org isolation,
-- at-most-one-cover-photo guard. Plus 20260101000127_property_photo_derivatives.sql: the new
-- hero/card derivative columns are purely additive (nullable, no new constraint) -- a pre-existing
-- row (or one inserted the same way this file already does, without them) must keep working
-- unchanged.

begin;
select plan(8);

insert into auth.users (id, email) values
  ('f6000000-0000-0000-0000-000000000001', 'pp-principal@test.propertyvault.example'),
  ('f6000000-0000-0000-0000-000000000002', 'pp-outsider@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Property Photos Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Property Photos Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000001';

select set_config(
  'pgtap.pp.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Property Photos Test Org'),
    'Photo Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

insert into public.documents (org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
select o.id, current_setting('pgtap.pp.property_id')::uuid,
  (select id from public.document_categories where slug = 'property_photos'),
  'other', current_setting('pgtap.pp.property_id') || '/photo1.jpg', 'photo1.jpg', 'image/jpeg', 1000, 'abc123'
from public.organizations o where o.legal_name = 'Property Photos Test Org';

select set_config(
  'pgtap.pp.document_id',
  (select id::text from public.documents where property_id = current_setting('pgtap.pp.property_id')::uuid),
  false
);

select lives_ok(
  $$ insert into public.property_photos (property_id, document_id, is_cover)
     values (current_setting('pgtap.pp.property_id')::uuid, current_setting('pgtap.pp.document_id')::uuid, true) $$,
  'the property owner/staff can attach a photo and mark it cover'
);

select is(
  (select count(*)::int from public.property_photos where property_id = current_setting('pgtap.pp.property_id')::uuid),
  1,
  'the creator can see the photo they attached'
);

-- At most one cover photo per property -- a second cover insert must fail the partial unique index.
select throws_ok(
  $$ insert into public.property_photos (property_id, document_id, is_cover)
     values (current_setting('pgtap.pp.property_id')::uuid, current_setting('pgtap.pp.document_id')::uuid, true) $$,
  'duplicate key value violates unique constraint "property_photos_one_cover_idx"',
  'a second cover photo on the same property is rejected'
);

-- Cross-org isolation: an outsider with no org membership and no property_access sees nothing.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.property_photos where property_id = current_setting('pgtap.pp.property_id')::uuid),
  0,
  'an outsider with no org membership or property access sees zero photos'
);

select is(
  (select count(*)::int from public.documents where id = current_setting('pgtap.pp.document_id')::uuid),
  0,
  'the outsider cannot see the underlying document row either'
);

-- Derivative columns: purely additive, nullable, no new constraint -- a photo inserted the plain
-- old way (this file's own first insert, above) still exists with them all null, and the columns
-- accept real values when a writer (the photos route) supplies them.
reset role;
select is(
  (select hero_storage_path from public.property_photos where document_id = current_setting('pgtap.pp.document_id')::uuid),
  null,
  'hero_storage_path is null for a photo inserted without it -- no writer forced it, no default invented one'
);
select lives_ok(
  $$ update public.property_photos
     set hero_storage_path = 'org/prop/uuid-hero.webp', card_storage_path = 'org/prop/uuid-card.webp', width = 1600, height = 1067
     where document_id = current_setting('pgtap.pp.document_id')::uuid $$,
  'hero_storage_path/card_storage_path/width/height accept real values'
);

select * from finish();
rollback;
