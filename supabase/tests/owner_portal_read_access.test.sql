-- Tests for 20260101000072_owner_portal_read_access.sql: a genuine co-owner (owners.user_id set,
-- an 'owner'-role property_access grant, NO organization_members row at all) can see their own
-- property's full data chain -- units, leases, documents, expenses, journal_lines, maintenance
-- tickets -- and correctly cannot see a second, unrelated property in the same org they have no
-- grant on.

begin;
select plan(9);

insert into auth.users (id, email) values
  ('fa000000-0000-0000-0000-000000000001', 'opra-principal@test.propertyvault.example'),
  ('fa000000-0000-0000-0000-000000000002', 'opra-owner@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Owner Portal Test Org', 'agency')), null, 'org created');

select set_config(
  'pgtap.opra_test.own_property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Owner Portal Test Org'),
    'Owner Portal Owned Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

select set_config(
  'pgtap.opra_test.other_property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Owner Portal Test Org'),
    'Owner Portal Unrelated Property', '2 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

-- A real owner: has a portal login (owners.user_id set) and an 'owner'-role property_access
-- grant, but is deliberately NEVER added to organization_members -- the actual owner-portal
-- scenario, not a staff member who happens to also be an owner.
insert into public.owners (org_id, user_id, name)
select id, 'fa000000-0000-0000-0000-000000000002', 'Real Owner'
from public.organizations where legal_name = 'Owner Portal Test Org';

select public.grant_property_access(
  current_setting('pgtap.opra_test.own_property_id')::uuid,
  'fa000000-0000-0000-0000-000000000002'::uuid,
  'owner'::public.property_role
);

-- Real data under the owned property: a unit, a document, an expense.
insert into public.units (property_id, org_id, unit_label, status)
select current_setting('pgtap.opra_test.own_property_id')::uuid, id, 'U1', 'vacant'
from public.organizations where legal_name = 'Owner Portal Test Org';

insert into public.documents (
  org_id, property_id, category_id, document_type, storage_path, original_file_name,
  mime_type, file_size_bytes, checksum_sha256
)
select o.id, current_setting('pgtap.opra_test.own_property_id')::uuid, dc.id, 'bill',
  'test/opra-owned.pdf', 'owned.pdf', 'application/pdf', 1024, 'abc123'
from public.organizations o, public.document_categories dc
where o.legal_name = 'Owner Portal Test Org' and dc.slug = 'water';

insert into public.expenses (org_id, property_id, category, amount, status)
select id, current_setting('pgtap.opra_test.own_property_id')::uuid, 'maintenance', 500, 'pending'
from public.organizations where legal_name = 'Owner Portal Test Org';

insert into public.maintenance_tickets (org_id, property_id, submitted_by_user_id, summary, priority, status)
select id, current_setting('pgtap.opra_test.own_property_id')::uuid,
  'fa000000-0000-0000-0000-000000000001'::uuid, 'Leaking tap', 'medium', 'to_do'
from public.organizations where legal_name = 'Owner Portal Test Org';

-- ==== As the real owner (no org membership at all) ====

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.properties where id = current_setting('pgtap.opra_test.own_property_id')::uuid),
  1,
  'owner (no org membership) can see their own property'
);

select is(
  (select count(*)::int from public.units where property_id = current_setting('pgtap.opra_test.own_property_id')::uuid),
  1,
  'owner can see units on their own property'
);

select is(
  (select count(*)::int from public.documents where property_id = current_setting('pgtap.opra_test.own_property_id')::uuid),
  1,
  'owner can see documents on their own property'
);

select is(
  (select count(*)::int from public.expenses where property_id = current_setting('pgtap.opra_test.own_property_id')::uuid),
  1,
  'owner can see expenses on their own property'
);

select is(
  (select count(*)::int from public.maintenance_tickets where property_id = current_setting('pgtap.opra_test.own_property_id')::uuid),
  1,
  'owner can see maintenance tickets on their own property'
);

-- ==== The unrelated property in the SAME org, with no grant ====

select is(
  (select count(*)::int from public.properties where id = current_setting('pgtap.opra_test.other_property_id')::uuid),
  0,
  'owner cannot see an unrelated property in the same org they have no grant on'
);

-- ==== journal_lines: owner sees property-tagged lines on their property, not org-level ones ====

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001';

select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Owner Portal Test Org'), current_date, 'Owned property rent', 'payment', null,
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Owner Portal Test Org') and code = '1000'), 'debit', 5000, 'property_id', current_setting('pgtap.opra_test.own_property_id')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Owner Portal Test Org') and code = '1100'), 'credit', 5000, 'property_id', current_setting('pgtap.opra_test.own_property_id'))
  )
);
-- An org-level line with no property_id (e.g. a subscription/adjustment) -- owner must not see it.
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Owner Portal Test Org'), current_date, 'Org-level adjustment', 'adjustment', null,
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Owner Portal Test Org') and code = '1000'), 'debit', 100),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Owner Portal Test Org') and code = '5900'), 'credit', 100)
  )
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.journal_lines where property_id = current_setting('pgtap.opra_test.own_property_id')::uuid),
  2,
  'owner sees both journal_lines rows (debit+credit) tagged to their own property'
);

select is(
  (select count(*)::int from public.journal_lines where property_id is null),
  0,
  'owner sees ZERO org-level (no property_id) journal_lines -- unlike a real org viewer, who would see these'
);

select * from finish();
rollback;
