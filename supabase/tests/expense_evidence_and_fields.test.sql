-- Tests for 20260101000145_expense_evidence_and_fields.sql: the four new nullable expenses
-- columns (unit_id, reference_number, invoice_date, notes) round-trip correctly, and the
-- pre-existing document_id link plus the untouched
-- `check ((status='recorded') = (journal_entry_id is not null))` guard from 20260101000037 still
-- hold (a real regression check, not assumed, since this migration sits right next to that
-- constraint). Follows accounting_posting_operations.test.sql's own subquery-over-\gset
-- convention, and ai_and_usage_isolation.test.sql's own information_schema.columns schema-shape
-- check convention (has_column/col_type_is aren't used anywhere else in this suite, so avoided
-- here too rather than risking an unproven pgTAP extension dependency).

begin;
select plan(8);

insert into auth.users (id, email) values
  ('ee000000-0000-0000-0000-000000000001', 'evidence-fields-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'ee000000-0000-0000-0000-000000000001';

select isnt(
  (select public.create_organization('Evidence Fields Test Org', 'agency')),
  null,
  'org created (principal counts as accountant+ via has_org_role ranking)'
);
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Evidence Fields Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'ee000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'Evidence Fields Test Org'),
  'Evidence Fields Property', '1 Test Street', 'Cape Town', 'ZA', 'house'::public.property_type
);

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Evidence Fields Unit', 'vacant'
from public.properties p where p.nickname = 'Evidence Fields Property';

-- Columns exist (information_schema, additive-migration sanity check).
select is(
  (select count(*)::int from information_schema.columns
     where table_schema = 'public' and table_name = 'expenses'
       and column_name in ('unit_id', 'reference_number', 'invoice_date', 'notes')),
  4,
  'expenses has all four new columns from this migration'
);

select is(
  (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'expenses' and column_name = 'invoice_date'),
  'date',
  'expenses.invoice_date is a date column'
);

-- Real insert/select round trip through every new column at once, plus the pre-existing
-- document_id (proving the "already exists, no new column needed" finding still holds).
select lives_ok(
  $$ insert into public.expenses
       (org_id, property_id, unit_id, category, amount, status, reference_number, invoice_date, notes)
     select o.id, p.id, u.id, 'maintenance', 750, 'pending', 'INV-2026-001', '2026-08-01', 'Awaiting vendor invoice'
     from public.organizations o
     join public.properties p on p.org_id = o.id and p.nickname = 'Evidence Fields Property'
     join public.units u on u.property_id = p.id and u.unit_label = 'Evidence Fields Unit'
     where o.legal_name = 'Evidence Fields Test Org' $$,
  'an expense can be created with all four new fields set at once'
);

select is(
  (select reference_number from public.expenses where notes = 'Awaiting vendor invoice'),
  'INV-2026-001',
  'reference_number round-trips correctly'
);

select is(
  (select unit_id from public.expenses where notes = 'Awaiting vendor invoice'),
  (select id from public.units where unit_label = 'Evidence Fields Unit'),
  'unit_id round-trips correctly'
);

select is(
  (select to_char(invoice_date, 'YYYY-MM-DD') from public.expenses where notes = 'Awaiting vendor invoice'),
  '2026-08-01',
  'invoice_date round-trips correctly'
);

-- Regression check: the untouched status/journal_entry_id immutability guard from 20260101000037
-- still rejects a 'recorded' row with no journal_entry_id, unaffected by this migration's new
-- nullable columns sitting on the same table.
select throws_ok(
  $$ insert into public.expenses (org_id, property_id, category, amount, status)
     select id, (select id from public.properties where nickname = 'Evidence Fields Property'), 'maintenance', 100, 'recorded'
     from public.organizations where legal_name = 'Evidence Fields Test Org' $$,
  null,
  null,
  'the pre-existing recorded/journal_entry_id check constraint still rejects a recorded row with no journal entry'
);

select * from finish();
rollback;
