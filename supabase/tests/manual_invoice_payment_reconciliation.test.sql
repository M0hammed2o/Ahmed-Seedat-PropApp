-- Final accounting reconciliation pass (WORKLOG.md this date), P0 mandatory tests A-H: proves the
-- migration 157 payment-allocation model closes the economic-duplication risk end-to-end, not just
-- that the individual RPCs run without error. Same real end-to-end style as the other accounting
-- pgTAP suites (create_organization() + role-switching via request.jwt.claim.sub). Each payment's
-- own journal entry is looked up by je.source_id = the specific invoice_payments row it belongs to
-- (post_journal_entry()'s p_source_id, migration 152/153/157) rather than by description text, so
-- amounts from different payments/invoices in this same test file are never accidentally summed
-- together.

begin;
select plan(19);

insert into auth.users (id, email) values
  ('c2000000-0000-0000-0000-000000000001', 'reconciliation-accountant@test.propertyvault.example'),
  ('c2000000-0000-0000-0000-000000000002', 'reconciliation-other-org@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';
select public.create_organization('Reconciliation Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Reconciliation Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

-- A second, unrelated org for the cross-org test (H).
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000002';
select public.create_organization('Reconciliation Other Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Reconciliation Other Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'Reconciliation Test Org'),
  'Reconciliation Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Reconciliation Unit', 'occupied' from public.properties p where p.nickname = 'Reconciliation Property';
insert into public.tenants (org_id, full_name, status)
select id, 'Reconciliation Tenant', 'active' from public.organizations where legal_name = 'Reconciliation Test Org';
-- A second unit/tenant/lease/rent-schedule -- proves manual-invoice and rent-invoice machinery
-- coexist (Test G) without sharing or corrupting each other's payment allocations.
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Reconciliation Rent Unit', 'occupied' from public.properties p where p.nickname = 'Reconciliation Property';
insert into public.tenants (org_id, full_name, status)
select id, 'Reconciliation Rent Tenant', 'active' from public.organizations where legal_name = 'Reconciliation Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 8500, 8500, 'active', 'manual'
from public.organizations o
join public.units u on u.org_id = o.id and u.unit_label = 'Reconciliation Unit'
where o.legal_name = 'Reconciliation Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 9500, 9500, 'active', 'manual'
from public.organizations o
join public.units u on u.org_id = o.id and u.unit_label = 'Reconciliation Rent Unit'
where o.legal_name = 'Reconciliation Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true
from public.leases l
join public.units u on u.id = l.unit_id
join public.organizations o on o.id = l.org_id and o.legal_name = 'Reconciliation Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'Reconciliation Tenant'
where u.unit_label = 'Reconciliation Unit';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true
from public.leases l
join public.units u on u.id = l.unit_id
join public.organizations o on o.id = l.org_id and o.legal_name = 'Reconciliation Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'Reconciliation Rent Tenant'
where u.unit_label = 'Reconciliation Rent Unit';

insert into public.bank_accounts (org_id, account_class, bank_name)
select id, 'business', 'Reconciliation Test Bank' from public.organizations where legal_name = 'Reconciliation Test Org';

-- === A/C/D: manual invoice R1000, partial then full payment, AR and Bank both agree exactly ===
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reconciliation Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reconciliation Test Org' and t.full_name = 'Reconciliation Tenant'),
  current_date, current_date + 7, 'REF-A', 'Reconciliation invoice A', null,
  '[{"description":"Water","quantity":1,"unitPrice":1000}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A')
);

-- C: partial R400 payment.
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A'),
  400, current_date, 'eft', 'Partial payment'
);

select is(
  (select coalesce(sum(ip.amount), 0) from public.invoice_payments ip
     join public.invoices i on i.id = ip.invoice_id
     join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A'),
  400::numeric,
  'C: R400 recorded against the R1000 invoice'
);

select is(
  (select i.amount - coalesce((select sum(invoice_payments.amount) from public.invoice_payments where invoice_id = i.id), 0)
     from public.invoices i join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A'),
  600::numeric,
  'C: balance is exactly R600 after the partial payment'
);

-- The real ledger AR balance for invoice A specifically: DR 1000 at issue (source_id = invoice A's
-- own id) minus CR 400 at the partial payment (source_id = that invoice_payments row's id).
select is(
  (select
     (select sum(jl.debit) from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id join public.chart_of_accounts co on co.id = jl.account_id where co.code = '1100' and je.source_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A'))
     -
     (select coalesce(sum(jl.credit), 0) from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id join public.chart_of_accounts co on co.id = jl.account_id where co.code = '1100' and je.source_id in (select id from public.invoice_payments where invoice_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A')))
  ),
  600::numeric,
  'C: the real ledger Accounts Receivable balance for invoice A is exactly R600 -- not just the display total'
);

-- D: second genuine R600 receipt covers the remainder exactly.
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A'),
  600, current_date, 'eft', 'Final payment'
);

select is(
  (select i.amount - coalesce((select sum(invoice_payments.amount) from public.invoice_payments where invoice_id = i.id), 0)
     from public.invoices i join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A'),
  0::numeric,
  'D: balance is exactly R0 after the second, covering payment'
);

select is(
  (select
     (select sum(jl.debit) from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id join public.chart_of_accounts co on co.id = jl.account_id where co.code = '1100' and je.source_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A'))
     -
     (select coalesce(sum(jl.credit), 0) from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id join public.chart_of_accounts co on co.id = jl.account_id where co.code = '1100' and je.source_id in (select id from public.invoice_payments where invoice_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A')))
  ),
  0::numeric,
  'D: the real ledger AR balance for invoice A is exactly R0 -- fully reconciled'
);

select is(
  (select sum(jl.debit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where co.code = '1000'
       and je.source_id in (select id from public.invoice_payments where invoice_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice A'))
  ),
  1000::numeric,
  'A: Bank (1000) was debited by exactly R1000 total across both real payments (400+600) for invoice A -- matches the AR credit exactly'
);

-- === B: the same real payment cannot be independently re-consumed through another supported path
-- === without being detected/rejected ===
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 1000, 'Reconciliation invoice B deposit'
from public.bank_accounts ba where ba.bank_name = 'Reconciliation Test Bank';

select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reconciliation Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reconciliation Test Org' and t.full_name = 'Reconciliation Tenant'),
  current_date, current_date + 7, 'REF-B', 'Reconciliation invoice B', null,
  '[{"description":"Repairs","quantity":1,"unitPrice":1000}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice B')
);

-- Record the payment WITH the bank transaction explicitly linked.
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice B'),
  1000, current_date, 'eft', 'Linked to real bank deposit',
  (select id from public.bank_transactions where description = 'Reconciliation invoice B deposit')
);

select is(
  (select match_status::text from public.bank_transactions where description = 'Reconciliation invoice B deposit'),
  'matched',
  'B: the linked bank transaction is now marked matched'
);

-- A second, unrelated pending rent schedule this same bank transaction might otherwise have been
-- (mis)matched against -- proves the existing confirm_bank_transaction_match() guard now also
-- protects a manual-invoice-linked transaction.
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, current_date, 1000, 'pending'
from public.leases l
join public.units u on u.id = l.unit_id
join public.organizations o on o.id = l.org_id and o.legal_name = 'Reconciliation Test Org'
where u.unit_label = 'Reconciliation Rent Unit';

select throws_ok(
  $$ select public.confirm_bank_transaction_match(
       (select id from public.bank_transactions where description = 'Reconciliation invoice B deposit'),
       (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Rent Unit')
     ) $$,
  'P0001',
  null,
  'B: the same bank transaction cannot then be matched against an unrelated rent schedule -- already matched, existing guard now also covers this'
);

-- Nor can it be linked to a SECOND invoice_payments row (a different invoice trying to reuse the
-- same already-matched bank transaction).
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reconciliation Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reconciliation Test Org' and t.full_name = 'Reconciliation Tenant'),
  current_date, current_date + 7, 'REF-B2', 'Reconciliation invoice B2', null,
  '[{"description":"Should not matter","quantity":1,"unitPrice":1000}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice B2')
);

select throws_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice B2'),
       1000, current_date, 'eft', 'Attempted reuse',
       (select id from public.bank_transactions where description = 'Reconciliation invoice B deposit')
     ) $$,
  'P0001',
  'This bank transaction has already been matched/allocated elsewhere',
  'B: the same bank transaction cannot be linked to a second, different invoice''s payment either'
);

-- The B2 invoice remains genuinely unpaid -- the rejected attempt did not silently record anything.
select is(
  (select coalesce(sum(invoice_payments.amount), 0) from public.invoice_payments where invoice_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice B2')),
  0::numeric,
  'B: the rejected reuse attempt recorded zero payment against invoice B2'
);

-- === E: overpayment is explicit and safe, never silent ===
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reconciliation Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reconciliation Test Org' and t.full_name = 'Reconciliation Tenant'),
  current_date, current_date + 7, 'REF-E', 'Reconciliation invoice E', null,
  '[{"description":"Overpayment test","quantity":1,"unitPrice":600}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice E')
);

select throws_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice E'),
       700, current_date, 'eft', 'Accidental overpayment'
     ) $$,
  'P0001',
  null,
  'E: a R700 payment against a R600 invoice is refused by default (would overpay, not explicitly confirmed)'
);

select lives_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice E'),
       700, current_date, 'eft', 'Confirmed overpayment', null, true
     ) $$,
  'E: the same R700 payment succeeds once allow_overpayment is explicitly passed'
);

select is(
  (select i.amount - coalesce((select sum(invoice_payments.amount) from public.invoice_payments where invoice_id = i.id), 0)
     from public.invoices i join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice E'),
  -100::numeric,
  'E: the resulting balance explicitly shows -R100 (overpaid by R100), not silently clamped to zero'
);

-- === F: rent invoice reconciliation is completely unaffected by any of this ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Reconciliation Test Org'),
  'Reconciliation Rent Property F', '2 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'F Unit', 'occupied' from public.properties p where p.nickname = 'Reconciliation Rent Property F';
insert into public.tenants (org_id, full_name, status)
select id, 'Reconciliation Rent Tenant F', 'active' from public.organizations where legal_name = 'Reconciliation Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 5000, 5000, 'active', 'manual'
from public.organizations o
join public.units u on u.org_id = o.id and u.unit_label = 'F Unit'
where o.legal_name = 'Reconciliation Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'F Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Reconciliation Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'Reconciliation Rent Tenant F';
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select l.org_id, l.id, current_date, 5000, 'pending'
from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'F Unit';
select public.invoice_rent_schedule(
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'F Unit')
);
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 5000, 'Reconciliation F rent payment'
from public.bank_accounts ba where ba.bank_name = 'Reconciliation Test Bank';
select public.confirm_bank_transaction_match(
  (select id from public.bank_transactions where description = 'Reconciliation F rent payment'),
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'F Unit')
);
select is(
  (select rs.status::text from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'F Unit'),
  'paid',
  'F: ordinary rent-invoice matching still works exactly as before -- unaffected by the manual-invoice payment-allocation changes'
);

-- === G: manual invoice and rent invoice coexist without sharing/corrupting payment allocations ===
-- The rent tenant/lease created at the top of this file already has its OWN pending rent_schedule
-- (inserted for Test B, amount 1000, due_date=current_date) -- reused here rather than inserting a
-- second row for the same (lease_id, due_date), which the real unique constraint would reject.
-- Invoiced and paid independently of every manual invoice above -- proves the two mechanisms never
-- bleed into each other's totals.
select public.invoice_rent_schedule(
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Rent Unit' and rs.status = 'pending')
);
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 1000, 'Reconciliation G rent payment'
from public.bank_accounts ba where ba.bank_name = 'Reconciliation Test Bank';
select public.confirm_bank_transaction_match(
  (select id from public.bank_transactions where description = 'Reconciliation G rent payment'),
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Rent Unit')
);
select is(
  (select rs.status::text from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Rent Unit'),
  'paid',
  'G: the rent schedule for the SAME PROPERTY (different unit/tenant) as every manual invoice above paid correctly, with its own independent total'
);
select is(
  (select count(*) from public.invoice_payments ip
     join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Rent Unit')),
  0::bigint,
  'G: zero invoice_payments rows exist against the rent lease -- manual-invoice payment recording never touched it'
);

-- === H: cross-org payment/allocation attempt is blocked ===
-- The active session is still authenticated as the FIRST org's user, who cannot even see
-- "Reconciliation Other Org" (organizations_select_org_member) -- these two fixture rows must be
-- inserted as service role, or the org/bank_account lookups below silently resolve to zero rows
-- rather than genuinely testing the cross-org rejection (found by running this: the first version
-- of this test inserted nothing, record_invoice_payment() received a NULL p_bank_transaction_id,
-- and the "rejection" trivially never happened).
-- record_invoice_payment()'s own SELECT of the bank transaction (not security definer) is ALSO
-- RLS-scoped to the caller -- a bare `select id from bank_transactions where description = ...`
-- run later as the org-1 user would itself resolve to nothing, making the "rejection" test vacuous
-- (found by running this the first way: the throws_ok call silently passed NULL, never actually
-- attempting a cross-org link at all). A session-local temp table has no RLS at all, so it is used
-- purely as a plain value carrier between the service-role fixture setup and the later
-- authenticated-role calls -- not a security bypass of anything under test.
reset role;
insert into public.bank_accounts (org_id, account_class, bank_name)
select id, 'business', 'Other Org Bank' from public.organizations where legal_name = 'Reconciliation Other Org';
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 500, 'Other org deposit'
from public.bank_accounts ba where ba.bank_name = 'Other Org Bank';
create temporary table tmp_other_org_bank_txn as
  select id from public.bank_transactions where description = 'Other org deposit';
grant select on tmp_other_org_bank_txn to authenticated;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reconciliation Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'Reconciliation Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reconciliation Test Org' and t.full_name = 'Reconciliation Tenant'),
  current_date, current_date + 7, 'REF-H', 'Reconciliation invoice H', null,
  '[{"description":"Cross-org test","quantity":1,"unitPrice":500}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice H')
);

-- RLS hides the other org's bank_transactions row from this caller entirely
-- (bank_transactions_select_org_member) -- record_invoice_payment()'s own `select ... into
-- v_bank_txn` therefore resolves NOT FOUND before its explicit org-mismatch check ever runs, the
-- same "never confirm a hidden resource's existence" pattern already used elsewhere in this
-- codebase (e.g. invoice_immutability_rls.test.sql's Test 6b). Either way the attempt is refused.
select throws_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice H'),
       500, current_date, 'eft', 'Cross-org attempt',
       (select id from tmp_other_org_bank_txn)
     ) $$,
  'P0001',
  'Bank transaction not found',
  'H: linking a bank transaction from a completely different org is refused (hidden by RLS, never confirmed to exist)'
);

select is(
  (select coalesce(sum(invoice_payments.amount), 0) from public.invoice_payments where invoice_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reconciliation Test Org' and i.description = 'Reconciliation invoice H')),
  0::numeric,
  'H: the rejected cross-org attempt recorded zero payment'
);

-- Verified as service role -- the org-1-scoped session can't see this row at all, by design.
reset role;
select is(
  (select match_status::text from public.bank_transactions where description = 'Other org deposit'),
  'unmatched',
  'H: the other org''s bank transaction is untouched'
);

select * from finish();
rollback;
