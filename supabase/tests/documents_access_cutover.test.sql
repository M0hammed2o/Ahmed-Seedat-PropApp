-- Tests for 20260101000067_documents_access_cutover.sql: documents gated on has_property_access()
-- via its direct property_id column. No bootstrapping problem (verified empirically before this
-- migration was written).

begin;
select plan(5);

insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'dac-principal@test.propertyvault.example'),
  ('f5000000-0000-0000-0000-000000000002', 'dac-coworker@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Documents Cutover Test Org', 'agency')), null, 'org created');

select set_config(
  'pgtap.dac_test.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Documents Cutover Test Org'),
    'Documents Cutover Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

-- Exact API route sequence: insert ... select ... single()
select lives_ok(
  $$ insert into public.documents (
       org_id, property_id, category_id, document_type, storage_path, original_file_name,
       mime_type, file_size_bytes, checksum_sha256
     )
     select o.id, current_setting('pgtap.dac_test.property_id')::uuid, dc.id, 'bill',
       'test/cutover.pdf', 'cutover.pdf', 'application/pdf', 1024, 'abc123'
     from public.organizations o, public.document_categories dc
     where o.legal_name = 'Documents Cutover Test Org' and dc.slug = 'water' $$,
  'the property owner can upload a document (no bootstrapping problem, verified)'
);

select is(
  (select original_file_name from public.documents where storage_path = 'test/cutover.pdf'),
  'cutover.pdf',
  'the creator can fetch the document via a plain, separate SELECT'
);

-- A coworker who joins the org is auto-granted access (zero-regression trigger); revoking removes it.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'f5000000-0000-0000-0000-000000000002', 'viewer', 'active', now()
from public.organizations where legal_name = 'Documents Cutover Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.documents where storage_path = 'test/cutover.pdf'),
  1,
  'a coworker who joins the org is auto-granted access that cascades to documents'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';

select public.revoke_property_access(
  current_setting('pgtap.dac_test.property_id')::uuid,
  'f5000000-0000-0000-0000-000000000002'::uuid
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.documents where storage_path = 'test/cutover.pdf'),
  0,
  'revoking property access removes document visibility too'
);

select * from finish();
rollback;
