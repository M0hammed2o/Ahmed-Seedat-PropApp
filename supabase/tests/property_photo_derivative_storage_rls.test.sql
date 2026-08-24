-- Property cover-photo audit follow-up (WORKLOG.md 2026-08-24/25): proves the derivative-rendering
-- fix in 20260101000128 -- a hero/card derivative storage object (no documents row of its own,
-- referenced only via property_photos.hero_storage_path/card_storage_path) is now readable by
-- exactly the same set of callers who could already read the photo's own original, and by nobody
-- else. Same direct-SQL-against-storage.objects technique as storage_property_scoping.test.sql.

begin;
select plan(10);

insert into auth.users (id, email) values
  ('b3000000-0000-0000-0000-000000000001', 'pd-principal@test.propertyvault.example'),
  ('b3000000-0000-0000-0000-000000000002', 'pd-assigned-staff@test.propertyvault.example'),
  ('b3000000-0000-0000-0000-000000000003', 'pd-unassigned-staff@test.propertyvault.example'),
  ('b3000000-0000-0000-0000-000000000004', 'pd-other-org-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Photo Derivative RLS Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Photo Derivative RLS Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000001';
select set_config('pgtap.pd.org_id', (select id::text from public.organizations where legal_name = 'Photo Derivative RLS Test Org'), false);

select set_config(
  'pgtap.pd.property_id',
  (select public.create_property(current_setting('pgtap.pd.org_id')::uuid, 'Derivative Test Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type)::text),
  false
);

set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000004';
select isnt((select public.create_organization('Photo Derivative RLS Other Org', 'agency')), null, 'other org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Photo Derivative RLS Other Org'));

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode)
values
  (current_setting('pgtap.pd.org_id')::uuid, 'b3000000-0000-0000-0000-000000000002', 'agent', 'active', now(), 'selected'),
  (current_setting('pgtap.pd.org_id')::uuid, 'b3000000-0000-0000-0000-000000000003', 'agent', 'active', now(), 'selected');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000001';
select public.grant_property_access(current_setting('pgtap.pd.property_id')::uuid, 'b3000000-0000-0000-0000-000000000002', 'property_manager');
-- staff 3 (unassigned) deliberately gets no property_access grant at all.

select set_config('pgtap.pd.category_id', (select id::text from public.document_categories where slug = 'property_photos'), false);
select set_config('pgtap.pd.original_path', current_setting('pgtap.pd.org_id') || '/' || current_setting('pgtap.pd.property_id') || '/photo-uuid.jpg', false);
select set_config('pgtap.pd.hero_path', current_setting('pgtap.pd.org_id') || '/' || current_setting('pgtap.pd.property_id') || '/photo-uuid-hero.webp', false);
select set_config('pgtap.pd.card_path', current_setting('pgtap.pd.org_id') || '/' || current_setting('pgtap.pd.property_id') || '/photo-uuid-card.webp', false);

insert into public.documents (owner_user_id, org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values (
  'b3000000-0000-0000-0000-000000000001', current_setting('pgtap.pd.org_id')::uuid, current_setting('pgtap.pd.property_id')::uuid,
  current_setting('pgtap.pd.category_id')::uuid, 'other', current_setting('pgtap.pd.original_path'), 'photo.jpg', 'image/jpeg', 35518, 'checksum-photo'
);

insert into public.property_photos (property_id, document_id, is_cover, hero_storage_path, card_storage_path, width, height)
select current_setting('pgtap.pd.property_id')::uuid, id, true, current_setting('pgtap.pd.hero_path'), current_setting('pgtap.pd.card_path'), 3000, 2000
from public.documents where storage_path = current_setting('pgtap.pd.original_path');

-- The 3 real storage objects a real upload+derivative-generation cycle would produce.
reset role;
insert into storage.objects (bucket_id, name, owner)
values
  ('documents', current_setting('pgtap.pd.original_path'), 'b3000000-0000-0000-0000-000000000001'),
  ('documents', current_setting('pgtap.pd.hero_path'), 'b3000000-0000-0000-0000-000000000001'),
  ('documents', current_setting('pgtap.pd.card_path'), 'b3000000-0000-0000-0000-000000000001');
set local role authenticated;

-- === Principal (has property access via 'owner'/org role) can read both derivatives ===
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from storage.objects where name in (current_setting('pgtap.pd.hero_path'), current_setting('pgtap.pd.card_path'))),
  2,
  'principal with property access reads both the hero and card derivative storage objects'
);

-- === Assigned staff (agent + property_manager grant) can read both derivatives ===
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from storage.objects where name in (current_setting('pgtap.pd.hero_path'), current_setting('pgtap.pd.card_path'))),
  2,
  'assigned staff (agent + property_manager access) reads both derivative storage objects'
);

-- === Unassigned staff (agent, no property grant) is denied ===
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from storage.objects where name in (current_setting('pgtap.pd.hero_path'), current_setting('pgtap.pd.card_path'))),
  0,
  'unassigned staff (agent with zero property_access grants) cannot read either derivative'
);

-- === Cross-org user is denied ===
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from storage.objects where name in (current_setting('pgtap.pd.hero_path'), current_setting('pgtap.pd.card_path'))),
  0,
  'a principal of a completely different org cannot read either derivative'
);

-- === Unauthenticated (anon) is denied ===
reset role;
set local role anon;
select is(
  (select count(*)::int from storage.objects where name in (current_setting('pgtap.pd.hero_path'), current_setting('pgtap.pd.card_path'))),
  0,
  'an unauthenticated (anon) request reads neither derivative'
);
reset role;

-- === The fix does not weaken the original-file branch: still governed by the original policy ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.pd.original_path')),
  0,
  'unassigned staff also still cannot read the original photo file -- the pre-existing branch is untouched'
);

-- === A guessed-but-never-registered derivative-shaped path still resolves to nothing ===
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from storage.objects where name like '%never-uploaded-hero.webp'),
  0,
  'a syntactically plausible but never-registered derivative path is not a valid row to test against (sanity: zero unrelated rows exist)'
);

-- === Sanity: total object count for this property is exactly 3 (original + hero + card), no leak ===
select is(
  (select count(*)::int from storage.objects where name like current_setting('pgtap.pd.org_id') || '/' || current_setting('pgtap.pd.property_id') || '/%'),
  3,
  'exactly the 3 real objects (original + hero + card) exist for this property, nothing extraneous'
);

select * from finish();
rollback;
