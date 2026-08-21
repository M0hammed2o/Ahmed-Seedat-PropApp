-- RELEASE A P0 SECURITY FIX tests for 20260101000101_selected_property_staff_isolation_cutover.sql.
-- Proves, with REAL linked fixtures (unlike selected_mode_staff_nested_resources.test.sql's own
-- tenant assertion, which the V1 Commercial Launch Gap Audit found could not actually prove
-- anything because no lease_tenants row existed to potentially leak), that a
-- property_access_mode = 'selected' staff member restricted to Property A cannot read Property B's
-- tenant/inspection/inspection-item/inspection-photo/compliance-rule/compliance-requirement/
-- compliance-acknowledgement/levy-statement/levy-line-item/property-management-contact/
-- lease-occupant/property-scoped-vendor-bill data by direct query -- and that the same staff
-- member's access to Property A, a tenant's own self-access, and an 'all'-mode staff member's
-- access are all unaffected.

begin;
select plan(29);

insert into auth.users (id, email) values
  ('fa000000-0000-0000-0000-000000000001', 'p0-principal@test.propertyvault.example'),
  ('fa000000-0000-0000-0000-000000000002', 'p0-staff-selected@test.propertyvault.example'),
  ('fa000000-0000-0000-0000-000000000003', 'p0-staff-all@test.propertyvault.example'),
  ('fa000000-0000-0000-0000-000000000004', 'p0-tenant-b-portal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('P0 Isolation Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'P0 Isolation Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001';
select set_config('pgtap.p0.org_id', (select id::text from public.organizations where legal_name = 'P0 Isolation Test Org'), false);

select set_config(
  'pgtap.p0.property_a_id',
  (select public.create_property(current_setting('pgtap.p0.org_id')::uuid, 'Property A', '1 A St', 'Cape Town', 'ZA', 'apartment'::public.property_type)::text),
  false
);
select set_config(
  'pgtap.p0.property_b_id',
  (select public.create_property(current_setting('pgtap.p0.org_id')::uuid, 'Property B', '2 B St', 'Cape Town', 'ZA', 'apartment'::public.property_type)::text),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.p0.property_b_id')::uuid, current_setting('pgtap.p0.org_id')::uuid, 'B1', 'occupied');
select set_config('pgtap.p0.unit_b_id', (select id::text from public.units where unit_label = 'B1'), false);

select set_config('pgtap.p0.category_id', (select id::text from public.document_categories limit 1), false);

-- --- Property B fixtures (everything below must be INVISIBLE to Staff A) ---

-- Tenant B: actually linked to Property B via lease_tenants -> leases -> units (the exact
-- real join path the RLS policy checks, fixing the old test's zero-link flaw). Also carries a
-- real portal login (user_id) so tenant-self access can be proven preserved.
insert into public.tenants (org_id, user_id, full_name, status)
values (current_setting('pgtap.p0.org_id')::uuid, 'fa000000-0000-0000-0000-000000000004', 'Tenant B', 'active');
select set_config('pgtap.p0.tenant_b_id', (select id::text from public.tenants where full_name = 'Tenant B'), false);

insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
values (current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.unit_b_id')::uuid, '2026-01-01', 8000, 'active', 'manual');
select set_config('pgtap.p0.lease_b_id', (select id::text from public.leases where unit_id = current_setting('pgtap.p0.unit_b_id')::uuid), false);

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
values (current_setting('pgtap.p0.lease_b_id')::uuid, current_setting('pgtap.p0.tenant_b_id')::uuid, true);

-- An unassigned tenant (zero lease_tenants links) -- deliberately remains org-wide visible per the
-- migration's own documented bootstrap decision; asserted explicitly below, not just assumed.
insert into public.tenants (org_id, full_name, status)
values (current_setting('pgtap.p0.org_id')::uuid, 'Tenant Unassigned', 'pending');
select set_config('pgtap.p0.tenant_unassigned_id', (select id::text from public.tenants where full_name = 'Tenant Unassigned'), false);

insert into public.lease_occupants (org_id, lease_id, full_name, occupant_type)
values (current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.lease_b_id')::uuid, 'Occupant B', 'child_dependant');
select set_config('pgtap.p0.occupant_b_id', (select id::text from public.lease_occupants where full_name = 'Occupant B'), false);

-- Inspection B (+ item + photo)
insert into public.inspections (org_id, property_id, unit_id, lease_id, inspection_type, scheduled_at, status)
values (current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.property_b_id')::uuid, current_setting('pgtap.p0.unit_b_id')::uuid, current_setting('pgtap.p0.lease_b_id')::uuid, 'move_in', now(), 'scheduled');
select set_config('pgtap.p0.inspection_b_id', (select id::text from public.inspections where property_id = current_setting('pgtap.p0.property_b_id')::uuid), false);

insert into public.inspection_items (inspection_id, room, item_description, condition_rating)
values (current_setting('pgtap.p0.inspection_b_id')::uuid, 'Kitchen', 'Countertop', 'good');
select set_config('pgtap.p0.inspection_item_b_id', (select id::text from public.inspection_items where inspection_id = current_setting('pgtap.p0.inspection_b_id')::uuid), false);

insert into public.documents (owner_user_id, org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values ('fa000000-0000-0000-0000-000000000001', current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.property_b_id')::uuid, current_setting('pgtap.p0.category_id')::uuid, 'other', current_setting('pgtap.p0.org_id') || '/inspection-photo-b.jpg', 'inspection-photo-b.jpg', 'image/jpeg', 100, 'checksum-p0-inspection-photo');
select set_config('pgtap.p0.inspection_photo_doc_id', (select id::text from public.documents where storage_path = current_setting('pgtap.p0.org_id') || '/inspection-photo-b.jpg'), false);

insert into public.inspection_photos (inspection_id, inspection_item_id, document_id)
values (current_setting('pgtap.p0.inspection_b_id')::uuid, current_setting('pgtap.p0.inspection_item_b_id')::uuid, current_setting('pgtap.p0.inspection_photo_doc_id')::uuid);
select set_config('pgtap.p0.inspection_photo_b_id', (select id::text from public.inspection_photos where inspection_id = current_setting('pgtap.p0.inspection_b_id')::uuid), false);

-- Property rule + version (+ compliance requirement, via the real activation RPC) + acknowledgement
select set_config('pgtap.p0.rule_b_id', (select public.create_property_rule(current_setting('pgtap.p0.property_b_id')::uuid, 'conduct_rules', 'Conduct Rules B')::text), false);

insert into public.documents (owner_user_id, org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values ('fa000000-0000-0000-0000-000000000001', current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.property_b_id')::uuid, current_setting('pgtap.p0.category_id')::uuid, 'other', current_setting('pgtap.p0.org_id') || '/rule-b.pdf', 'rule-b.pdf', 'application/pdf', 100, 'checksum-p0-rule-b');
select set_config('pgtap.p0.rule_doc_b_id', (select id::text from public.documents where storage_path = current_setting('pgtap.p0.org_id') || '/rule-b.pdf'), false);

select set_config(
  'pgtap.p0.rule_version_b_id',
  (select public.create_property_rule_version(current_setting('pgtap.p0.rule_b_id')::uuid, current_setting('pgtap.p0.rule_doc_b_id')::uuid, '2026-01-01'::date)::text),
  false
);
select public.activate_property_rule_version(current_setting('pgtap.p0.rule_version_b_id')::uuid);
select set_config(
  'pgtap.p0.requirement_b_id',
  (select id::text from public.compliance_requirements where tenant_id = current_setting('pgtap.p0.tenant_b_id')::uuid),
  false
);

-- Direct insert (service-role fixture, not through acknowledge_compliance_requirement()) -- this
-- test is about STAFF read access to the acknowledgement evidence, not the tenant-acknowledgement
-- flow itself (already covered elsewhere).
reset role;
insert into public.compliance_acknowledgements (requirement_id, org_id, property_id, rule_version_id, tenant_id, lease_id, user_id, acceptance_statement, document_checksum)
values (
  current_setting('pgtap.p0.requirement_b_id')::uuid, current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.property_b_id')::uuid,
  current_setting('pgtap.p0.rule_version_b_id')::uuid, current_setting('pgtap.p0.tenant_b_id')::uuid, current_setting('pgtap.p0.lease_b_id')::uuid,
  'fa000000-0000-0000-0000-000000000004', 'I acknowledge Conduct Rules B', 'checksum-p0-rule-b'
);
select set_config('pgtap.p0.ack_b_id', (select id::text from public.compliance_acknowledgements where tenant_id = current_setting('pgtap.p0.tenant_b_id')::uuid), false);

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001';

-- Levy statement + line item
insert into public.documents (owner_user_id, org_id, property_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values ('fa000000-0000-0000-0000-000000000001', current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.property_b_id')::uuid, current_setting('pgtap.p0.category_id')::uuid, 'statement', current_setting('pgtap.p0.org_id') || '/levy-b.pdf', 'levy-b.pdf', 'application/pdf', 100, 'checksum-p0-levy-b');
select set_config('pgtap.p0.levy_doc_b_id', (select id::text from public.documents where storage_path = current_setting('pgtap.p0.org_id') || '/levy-b.pdf'), false);

insert into public.levy_statements (org_id, property_id, document_id, created_by)
values (current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.property_b_id')::uuid, current_setting('pgtap.p0.levy_doc_b_id')::uuid, 'fa000000-0000-0000-0000-000000000001');
select set_config('pgtap.p0.levy_statement_b_id', (select id::text from public.levy_statements where property_id = current_setting('pgtap.p0.property_b_id')::uuid), false);

insert into public.levy_statement_line_items (statement_id, org_id, line_type, category, amount)
values (current_setting('pgtap.p0.levy_statement_b_id')::uuid, current_setting('pgtap.p0.org_id')::uuid, 'charge', 'monthly_levy', 1850.00);
select set_config('pgtap.p0.levy_line_item_b_id', (select id::text from public.levy_statement_line_items where statement_id = current_setting('pgtap.p0.levy_statement_b_id')::uuid), false);

-- Property management contact
insert into public.property_management_contacts (org_id, property_id, contact_type, name, created_by)
values (current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.property_b_id')::uuid, 'body_corporate', 'Fictional Gardens Body Corporate', 'fa000000-0000-0000-0000-000000000001');
select set_config('pgtap.p0.contact_b_id', (select id::text from public.property_management_contacts where property_id = current_setting('pgtap.p0.property_b_id')::uuid), false);

-- Vendor bill WITH a property-attributing maintenance ticket link, and one WITHOUT (no property
-- context -- expected to remain org-role-gated only, asserted explicitly below).
insert into public.maintenance_tickets (org_id, property_id, submitted_by_user_id, summary)
values (current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.property_b_id')::uuid, 'fa000000-0000-0000-0000-000000000001', 'Property B ticket');
select set_config('pgtap.p0.ticket_b_id', (select id::text from public.maintenance_tickets where property_id = current_setting('pgtap.p0.property_b_id')::uuid), false);

insert into public.vendors (org_id, name, trade_category)
values (current_setting('pgtap.p0.org_id')::uuid, 'Test Plumber', 'plumbing');
select set_config('pgtap.p0.vendor_id', (select id::text from public.vendors where name = 'Test Plumber'), false);

insert into public.vendor_bills (org_id, vendor_id, maintenance_ticket_id, amount, submitted_by)
values (current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.vendor_id')::uuid, current_setting('pgtap.p0.ticket_b_id')::uuid, 450.00, 'fa000000-0000-0000-0000-000000000001');
select set_config('pgtap.p0.vendor_bill_property_b_id', (select id::text from public.vendor_bills where maintenance_ticket_id = current_setting('pgtap.p0.ticket_b_id')::uuid), false);

insert into public.vendor_bills (org_id, vendor_id, maintenance_ticket_id, amount, submitted_by)
values (current_setting('pgtap.p0.org_id')::uuid, current_setting('pgtap.p0.vendor_id')::uuid, null, 100.00, 'fa000000-0000-0000-0000-000000000001');
select set_config('pgtap.p0.vendor_bill_no_property_id', (select id::text from public.vendor_bills where maintenance_ticket_id is null), false);

-- === Staff A: agent, narrowed to 'selected' mode, granted Property A only ===
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values (current_setting('pgtap.p0.org_id')::uuid, 'fa000000-0000-0000-0000-000000000002', 'agent', 'active', now());
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values (current_setting('pgtap.p0.org_id')::uuid, 'fa000000-0000-0000-0000-000000000003', 'agent', 'active', now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001';
select public.set_member_property_access_mode(current_setting('pgtap.p0.org_id')::uuid, 'fa000000-0000-0000-0000-000000000002', 'selected');
select public.revoke_property_access(current_setting('pgtap.p0.property_b_id')::uuid, 'fa000000-0000-0000-0000-000000000002');
select public.grant_property_access(current_setting('pgtap.p0.property_a_id')::uuid, 'fa000000-0000-0000-0000-000000000002', 'property_manager');

-- ============================================================
-- Staff A (selected mode, Property A only): every Property B resource must be invisible
-- ============================================================
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000002';

select ok(
  public.has_property_access(current_setting('pgtap.p0.property_a_id')::uuid, 'read_only'),
  'sanity: Staff A has read access to their own granted Property A'
);

select is((select count(*)::int from public.tenants where id = current_setting('pgtap.p0.tenant_b_id')::uuid), 0,
  'Staff A cannot see Property B''s lease-linked tenant');
select is((select count(*)::int from public.tenants where id = current_setting('pgtap.p0.tenant_unassigned_id')::uuid), 1,
  'Staff A CAN see the unassigned tenant (documented bootstrap allowance -- no property to leak yet)');
select is((select count(*)::int from public.lease_occupants where id = current_setting('pgtap.p0.occupant_b_id')::uuid), 0,
  'Staff A cannot see Property B''s lease occupant');
select is((select count(*)::int from public.inspections where id = current_setting('pgtap.p0.inspection_b_id')::uuid), 0,
  'Staff A cannot see Property B''s inspection');
select is((select count(*)::int from public.inspection_items where id = current_setting('pgtap.p0.inspection_item_b_id')::uuid), 0,
  'Staff A cannot see Property B''s inspection item');
select is((select count(*)::int from public.inspection_photos where id = current_setting('pgtap.p0.inspection_photo_b_id')::uuid), 0,
  'Staff A cannot see Property B''s inspection photo');
select is((select count(*)::int from public.property_rules where id = current_setting('pgtap.p0.rule_b_id')::uuid), 0,
  'Staff A cannot see Property B''s property rule');
select is((select count(*)::int from public.property_rule_versions where id = current_setting('pgtap.p0.rule_version_b_id')::uuid), 0,
  'Staff A cannot see Property B''s property rule version');
select is((select count(*)::int from public.compliance_requirements where id = current_setting('pgtap.p0.requirement_b_id')::uuid), 0,
  'Staff A cannot see Property B''s compliance requirement');
select is((select count(*)::int from public.compliance_acknowledgements where id = current_setting('pgtap.p0.ack_b_id')::uuid), 0,
  'Staff A cannot see Property B''s compliance acknowledgement');
select is((select count(*)::int from public.levy_statements where id = current_setting('pgtap.p0.levy_statement_b_id')::uuid), 0,
  'Staff A cannot see Property B''s levy statement');
select is((select count(*)::int from public.levy_statement_line_items where id = current_setting('pgtap.p0.levy_line_item_b_id')::uuid), 0,
  'Staff A cannot see Property B''s levy statement line item');
select is((select count(*)::int from public.property_management_contacts where id = current_setting('pgtap.p0.contact_b_id')::uuid), 0,
  'Staff A cannot see Property B''s body corporate/managing agent contact');
select is((select count(*)::int from public.vendor_bills where id = current_setting('pgtap.p0.vendor_bill_property_b_id')::uuid), 0,
  'Staff A cannot see the property-attributed vendor bill for Property B');
select is((select count(*)::int from public.vendor_bills where id = current_setting('pgtap.p0.vendor_bill_no_property_id')::uuid), 1,
  'Staff A CAN see the vendor bill with no maintenance-ticket link (no property context to restrict -- org-role gate only, by design)');
select is((select count(*)::int from public.vendors where id = current_setting('pgtap.p0.vendor_id')::uuid), 1,
  'Staff A CAN see the org-wide vendor directory entry (vendors are deliberately not property-scoped)');

-- Direct-ID write attempts must also fail (not just SELECT) -- proves this holds at the RLS layer,
-- not merely hidden in a list query. compliance_requirements has NO client write policy at all
-- (only the SECURITY DEFINER RPCs may ever mutate it) -- so a raw UPDATE affects zero rows rather
-- than throwing; the RPC itself is what throws, since it now checks property-level access too.
update public.compliance_requirements set status = 'waived' where id = current_setting('pgtap.p0.requirement_b_id')::uuid;
select is(
  (select status::text from public.compliance_requirements where id = current_setting('pgtap.p0.requirement_b_id')::uuid),
  null,
  'Staff A''s direct-table UPDATE on Property B''s compliance requirement affects zero rows (no client write policy exists; row also invisible to SELECT)'
);
select throws_ok(
  $$ select public.waive_compliance_requirement(current_setting('pgtap.p0.requirement_b_id')::uuid, 'test reason') $$,
  null, null,
  'Staff A cannot waive Property B''s compliance requirement via the RPC (waive_compliance_requirement now checks property_manager/owner access)'
);

-- ============================================================
-- Granting Property B access immediately restores visibility -- proves the denial above is really
-- the selected-mode narrowing, not a permanent/unrelated block.
-- ============================================================
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001';
select public.grant_property_access(current_setting('pgtap.p0.property_b_id')::uuid, 'fa000000-0000-0000-0000-000000000002', 'property_manager');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.tenants where id = current_setting('pgtap.p0.tenant_b_id')::uuid), 1,
  'granting Property B access immediately restores tenant visibility');
select is((select count(*)::int from public.inspections where id = current_setting('pgtap.p0.inspection_b_id')::uuid), 1,
  'granting Property B access immediately restores inspection visibility');
select is((select count(*)::int from public.compliance_requirements where id = current_setting('pgtap.p0.requirement_b_id')::uuid), 1,
  'granting Property B access immediately restores compliance requirement visibility');
select is((select count(*)::int from public.levy_statements where id = current_setting('pgtap.p0.levy_statement_b_id')::uuid), 1,
  'granting Property B access immediately restores levy statement visibility');

-- ============================================================
-- Staff C ('all' mode, unaffected default): sees Property B data without any explicit grant
-- ============================================================
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.tenants where id = current_setting('pgtap.p0.tenant_b_id')::uuid), 1,
  'an ''all''-mode staff member (default, unaffected) sees Property B''s tenant with no explicit grant');
select is((select count(*)::int from public.levy_statements where id = current_setting('pgtap.p0.levy_statement_b_id')::uuid), 1,
  'an ''all''-mode staff member sees Property B''s levy statement with no explicit grant');

-- ============================================================
-- Tenant B''s own portal access (self, zero property_access grants at all) is preserved
-- ============================================================
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000004';
select is((select count(*)::int from public.tenants where id = current_setting('pgtap.p0.tenant_b_id')::uuid), 1,
  'Tenant B can see their own tenant record via user_id self-access, despite zero property_access grants');
select is((select count(*)::int from public.compliance_requirements where id = current_setting('pgtap.p0.requirement_b_id')::uuid), 1,
  'Tenant B can see their own compliance requirement via caller_tenant_ids() self-access');
select is((select count(*)::int from public.property_rule_versions where id = current_setting('pgtap.p0.rule_version_b_id')::uuid), 1,
  'Tenant B can see the rule version they were assigned, via the untouched tenant-self policy');

select * from finish();
rollback;
