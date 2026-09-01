-- Tests for the manual (non-rent) tenant invoice RPCs (migration 20260101000152, overnight V1
-- completion pass Part B): create_manual_invoice(), update_manual_invoice(), issue_manual_invoice(),
-- record_invoice_payment(). Same end-to-end style as accounting_posting_operations.test.sql --
-- real org/property/unit/tenant/lease, real role-switching via request.jwt.claim.sub, subquery
-- lookups instead of \gset (that file's own established fix for interpolation inside $$ blocks).

begin;
select plan(25);

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'manual-invoice-accountant@test.propertyvault.example'),
  ('b1000000-0000-0000-0000-000000000002', 'manual-invoice-agent-only@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

select isnt(
  (select public.create_organization('Manual Invoice Test Org', 'agency')),
  null,
  'org created (principal counts as accountant+ via has_org_role ranking)'
);
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Manual Invoice Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'b1000000-0000-0000-0000-000000000002'::uuid, 'agent', 'active', now()
from public.organizations where legal_name = 'Manual Invoice Test Org';

-- Final hardening pass (migration 154): invoice_prefix must actually be honoured now.
update public.organizations set invoice_prefix = 'MIT', invoice_address = '1 Test Street, Cape Town',
  invoice_payment_instructions = 'EFT to Test Bank, Account 12345', invoice_footer = 'Thank you for your business.'
  where legal_name = 'Manual Invoice Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'Manual Invoice Test Org'),
  'Manual Invoice Property', '1 Test Street', 'Cape Town', 'ZA', 'house'::public.property_type
);

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Manual Invoice Unit', 'occupied'
from public.properties p where p.nickname = 'Manual Invoice Property';

insert into public.tenants (org_id, full_name, status)
select id, 'Manual Invoice Tenant', 'active'
from public.organizations where legal_name = 'Manual Invoice Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 8500, 8500, 'active', 'manual'
from public.organizations o
join public.units u on u.org_id = o.id and u.unit_label = 'Manual Invoice Unit'
where o.legal_name = 'Manual Invoice Test Org';

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'Manual Invoice Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'Manual Invoice Tenant';

-- === role split: an agent-only member cannot create a manual invoice ===
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.create_manual_invoice(
       (select id from public.organizations where legal_name = 'Manual Invoice Test Org'),
       (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Manual Invoice Test Org'),
       (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Manual Invoice Test Org'),
       current_date, current_date + 7, 'REF-1', 'Water and electricity', null,
       '[{"description":"Water","quantity":1,"unitPrice":250},{"description":"Electricity","quantity":1,"unitPrice":400}]'::jsonb
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'an agent-only member cannot create a manual invoice -- accountant+ only, not agent'
);

set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

-- === create_manual_invoice(): always draft, real line items, amount = sum(qty*rate) ===
select lives_ok(
  $$ select public.create_manual_invoice(
       (select id from public.organizations where legal_name = 'Manual Invoice Test Org'),
       (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Manual Invoice Test Org'),
       (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Manual Invoice Test Org'),
       current_date, current_date + 7, 'REF-1', 'Water and electricity', null,
       '[{"description":"Water","quantity":1,"unitPrice":250},{"description":"Electricity","quantity":1,"unitPrice":400}]'::jsonb
     ) $$,
  'accountant (principal) can create a manual invoice'
);

select is(
  (select i.status from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
  'draft'::public.invoice_status,
  'the new invoice is a draft -- no journal entry posted yet'
);

select is(
  (select i.amount from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
  650::numeric,
  'invoice amount is the sum of both line items (250 + 400)'
);

select is(
  (select count(*) from public.invoice_line_items ili
     join public.invoices i on i.id = ili.invoice_id
     join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Manual Invoice Test Org'),
  2::bigint,
  'two real invoice_line_items rows were created'
);

select is(
  (select count(*) from public.journal_entries je where je.description = 'Water and electricity'),
  0::bigint,
  'no journal entry exists yet for a draft manual invoice'
);

-- Final hardening pass (migration 154): the org's own invoice_prefix ('MIT') is actually honoured.
select ok(
  (select i.invoice_number from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org') like 'MIT-%',
  'the invoice number uses this org''s configured invoice_prefix (MIT-), not the old hardcoded INV-'
);

select is(
  (select i.presentation_snapshot from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
  null,
  'presentation_snapshot is still null for a draft invoice -- only frozen at issue time'
);

-- === update_manual_invoice(): draft only, replaces line items, recomputes amount ===
select lives_ok(
  $$ select public.update_manual_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
       current_date, current_date + 14, 'REF-1-EDITED', 'Water only (corrected)', 'tenant disputed electricity portion',
       '[{"description":"Water","quantity":1,"unitPrice":250}]'::jsonb
     ) $$,
  'a draft manual invoice can be edited'
);

select is(
  (select i.amount from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
  250::numeric,
  'amount was recomputed after the edit (electricity line removed)'
);

select is(
  (select count(*) from public.invoice_line_items ili
     join public.invoices i on i.id = ili.invoice_id
     join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Manual Invoice Test Org'),
  1::bigint,
  'line items were fully replaced, not appended (one row remains, not three)'
);

-- === issue_manual_invoice(): locks, posts the AR/income journal entry ===
select lives_ok(
  $$ select public.issue_manual_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org')
     ) $$,
  'a draft manual invoice can be issued'
);

select is(
  (select i.status from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
  'issued'::public.invoice_status,
  'the invoice moved to issued'
);

-- Final hardening pass (migration 154): presentation_snapshot is now frozen at issue time.
select is(
  (select i.presentation_snapshot ->> 'orgAddress' from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
  '1 Test Street, Cape Town',
  'presentation_snapshot froze the org''s invoice_address at issue time'
);

select is(
  (select i.presentation_snapshot ->> 'paymentInstructions' from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
  'EFT to Test Bank, Account 12345',
  'presentation_snapshot froze the org''s payment instructions at issue time'
);

-- Changing the org's settings AFTER issue must not retroactively change what the issued invoice says.
update public.organizations set invoice_address = 'CHANGED AFTER ISSUE -- must not appear on the frozen invoice'
  where legal_name = 'Manual Invoice Test Org';

select is(
  (select i.presentation_snapshot ->> 'orgAddress' from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
  '1 Test Street, Cape Town',
  'a later settings change does not retroactively rewrite an already-issued invoice''s frozen snapshot'
);

select is(
  (select sum(jl.debit) - sum(jl.credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_type = 'rent_invoice' and je.description = 'Water only (corrected)'),
  0::numeric,
  'the journal entry posted at issue time is balanced'
);

select is(
  (select co.code from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where je.description = 'Water only (corrected)' and jl.debit > 0),
  '1100',
  'the debit line posted to Accounts Receivable (1100), the same account rent invoices use'
);

-- === once issued, editing is refused -- financial history is not silently mutated ===
select throws_ok(
  $$ select public.update_manual_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
       current_date, current_date + 14, 'REF-2', 'Attempted post-issue edit', null,
       '[{"description":"Should not apply","quantity":1,"unitPrice":9999}]'::jsonb
     ) $$,
  'P0001',
  'Only draft invoices can be edited -- this invoice has already been issued',
  'editing an issued manual invoice is refused'
);

-- === record_invoice_payment(): issued only ===
select lives_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org'),
       250, current_date, 'eft', 'REF-PAY-1', 'Paid in full via EFT'
     ) $$,
  'a payment can be recorded against an issued manual invoice'
);

select is(
  (select count(*) from public.invoice_payments ip
     join public.invoices i on i.id = ip.invoice_id
     join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Manual Invoice Test Org'),
  1::bigint,
  'one invoice_payments row exists'
);

-- === P0-2 fix (migration 153): the payment must post a balanced GL entry, crediting AR (1100) --
-- otherwise the invoice would say Paid while the Trial Balance still shows the receivable open.
select is(
  (select sum(jl.debit) - sum(jl.credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_type = 'payment' and je.description = 'Manual invoice payment received'),
  0::numeric,
  'the manual-invoice payment journal entry is balanced'
);

select is(
  (select co.code from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where je.description = 'Manual invoice payment received' and jl.credit > 0),
  '1100',
  'the credit line reduces Accounts Receivable (1100), the same account issue_manual_invoice() debited'
);

-- A second, brand-new draft invoice to prove payments are refused pre-issue.
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Manual Invoice Test Org'),
  (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Manual Invoice Test Org'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Manual Invoice Test Org'),
  current_date, current_date + 7, 'REF-3', 'Parking fee', null,
  '[{"description":"Parking","quantity":1,"unitPrice":300}]'::jsonb
);

select throws_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Manual Invoice Test Org' and i.description = 'Parking fee'),
       300, current_date, 'eft', null, null
     ) $$,
  'P0001',
  'Only issued invoices can have payments recorded against them',
  'recording a payment against a draft invoice is refused'
);

select * from finish();
rollback;
