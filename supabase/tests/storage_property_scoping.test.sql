-- Security + maintenance workflow pass (WORKLOG.md this date). Proves the storage.objects fix in
-- 20260101000086 actually behaves the way the pgTAP-tested `documents`/`property_access` RLS
-- already does -- direct SQL against storage.objects is the standard way to test Storage RLS
-- (RLS enforcement happens at the table layer regardless of whether a row was created through the
-- real Storage REST API or a raw INSERT; storage.foldername() parses `name` directly with no
-- dependency on any Storage-service-populated column, confirmed by reading its definition).

begin;
select plan(13);

insert into auth.users (id, email) values
  ('b2000000-0000-0000-0000-000000000001', 'sps-principal@test.propertyvault.example'),
  ('b2000000-0000-0000-0000-000000000002', 'sps-staff-a@test.propertyvault.example'),
  ('b2000000-0000-0000-0000-000000000003', 'sps-staff-all@test.propertyvault.example'),
  ('b2000000-0000-0000-0000-000000000004', 'sps-other-principal@test.propertyvault.example'),
  ('b2000000-0000-0000-0000-000000000005', 'sps-tenant@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Storage Scope Test Org', 'agency')), null, 'org created');
select set_config('pgtap.sps.org_id', (select id::text from public.organizations where legal_name = 'Storage Scope Test Org'), false);

select set_config(
  'pgtap.sps.property_a_id',
  (select public.create_property(current_setting('pgtap.sps.org_id')::uuid, 'Property A', '1 A St', 'Cape Town', 'ZA', 'house'::public.property_type)::text),
  false
);
select set_config(
  'pgtap.sps.property_b_id',
  (select public.create_property(current_setting('pgtap.sps.org_id')::uuid, 'Property B', '2 B St', 'Cape Town', 'ZA', 'house'::public.property_type)::text),
  false
);

set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000004';
select isnt((select public.create_organization('Storage Scope Other Org', 'agency')), null, 'other org created');
select set_config('pgtap.sps.other_org_id', (select id::text from public.organizations where legal_name = 'Storage Scope Other Org'), false);
select set_config(
  'pgtap.sps.property_c_id',
  (select public.create_property(current_setting('pgtap.sps.other_org_id')::uuid, 'Property C', '3 C St', 'Cape Town', 'ZA', 'house'::public.property_type)::text),
  false
);

set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';
select set_config('pgtap.sps.category_id', (select id::text from public.document_categories limit 1), false);

-- Real `documents` rows, exactly like the app would create them (property_id not null,
-- storage_path following the app's own {org_id}/{property_id}/{uuid}.{ext} convention).
select set_config('pgtap.sps.path_a', current_setting('pgtap.sps.org_id') || '/' || current_setting('pgtap.sps.property_a_id') || '/doc-a.pdf', false);
select set_config('pgtap.sps.path_b', current_setting('pgtap.sps.org_id') || '/' || current_setting('pgtap.sps.property_b_id') || '/doc-b.pdf', false);

insert into public.documents (owner_user_id, org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values (
  'b2000000-0000-0000-0000-000000000001', current_setting('pgtap.sps.org_id')::uuid, current_setting('pgtap.sps.property_a_id')::uuid,
  current_setting('pgtap.sps.category_id')::uuid, 'other', current_setting('pgtap.sps.path_a'), 'doc-a.pdf', 'application/pdf', 100, 'checksum-a'
);
insert into public.documents (owner_user_id, org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values (
  'b2000000-0000-0000-0000-000000000001', current_setting('pgtap.sps.org_id')::uuid, current_setting('pgtap.sps.property_b_id')::uuid,
  current_setting('pgtap.sps.category_id')::uuid, 'other', current_setting('pgtap.sps.path_b'), 'doc-b.pdf', 'application/pdf', 100, 'checksum-b'
);

-- A property photo -- confirms the fix covers property_photos too (a thin link table over the
-- same documents row, not a separate storage path/policy).
insert into public.property_photos (property_id, document_id)
select current_setting('pgtap.sps.property_a_id')::uuid, id from public.documents where storage_path = current_setting('pgtap.sps.path_a');

-- Cross-org document, in Other Org's Property C.
select set_config('pgtap.sps.path_c', current_setting('pgtap.sps.other_org_id') || '/' || current_setting('pgtap.sps.property_c_id') || '/doc-c.pdf', false);
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000004';
select set_config('pgtap.sps.category_c_id', (select id::text from public.document_categories limit 1), false);
insert into public.documents (owner_user_id, org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values (
  'b2000000-0000-0000-0000-000000000004', current_setting('pgtap.sps.other_org_id')::uuid, current_setting('pgtap.sps.property_c_id')::uuid,
  current_setting('pgtap.sps.category_c_id')::uuid, 'other', current_setting('pgtap.sps.path_c'), 'doc-c.pdf', 'application/pdf', 100, 'checksum-c'
);

-- The actual storage.objects rows -- simulating what Storage would have written for each upload.
-- storage.objects has no client-facing RLS-bypass concept here; inserting as the test-runner role
-- (reset) mirrors that these rows exist independently of who's *querying* them next, same as real
-- uploaded files do.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  (current_setting('pgtap.sps.org_id')::uuid, 'b2000000-0000-0000-0000-000000000002', 'agent', 'active', now()),
  (current_setting('pgtap.sps.org_id')::uuid, 'b2000000-0000-0000-0000-000000000003', 'agent', 'active', now());

insert into storage.objects (bucket_id, name, owner)
values
  ('documents', current_setting('pgtap.sps.path_a'), 'b2000000-0000-0000-0000-000000000001'),
  ('documents', current_setting('pgtap.sps.path_b'), 'b2000000-0000-0000-0000-000000000001'),
  ('documents', current_setting('pgtap.sps.path_c'), 'b2000000-0000-0000-0000-000000000004'),
  -- A "guessed" object: a syntactically valid {org}/{property_a}/{uuid}.ext path that no real
  -- documents row references (nobody ever uploaded/registered it) -- proves guessing a
  -- plausible-looking path alone, with no backing metadata, can never resolve to a readable row.
  ('documents', current_setting('pgtap.sps.org_id') || '/' || current_setting('pgtap.sps.property_a_id') || '/guessed-uuid-that-was-never-uploaded.pdf', 'b2000000-0000-0000-0000-000000000001');

set local role authenticated;

-- Staff A: agent, narrowed to selected-properties mode, granted Property A only. Both staff were
-- added to the org while still in default 'all' mode, so the auto-grant trigger already gave
-- staff A a property_access row for Property B too -- switching to 'selected' does not
-- retroactively revoke that (20260101000084's own documented behavior, also relied on by
-- shared_access_architecture.test.sql), so the leftover grant must be revoked explicitly.
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';
select public.set_member_property_access_mode(current_setting('pgtap.sps.org_id')::uuid, 'b2000000-0000-0000-0000-000000000002', 'selected');
select public.revoke_property_access(current_setting('pgtap.sps.property_b_id')::uuid, 'b2000000-0000-0000-0000-000000000002');
select public.grant_property_access(current_setting('pgtap.sps.property_a_id')::uuid, 'b2000000-0000-0000-0000-000000000002', 'property_manager');

-- === A: staff assigned Property A can read Property A's storage object ===
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.sps.path_a')),
  1,
  'A: staff scoped to Property A can read Property A''s storage object'
);

-- === B: staff assigned Property A cannot read Property B's storage object ===
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.sps.path_b')),
  0,
  'B: staff scoped to Property A cannot read Property B''s storage object, same org'
);

-- === C: a guessed, never-registered path fails even though it looks like a legitimate Property A path ===
select is(
  (select count(*)::int from storage.objects where name like '%guessed-uuid-that-was-never-uploaded%'),
  0,
  'C: a syntactically plausible but never-uploaded path resolves to zero rows -- no documents row to authorize it'
);

-- === D: cross-organisation access fails, both directions ===
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.sps.path_c')),
  0,
  'D: staff in Storage Scope Test Org cannot read Storage Scope Other Org''s storage object'
);
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from storage.objects where name in (current_setting('pgtap.sps.path_a'), current_setting('pgtap.sps.path_b'))),
  0,
  'D: the other org''s principal cannot read either of Storage Scope Test Org''s storage objects'
);

-- === E: an authorized organisation-wide role still works (staff left in default 'all' mode) ===
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from storage.objects where name in (current_setting('pgtap.sps.path_a'), current_setting('pgtap.sps.path_b'))),
  2,
  'E: staff still in default all-properties mode reads both Property A and Property B storage objects'
);

-- === F: tenant-specific visibility is unaffected by the property-scoping change ===
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';
insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.sps.property_a_id')::uuid, current_setting('pgtap.sps.org_id')::uuid, 'A1', 'vacant');
select set_config('pgtap.sps.unit_a_id', (select id::text from public.units where unit_label = 'A1'), false);
insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
values (current_setting('pgtap.sps.org_id')::uuid, current_setting('pgtap.sps.unit_a_id')::uuid, '2026-01-01', 5000, 'draft', 'manual');
select set_config('pgtap.sps.lease_id', (select id::text from public.leases where unit_id = current_setting('pgtap.sps.unit_a_id')::uuid), false);

reset role;
insert into public.tenants (org_id, full_name, status, user_id)
values (current_setting('pgtap.sps.org_id')::uuid, 'Storage Scope Tenant', 'active', 'b2000000-0000-0000-0000-000000000005');
select set_config('pgtap.sps.tenant_id', (select id::text from public.tenants where full_name = 'Storage Scope Tenant'), false);
insert into public.lease_tenants (lease_id, tenant_id)
values (current_setting('pgtap.sps.lease_id')::uuid, current_setting('pgtap.sps.tenant_id')::uuid);
set local role authenticated;

set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';
select set_config('pgtap.sps.path_lease_doc', current_setting('pgtap.sps.org_id') || '/' || current_setting('pgtap.sps.property_a_id') || '/lease-doc.pdf', false);
insert into public.documents (owner_user_id, org_id, property_id, category_id, document_type, lease_id, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values (
  'b2000000-0000-0000-0000-000000000001', current_setting('pgtap.sps.org_id')::uuid, current_setting('pgtap.sps.property_a_id')::uuid,
  current_setting('pgtap.sps.category_id')::uuid, 'other', current_setting('pgtap.sps.lease_id')::uuid,
  current_setting('pgtap.sps.path_lease_doc'), 'lease-doc.pdf', 'application/pdf', 100, 'checksum-lease'
);
reset role;
insert into storage.objects (bucket_id, name, owner)
values ('documents', current_setting('pgtap.sps.path_lease_doc'), 'b2000000-0000-0000-0000-000000000001');
set local role authenticated;

set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000005';
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.sps.path_lease_doc')),
  1,
  'F: a tenant reads their own lease-linked document''s storage object via the untouched tenant policy, despite having no org membership at all'
);
select is(
  (select count(*)::int from storage.objects where name = current_setting('pgtap.sps.path_a')),
  0,
  'F: that same tenant still cannot read a Property A document unrelated to their own lease'
);

-- === G: existing property photos still load for authorized users ===
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';
select is(
  (
    select count(*)::int from public.property_photos pp
    join storage.objects o on o.name = (select storage_path from public.documents where id = pp.document_id)
    where pp.property_id = current_setting('pgtap.sps.property_a_id')::uuid
  ),
  1,
  'G: the property photo''s underlying storage object still resolves for the org principal'
);

-- === write-side: the same property scoping applies to INSERT, not only SELECT ===
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.sps.org_id') || '/' || current_setting('pgtap.sps.property_b_id') || '/attempted-upload.pdf', 'b2000000-0000-0000-0000-000000000002') $$,
  'new row violates row-level security policy for table "objects"',
  'staff scoped to Property A cannot upload (INSERT) into Property B''s storage path'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('documents', current_setting('pgtap.sps.org_id') || '/' || current_setting('pgtap.sps.property_a_id') || '/allowed-upload.pdf', 'b2000000-0000-0000-0000-000000000002') $$,
  'staff scoped to Property A can upload (INSERT) into Property A''s own storage path'
);

-- Note: the DELETE policy's `owner = auth.uid()` self-cleanup escape hatch (see
-- 20260101000086) is not exercised here -- this local Supabase stack has its own
-- storage.protect_delete() trigger that categorically rejects any raw SQL DELETE against
-- storage.objects ("Use the Storage API instead"), independent of RLS. Real deletes only ever
-- happen through the Storage REST API in production, a code path pgTAP has no way to invoke;
-- confirmed by running this test and observing the trigger fire ahead of any RLS check.

select * from finish();
rollback;
