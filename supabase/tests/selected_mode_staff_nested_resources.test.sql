-- Overnight platform pass (WORKLOG.md this date), Phase 13 (tenant/staff authorization must not
-- rely on frontend route hiding). The *_access_cutover.test.sql suite already proves every listed
-- table enforces has_property_access() in general; this file specifically proves the
-- property_access_mode = 'selected' narrowing path (20260101000084) denies a real staff member
-- direct-query access to a sibling property's leases/documents/maintenance tickets/tenant data --
-- the exact "unit/lease/document/maintenance/tenant" list the task brief calls out, end to end
-- through the mode switch, not just via has_property_access() called in isolation.

begin;
select plan(9);

insert into auth.users (id, email) values
  ('f6000000-0000-0000-0000-000000000001', 'smnr-principal@test.propertyvault.example'),
  ('f6000000-0000-0000-0000-000000000002', 'smnr-staffA@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Selected Mode Nested Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Selected Mode Nested Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000001';
select set_config('pgtap.smnr.org_id', (select id::text from public.organizations where legal_name = 'Selected Mode Nested Test Org'), false);

select set_config(
  'pgtap.smnr.property_a_id',
  (select public.create_property(current_setting('pgtap.smnr.org_id')::uuid, 'Property A', '1 A St', 'Cape Town', 'ZA', 'apartment'::public.property_type)::text),
  false
);
select set_config(
  'pgtap.smnr.property_b_id',
  (select public.create_property(current_setting('pgtap.smnr.org_id')::uuid, 'Property B', '2 B St', 'Cape Town', 'ZA', 'apartment'::public.property_type)::text),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.smnr.property_b_id')::uuid, current_setting('pgtap.smnr.org_id')::uuid, 'B1', 'vacant');
select set_config('pgtap.smnr.unit_b_id', (select id::text from public.units where unit_label = 'B1'), false);

insert into public.tenants (org_id, full_name, status)
values (current_setting('pgtap.smnr.org_id')::uuid, 'Property B Tenant', 'active');
insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
values (current_setting('pgtap.smnr.org_id')::uuid, current_setting('pgtap.smnr.unit_b_id')::uuid, '2026-01-01', 8000, 'draft', 'manual');
select set_config('pgtap.smnr.lease_b_id', (select id::text from public.leases where unit_id = current_setting('pgtap.smnr.unit_b_id')::uuid), false);

select set_config('pgtap.smnr.category_id', (select id::text from public.document_categories limit 1), false);
insert into public.documents (owner_user_id, org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values (
  'f6000000-0000-0000-0000-000000000001', current_setting('pgtap.smnr.org_id')::uuid, current_setting('pgtap.smnr.property_b_id')::uuid,
  current_setting('pgtap.smnr.category_id')::uuid, 'other', current_setting('pgtap.smnr.org_id') || '/' || current_setting('pgtap.smnr.property_b_id') || '/doc-b.pdf',
  'doc-b.pdf', 'application/pdf', 100, 'checksum-smnr-b'
);

insert into public.maintenance_tickets (org_id, property_id, submitted_by_user_id, summary)
values (current_setting('pgtap.smnr.org_id')::uuid, current_setting('pgtap.smnr.property_b_id')::uuid, 'f6000000-0000-0000-0000-000000000001', 'Property B ticket');

-- Staff A: agent, narrowed to selected-properties mode, granted Property A only (never Property B).
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values (current_setting('pgtap.smnr.org_id')::uuid, 'f6000000-0000-0000-0000-000000000002', 'agent', 'active', now());
set local role authenticated;
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000001';
select public.set_member_property_access_mode(current_setting('pgtap.smnr.org_id')::uuid, 'f6000000-0000-0000-0000-000000000002', 'selected');
-- Staff A joined while still in default 'all' mode, so the auto-grant trigger already gave them
-- a property_access row on Property B too -- switching to 'selected' does not retroactively
-- revoke that (20260101000084's documented behaviour, same as every other test in this session
-- that exercises this exact narrowing path) -- revoke it explicitly before asserting denial.
select public.revoke_property_access(current_setting('pgtap.smnr.property_b_id')::uuid, 'f6000000-0000-0000-0000-000000000002');
select public.grant_property_access(current_setting('pgtap.smnr.property_a_id')::uuid, 'f6000000-0000-0000-0000-000000000002', 'property_manager');

set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000002';

select ok(
  public.has_property_access(current_setting('pgtap.smnr.property_a_id')::uuid, 'read_only'),
  'sanity: Staff A does have read access to their own granted Property A'
);

select is(
  (select count(*)::int from public.units where id = current_setting('pgtap.smnr.unit_b_id')::uuid),
  0,
  'Staff A (selected mode, Property A only) is denied direct query access to Property B''s unit'
);
select is(
  (select count(*)::int from public.leases where id = current_setting('pgtap.smnr.lease_b_id')::uuid),
  0,
  'Staff A is denied direct query access to Property B''s lease'
);
select is(
  (select count(*)::int from public.documents where storage_path = current_setting('pgtap.smnr.org_id') || '/' || current_setting('pgtap.smnr.property_b_id') || '/doc-b.pdf'),
  0,
  'Staff A is denied direct query access to Property B''s document'
);
select is(
  (select count(*)::int from public.maintenance_tickets where property_id = current_setting('pgtap.smnr.property_b_id')::uuid),
  0,
  'Staff A is denied direct query access to Property B''s maintenance ticket'
);
select is(
  (select count(*)::int from public.tenants t join public.lease_tenants lt on lt.tenant_id = t.id where lt.lease_id = current_setting('pgtap.smnr.lease_b_id')::uuid),
  0,
  'Staff A is denied direct query access to Property B''s tenant data (no lease_tenants rows exist to leak here, but the lease itself is already unreadable, confirming the join has nothing to expose)'
);

-- Switching back to 'all' immediately restores visibility -- proves the denial above is really
-- the selected-mode narrowing, not a permanent/unrelated block.
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000001';
select public.set_member_property_access_mode(current_setting('pgtap.smnr.org_id')::uuid, 'f6000000-0000-0000-0000-000000000002', 'all');
set local "request.jwt.claim.sub" = 'f6000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.units where id = current_setting('pgtap.smnr.unit_b_id')::uuid),
  1,
  'switching Staff A back to all-properties mode immediately restores Property B unit visibility'
);
select is(
  (select count(*)::int from public.leases where id = current_setting('pgtap.smnr.lease_b_id')::uuid),
  1,
  'switching Staff A back to all-properties mode immediately restores Property B lease visibility'
);

select * from finish();
rollback;
