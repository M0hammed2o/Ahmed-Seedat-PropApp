-- Property rules / occupant compliance / body corporate / levy statement workflow
-- (migration 20260101000097, WORKLOG.md this date). Covers: rule/version creation, activation
-- assigning requirements to every active tenancy, tenant RLS isolation (own vs another tenant vs
-- an outsider, all by direct id), viewed-does-not-mean-acknowledged, atomic/idempotent
-- acknowledgement, cross-tenant acknowledgement rejection, waiving, cross-org isolation, version
-- supersession NEVER mutating a historical acknowledgement, occupants RLS, management-contact and
-- levy-statement staff-only RLS.

begin;
select plan(34);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'pc-staff-a@test.propertyvault.example'),
  ('d2000000-0000-0000-0000-000000000001', 'pc-staff-b@test.propertyvault.example'),
  ('d3000000-0000-0000-0000-000000000001', 'pc-tenant-ahmed@test.propertyvault.example'),
  ('d4000000-0000-0000-0000-000000000001', 'pc-tenant-sarah@test.propertyvault.example'),
  ('d5000000-0000-0000-0000-000000000001', 'pc-outsider@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type) values
  ('d6000000-0000-0000-0000-000000000001', 'Compliance Test Org A', 'agency'),
  ('d6000000-0000-0000-0000-000000000002', 'Compliance Test Org B', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('d6000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  ('d6000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'agent', 'active', now());

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type) values
  ('d7000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'Musgrave Flats', '1 Test St', 'Durban', 'ZA', 'apartment');

insert into public.units (id, property_id, org_id, unit_label, status) values
  ('d8000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'Unit 31', 'occupied');

insert into public.tenants (id, org_id, user_id, full_name, status) values
  ('d9000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'Ahmed Tenant', 'active'),
  ('d9000000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'Sarah Tenant', 'active');

insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status, source) values
  ('da000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001', current_date, 10000, 'active', 'manual');

insert into public.lease_tenants (lease_id, tenant_id, is_primary) values
  ('da000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001', true),
  ('da000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000002', false);

insert into public.documents (
  id, owner_user_id, org_id, property_id, category_id, document_type,
  storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256
) values (
  'db000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001',
  'd7000000-0000-0000-0000-000000000001', (select id from public.document_categories where slug = 'compliance_documents'),
  'other', 'd6000000-0000-0000-0000-000000000001/conduct-rules-v1.pdf', 'conduct-rules-v1.pdf', 'application/pdf', 1000, 'checksum-v1'
);

set local role authenticated;

-- === Rule creation, versioning, activation ===
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';
create temp table rule_row as
select public.create_property_rule('d7000000-0000-0000-0000-000000000001', 'conduct_rules', 'Conduct Rules') as id;

select isnt((select id from rule_row), null, 'staff (agent) can create a property rule');

create temp table version1_row as
select public.create_property_rule_version((select id from rule_row), 'db000000-0000-0000-0000-000000000001', '2026-01-01'::date) as id;

select is(
  (select status from public.property_rule_versions where id = (select id from version1_row)),
  'draft', 'a newly created version starts as draft'
);

select is(
  (select public.activate_property_rule_version((select id from version1_row))),
  2, 'activating v1 assigns a requirement to both of the property''s current active tenants (Ahmed + Sarah)'
);

select is(
  (select count(*) from public.compliance_requirements where rule_version_id = (select id from version1_row)),
  2::bigint, 'exactly 2 requirement rows exist for v1'
);

-- Cross-org: staff-b cannot create a rule for org A's property.
set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select public.create_property_rule('d7000000-0000-0000-0000-000000000001', 'conduct_rules', 'Hijack Rules') $$,
  'Only agent-or-above staff can create a property rule',
  'staff from a different org cannot create a rule for org A''s property'
);

-- Captured under staff-a's own session (full org visibility) so the ids themselves are known
-- regardless of which tenant's RLS is active further down -- the isolation assertions below test
-- whether a SELECT under a given tenant's session returns the row for a KNOWN id, not whether the
-- id can be discovered in the first place.
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001'; -- back to staff-a
create temp table ahmed_req_v1 as
select id from public.compliance_requirements
  where rule_version_id = (select id from version1_row) and tenant_id = 'd9000000-0000-0000-0000-000000000001';
create temp table sarah_req_v1 as
select id from public.compliance_requirements
  where rule_version_id = (select id from version1_row) and tenant_id = 'd9000000-0000-0000-0000-000000000002';

-- === Tenant RLS isolation (own vs another tenant vs an outsider, all by direct id) ===
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001'; -- Ahmed

select is(
  (select count(*) from public.compliance_requirements where id = (select id from ahmed_req_v1)),
  1::bigint, 'Ahmed can SELECT his own requirement'
);

select is(
  (select count(*) from public.compliance_requirements where id = (select id from sarah_req_v1)),
  0::bigint, 'Ahmed CANNOT SELECT Sarah''s requirement by direct id (co-tenants stay isolated from each other)'
);

select is(
  (select count(*) from public.property_rule_versions where id = (select id from version1_row)),
  1::bigint, 'Ahmed can SELECT the rule version he has a requirement for'
);

select is(
  (select count(*) from public.documents where id = 'db000000-0000-0000-0000-000000000001'),
  1::bigint, 'Ahmed can SELECT the underlying rule document he has a requirement for'
);

set local "request.jwt.claim.sub" = 'd5000000-0000-0000-0000-000000000001'; -- outsider, no tenancy at all
select is(
  (select count(*) from public.compliance_requirements where id = (select id from ahmed_req_v1)),
  0::bigint, 'an outsider with no tenancy at all cannot SELECT Ahmed''s requirement by direct id'
);
select is(
  (select count(*) from public.documents where id = 'db000000-0000-0000-0000-000000000001'),
  0::bigint, 'an outsider cannot SELECT the rule document either'
);

-- === Viewed does not mean acknowledged ===
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001'; -- Ahmed
select public.mark_compliance_requirement_viewed((select id from ahmed_req_v1));
select is(
  (select status from public.compliance_requirements where id = (select id from ahmed_req_v1)),
  'viewed', 'marking a requirement viewed sets status to viewed, NOT acknowledged'
);

-- Cannot acknowledge someone else's requirement by direct id.
select throws_ok(
  $$ select public.acknowledge_compliance_requirement(
       (select id from sarah_req_v1), 'I confirm I have read and agree to comply.', null, null
     ) $$,
  'Requirement not found',
  'Ahmed cannot acknowledge Sarah''s requirement by direct id'
);

-- === Atomic, idempotent acknowledgement ===
create temp table ahmed_ack1 as
select public.acknowledge_compliance_requirement(
  (select id from ahmed_req_v1), 'I confirm I have read and agree to comply.', '10.0.0.1'::inet, 'pgtap-test-agent'
) as id;

select isnt((select id from ahmed_ack1), null, 'acknowledging Ahmed''s requirement succeeds and returns an evidence id');

select is(
  (select status from public.compliance_requirements where id = (select id from ahmed_req_v1)),
  'acknowledged', 'the requirement is now ACKNOWLEDGED'
);

select is(
  (select document_checksum from public.compliance_acknowledgements where id = (select id from ahmed_ack1)),
  'checksum-v1', 'the acknowledgement snapshots the document checksum at accept time'
);

-- Idempotent retry: same id, no duplicate row.
select is(
  (select public.acknowledge_compliance_requirement(
     (select id from ahmed_req_v1), 'I confirm I have read and agree to comply.', null, null
   )),
  (select id from ahmed_ack1),
  'retrying acknowledgement on an already-acknowledged requirement returns the SAME evidence id (idempotent)'
);
select is(
  (select count(*) from public.compliance_acknowledgements where requirement_id = (select id from ahmed_req_v1)),
  1::bigint, 'exactly one acknowledgement row exists after the idempotent retry (no duplicate)'
);

-- Tenant can read their own acknowledgement, an outsider cannot.
select is(
  (select count(*) from public.compliance_acknowledgements where id = (select id from ahmed_ack1)),
  1::bigint, 'Ahmed can SELECT his own acknowledgement'
);
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000001'; -- Sarah
select is(
  (select count(*) from public.compliance_acknowledgements where id = (select id from ahmed_ack1)),
  0::bigint, 'Sarah CANNOT SELECT Ahmed''s acknowledgement'
);

-- === Version supersession never mutates a historical acknowledgement ===
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001'; -- staff-a
create temp table version2_row as
select public.create_property_rule_version((select id from rule_row), 'db000000-0000-0000-0000-000000000001', '2026-08-01'::date) as id;
select public.activate_property_rule_version((select id from version2_row));

select is(
  (select status from public.property_rule_versions where id = (select id from version1_row)),
  'superseded', 'v1 becomes superseded once v2 is activated'
);
select is(
  (select status from public.compliance_requirements where id = (select id from ahmed_req_v1)),
  'acknowledged', 'Ahmed''s ALREADY-ACKNOWLEDGED v1 requirement is untouched by v2''s activation (still acknowledged, never migrated)'
);
select is(
  (select rule_version_id from public.compliance_acknowledgements where id = (select id from ahmed_ack1)),
  (select id from version1_row),
  'Ahmed''s historical acknowledgement still points at v1, never silently repointed to v2'
);
select is(
  (select status from public.compliance_requirements where id = (select id from sarah_req_v1)),
  'superseded', 'Sarah''s never-acknowledged v1 requirement becomes SUPERSEDED (not left pending against a dead version)'
);
select is(
  (select count(*) from public.compliance_requirements where rule_version_id = (select id from version2_row)),
  2::bigint, 'v2''s activation assigns 2 fresh PENDING requirements (Ahmed + Sarah again)'
);

-- === Waiving ===
create temp table sarah_req_v2 as
select id from public.compliance_requirements
  where rule_version_id = (select id from version2_row) and tenant_id = 'd9000000-0000-0000-0000-000000000002';
select public.waive_compliance_requirement((select id from sarah_req_v2), 'Sarah is a minor dependant, waived by property manager.');
select is(
  (select status from public.compliance_requirements where id = (select id from sarah_req_v2)),
  'waived', 'staff can waive an outstanding requirement with a reason'
);
set local "request.jwt.claim.sub" = 'd4000000-0000-0000-0000-000000000001'; -- Sarah
select throws_ok(
  $$ select public.acknowledge_compliance_requirement(
       (select id from sarah_req_v2), 'I confirm.', null, null
     ) $$,
  'This requirement has been waived and can no longer be acknowledged',
  'a waived requirement can no longer be acknowledged'
);

-- === Occupants: tenant reads their own lease''s occupants, an unrelated tenant does not ===
reset role;
insert into public.lease_occupants (org_id, lease_id, full_name, occupant_type, is_active)
values ('d6000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'Little Timmy', 'child_dependant', true);
set local role authenticated;
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001'; -- Ahmed (on this lease)
select is(
  (select count(*) from public.lease_occupants where lease_id = 'da000000-0000-0000-0000-000000000001'),
  1::bigint, 'Ahmed (a tenant on the lease) can SELECT the recorded occupant'
);

-- === Management contacts + levy statements: staff-only, never tenant-visible ===
reset role;
insert into public.property_management_contacts (id, org_id, property_id, contact_type, name, created_by)
values ('dc000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001', 'managing_agent', 'Test Managing Agent', 'd1000000-0000-0000-0000-000000000001');
insert into public.levy_statements (id, org_id, property_id, document_id, created_by)
values ('dd000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001');
insert into public.levy_statement_line_items (id, statement_id, org_id, line_type, category, amount, source)
values ('de000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'charge', 'monthly_levy', 1500.00, 'manual');
set local role authenticated;

set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001'; -- staff-a
select is(
  (select count(*) from public.property_management_contacts where property_id = 'd7000000-0000-0000-0000-000000000001'),
  1::bigint, 'staff can SELECT the property''s management contact'
);
select is(
  (select count(*) from public.levy_statement_line_items where statement_id = 'dd000000-0000-0000-0000-000000000001'),
  1::bigint, 'staff can SELECT the levy statement''s line items'
);

set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001'; -- Ahmed (tenant)
select is(
  (select count(*) from public.property_management_contacts where property_id = 'd7000000-0000-0000-0000-000000000001'),
  0::bigint, 'a tenant CANNOT SELECT the property''s management contact (staff/owner-only)'
);
select is(
  (select count(*) from public.levy_statements where id = 'dd000000-0000-0000-0000-000000000001'),
  0::bigint, 'a tenant CANNOT SELECT a levy statement (financial, staff/owner-only)'
);

-- === Storage: tenant read access to the underlying object for a rule they have a requirement
-- for, never for one they don't (documents_bucket_select_tenant_compliance) ===
reset role;
insert into storage.objects (bucket_id, name, owner)
values ('documents', 'd6000000-0000-0000-0000-000000000001/conduct-rules-v1.pdf', 'd1000000-0000-0000-0000-000000000001');
set local role authenticated;

set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001'; -- Ahmed
select is(
  (select count(*) from storage.objects where name = 'd6000000-0000-0000-0000-000000000001/conduct-rules-v1.pdf'),
  1::bigint, 'Ahmed can read the storage object for a rule document he has a requirement for'
);

set local "request.jwt.claim.sub" = 'd5000000-0000-0000-0000-000000000001'; -- outsider
select is(
  (select count(*) from storage.objects where name = 'd6000000-0000-0000-0000-000000000001/conduct-rules-v1.pdf'),
  0::bigint, 'an outsider with no compliance requirement cannot read the same storage object'
);

select * from finish();
rollback;
