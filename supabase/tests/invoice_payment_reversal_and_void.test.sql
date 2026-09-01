-- Tests for the genuinely new Phase 2 capabilities added by migration 20260101000158
-- (unified invoice-payment ledger, Option A): reverse_invoice_payment(), void_invoice(),
-- link_bank_transaction_to_invoice_payment(), and record_invoice_payment() now also accepting
-- rent-sourced invoices. manual_invoice_payment_reconciliation.test.sql already proves the
-- economic/GL-duplication properties of record_invoice_payment() itself in depth; this file proves
-- the three new RPCs plus the rent-invoice extension, end to end, including the accountant+
-- permission gate on each (Agent excluded from V1 payment workflows per the approved brief).

begin;
select plan(40);

insert into auth.users (id, email) values
  ('d3000000-0000-0000-0000-000000000001', 'reversal-void-accountant@test.propertyvault.example'),
  ('d3000000-0000-0000-0000-000000000002', 'reversal-void-agent-only@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001';
select public.create_organization('Reversal Void Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Reversal Void Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001';

-- Agent-only member -- proves reversal/void/link are accountant+ only, not agent, matching
-- record_invoice_payment()'s own gate and PERMISSIONS.md's role split.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'd3000000-0000-0000-0000-000000000002'::uuid, 'agent', 'active', now()
from public.organizations where legal_name = 'Reversal Void Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'Reversal Void Test Org'),
  'Reversal Void Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'RV Unit', 'occupied' from public.properties p where p.nickname = 'Reversal Void Property';
insert into public.tenants (org_id, full_name, status)
select id, 'RV Tenant', 'active' from public.organizations where legal_name = 'Reversal Void Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 2000, 2000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'RV Unit'
where o.legal_name = 'Reversal Void Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'RV Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Reversal Void Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'RV Tenant';
insert into public.bank_accounts (org_id, account_class, bank_name)
select id, 'business', 'RV Test Bank' from public.organizations where legal_name = 'Reversal Void Test Org';

-- ============================================================
-- Group R: reverse_invoice_payment() full flow (manual invoice, full payment, no bank link)
-- ============================================================
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reversal Void Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'RV Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reversal Void Test Org'),
  current_date, current_date + 7, 'REF-R', 'Reversal invoice R', null,
  '[{"description":"Water","quantity":1,"unitPrice":1000}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R')
);
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
  1000, current_date, 'eft', 'REF-R1', 'Full payment for reversal test'
);

select throws_ok(
  $$ select public.reverse_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
       ''
     ) $$,
  'P0001',
  'A reversal reason is required',
  'R: reversing with an empty reason is refused'
);

select throws_ok(
  $$ select public.reverse_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
       null
     ) $$,
  'P0001',
  'A reversal reason is required',
  'R: reversing with a null reason is refused'
);

-- Permission: an agent-only member cannot reverse a payment.
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.reverse_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
       'Agent should not be able to do this'
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'R: an agent-only member cannot call reverse_invoice_payment()'
);
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.reverse_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
       'Customer disputed charge'
     ) $$,
  'R: reversing with a real reason as an accountant succeeds'
);

select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
  1::bigint,
  'R: the original payment row is preserved, never deleted'
);

select is(
  (select ip.reversed_at is not null and ip.reversed_by_user_id = 'd3000000-0000-0000-0000-000000000001'::uuid and ip.reversal_reason = 'Customer disputed charge'
     from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
  true,
  'R: reversed_at/reversed_by_user_id/reversal_reason are all correctly set'
);

select is(
  (select count(*) from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_type = 'payment' and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R')),
  2::bigint,
  'R: the original payment journal entry is untouched (still has its 2 lines, never edited or deleted)'
);

select is(
  (select sum(jl.debit) - sum(jl.credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_type = 'reversal' and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R')),
  0::numeric,
  'R: the mirror-image reversal journal entry is itself balanced'
);

select is(
  (select co.code from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id join public.chart_of_accounts co on co.id = jl.account_id
     where je.source_type = 'reversal' and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R')
       and jl.debit > 0),
  '1100',
  'R: the reversal debits Accounts Receivable (1100) -- reopening the receivable the original payment closed'
);

select is(
  (select co.code from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id join public.chart_of_accounts co on co.id = jl.account_id
     where je.source_type = 'reversal' and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R')
       and jl.credit > 0),
  '1000',
  'R: the reversal credits Bank (1000) -- money is no longer treated as received'
);

select is(
  (select i.amount - coalesce((select sum(ip.amount) from public.invoice_payments ip where ip.invoice_id = i.id and ip.reversed_at is null), 0)
     from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
  1000::numeric,
  'R: invoice R''s outstanding balance is back to the full amount -- a reversed payment does not count toward paid_amount'
);

select throws_ok(
  $$ select public.reverse_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
       'Trying again'
     ) $$,
  'P0001',
  'This payment has already been reversed',
  'R: a reversed payment cannot be reversed a second time'
);

select is(
  (select count(*) from public.audit_events where entity_type = 'invoice_payments' and action = 'payment.reversed'
     and entity_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R')),
  1::bigint,
  'R: a payment.reversed audit event was written'
);

-- Since the reversed-out invoice R is now fully unpaid again, it can be paid a second time --
-- proving reversal genuinely reopens the invoice for new payments, not just cosmetically.
select lives_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R'),
       1000, current_date, 'cash', 'REF-R2', 'Re-paid after the disputed EFT reversal'
     ) $$,
  'R: after reversal, the invoice accepts a fresh payment (a genuinely reopened balance, not a cosmetic reversal)'
);

-- ============================================================
-- Group R-bank: reversal releases a linked bank transaction back to unmatched
-- ============================================================
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reversal Void Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'RV Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reversal Void Test Org'),
  current_date, current_date + 7, 'REF-RB', 'Reversal invoice with bank link', null,
  '[{"description":"Repairs","quantity":1,"unitPrice":500}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice with bank link')
);
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 500, 'RV bank-linked deposit'
from public.bank_accounts ba where ba.bank_name = 'RV Test Bank';
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice with bank link'),
  500, current_date, 'eft', 'REF-RB1', 'Bank-linked payment',
  (select id from public.bank_transactions where description = 'RV bank-linked deposit')
);

select is(
  (select match_status::text from public.bank_transactions where description = 'RV bank-linked deposit'),
  'matched',
  'R-bank: the linked bank transaction starts out matched'
);

select public.reverse_invoice_payment(
  (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice with bank link'),
  'Bounced EFT'
);

select is(
  (select row(match_status::text, matched_journal_entry_id, matched_invoice_payment_id) from public.bank_transactions where description = 'RV bank-linked deposit'),
  row('unmatched'::text, null::uuid, null::uuid),
  'R-bank: reversal releases the linked bank transaction back to unmatched with both linkage columns cleared'
);

-- ============================================================
-- Group R-rent: record_invoice_payment() now also serves rent-sourced invoices (Option A), and
-- reversal correctly recomputes the linked rent_schedule's status through both directions.
-- ============================================================
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, current_date, 2000, 'pending'
from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'RV Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Reversal Void Test Org';
select public.invoice_rent_schedule(
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'RV Unit')
);

-- A partial rent payment recorded through the SAME unified record_invoice_payment() used for
-- manual invoices -- proves Option A's "one ledger for both invoice types" for real.
select lives_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.source = 'rent_schedule'),
       800, current_date, 'eft', 'REF-RENT1', 'Partial rent payment via the unified RPC'
     ) $$,
  'R-rent: a manual payment can be recorded against a rent-sourced invoice through record_invoice_payment()'
);

select is(
  (select rs.status::text from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'RV Unit'),
  'partial',
  'R-rent: the linked rent_schedule.status correctly recomputes to partial'
);

select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.source = 'rent_schedule'),
  1200, current_date, 'eft', 'REF-RENT2', 'Final rent payment via the unified RPC'
);
select is(
  (select rs.status::text from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'RV Unit'),
  'paid',
  'R-rent: the linked rent_schedule.status correctly recomputes to paid once fully covered'
);

-- Reversing the final rent payment must recompute the rent_schedule back down, not leave it
-- falsely showing paid.
select public.reverse_invoice_payment(
  (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.source = 'rent_schedule' and ip.reference = 'REF-RENT2'),
  'Rent EFT reversed by the bank'
);
select is(
  (select rs.status::text from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'RV Unit'),
  'partial',
  'R-rent: reversing the covering payment correctly recomputes the rent_schedule back down to partial'
);

-- ============================================================
-- Group Link: link_bank_transaction_to_invoice_payment() -- a bank transaction imported AFTER the
-- payment was already recorded gets tied to the EXISTING row, never a second one.
-- ============================================================
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reversal Void Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'RV Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reversal Void Test Org'),
  current_date, current_date + 7, 'REF-LINK', 'Link invoice', null,
  '[{"description":"Parking","quantity":1,"unitPrice":300}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice')
);
-- Recorded WITHOUT a bank transaction -- as if entered the moment the tenant said they paid,
-- before the bank feed caught up.
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice'),
  300, current_date, 'eft', 'REF-LINK1', 'Recorded ahead of the bank feed'
);
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 300, 'RV link-later deposit'
from public.bank_accounts ba where ba.bank_name = 'RV Test Bank';

select is(
  (select count(*) from public.journal_entries je where je.source_type = 'payment' and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice')),
  1::bigint,
  'Link: exactly one journal entry exists before linking'
);

-- Permission: agent cannot link.
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.link_bank_transaction_to_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice'),
       (select id from public.bank_transactions where description = 'RV link-later deposit')
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'Link: an agent-only member cannot call link_bank_transaction_to_invoice_payment()'
);
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.link_bank_transaction_to_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice'),
       (select id from public.bank_transactions where description = 'RV link-later deposit')
     ) $$,
  'Link: an accountant can link a later-imported bank transaction to the existing payment'
);

select is(
  (select ip.bank_transaction_id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice'),
  (select id from public.bank_transactions where description = 'RV link-later deposit'),
  'Link: the existing payment row now carries the bank_transaction_id -- no second payment row was created'
);

select is(
  (select row(match_status::text, matched_invoice_payment_id) from public.bank_transactions where description = 'RV link-later deposit'),
  row('matched'::text, (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice')),
  'Link: the bank transaction is now matched, pointing back at the same payment'
);

select is(
  (select count(*) from public.journal_entries je where je.source_type = 'payment' and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice')),
  1::bigint,
  'Link: still exactly one journal entry -- linking never posts a second GL entry for the same money'
);

select throws_ok(
  $$ select public.link_bank_transaction_to_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice'),
       (select id from public.bank_transactions where description = 'RV link-later deposit')
     ) $$,
  'P0001',
  'This payment is already linked to a bank transaction',
  'Link: a payment already linked to a bank transaction cannot be linked again'
);

-- A reversed payment cannot be linked.
select public.reverse_invoice_payment(
  (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R' and ip.reference = 'REF-R2'),
  'Setting up the reversed-payment link test'
);
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 1000, 'RV deposit for a reversed payment'
from public.bank_accounts ba where ba.bank_name = 'RV Test Bank';
select throws_ok(
  $$ select public.link_bank_transaction_to_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Reversal invoice R' and ip.reference = 'REF-R2'),
       (select id from public.bank_transactions where description = 'RV deposit for a reversed payment')
     ) $$,
  'P0001',
  'Cannot link a bank transaction to a reversed payment',
  'Link: a reversed payment cannot receive a new bank-transaction link'
);

-- An already-matched bank transaction cannot be linked to a different payment.
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reversal Void Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'RV Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reversal Void Test Org'),
  current_date, current_date + 7, 'REF-LINK2', 'Link invoice 2', null,
  '[{"description":"Should not matter","quantity":1,"unitPrice":300}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2')
);
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
  300, current_date, 'eft', 'REF-LINK2-1', 'Second payment, no bank link yet'
);
select throws_ok(
  $$ select public.link_bank_transaction_to_invoice_payment(
       (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
       (select id from public.bank_transactions where description = 'RV link-later deposit')
     ) $$,
  'P0001',
  'This bank transaction has already been matched/allocated elsewhere',
  'Link: an already-matched bank transaction cannot be linked to a second, unrelated payment'
);

-- ============================================================
-- Group Void: void_invoice()
-- ============================================================
select throws_ok(
  $$ select public.void_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
       ''
     ) $$,
  'P0001',
  'A void reason is required',
  'Void: voiding with an empty reason is refused'
);

-- Permission: agent cannot void.
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.void_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
       'Agent should not be able to do this'
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'Void: an agent-only member cannot call void_invoice()'
);
set local "request.jwt.claim.sub" = 'd3000000-0000-0000-0000-000000000001';

-- Cannot void an invoice with an active (non-reversed) payment.
select throws_ok(
  $$ select public.void_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
       'Should be blocked'
     ) $$,
  'P0001',
  'Cannot void an invoice with active payments -- reverse them first',
  'Void: an invoice with an active payment cannot be voided until the payment is reversed'
);

select public.reverse_invoice_payment(
  (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
  'Clearing the way to void'
);
select lives_ok(
  $$ select public.void_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
       'Tenant vacated, invoice no longer applicable'
     ) $$,
  'Void: once the payment is reversed, the same invoice can be voided'
);

select is(
  (select voided_at is not null and voided_by_user_id = 'd3000000-0000-0000-0000-000000000001'::uuid and void_reason = 'Tenant vacated, invoice no longer applicable'
     from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
  true,
  'Void: voided_at/voided_by_user_id/void_reason are all correctly set'
);

select throws_ok(
  $$ select public.void_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
       'Trying again'
     ) $$,
  'P0001',
  'Invoice is already void',
  'Void: an already-void invoice cannot be voided again'
);

-- Voided invoice remains visible (never hidden/deleted).
select is(
  (select count(*) from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
  1::bigint,
  'Void: the voided invoice remains visible in a normal select -- never deleted or hidden'
);

-- Cannot record a payment against a voided invoice.
select throws_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2'),
       300, current_date, 'eft', 'REF-VOID', 'Should be refused'
     ) $$,
  'P0001',
  'Cannot record a payment against a voided invoice',
  'Void: a voided invoice can never receive a new payment'
);

-- A draft invoice (never issued) can also be voided directly.
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Reversal Void Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'RV Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Reversal Void Test Org'),
  current_date, current_date + 7, 'REF-DRAFT', 'Draft invoice for void test', null,
  '[{"description":"Never issued","quantity":1,"unitPrice":150}]'::jsonb
);
select lives_ok(
  $$ select public.void_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Draft invoice for void test'),
       'Never going to be issued'
     ) $$,
  'Void: a draft (never-issued) invoice can also be voided directly'
);

select is(
  (select count(*) from public.audit_events where entity_type = 'invoices' and action = 'invoice.voided'
     and entity_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Reversal Void Test Org' and i.description = 'Link invoice 2')),
  1::bigint,
  'Void: an invoice.voided audit event was written for the issued-then-voided invoice'
);

-- ============================================================
-- Group C: concurrency guard -- structural proof that the mandatory row lock is present, since
-- pgTAP's single-connection-per-file model cannot itself express a genuine two-session race.
-- ============================================================
select is(
  (select position('for update' in lower(pg_get_functiondef('public.record_invoice_payment(uuid, numeric, date, text, text, text, uuid)'::regprocedure)))) > 0,
  true,
  'C: record_invoice_payment() source contains the mandatory SELECT ... FOR UPDATE concurrency lock'
);

select * from finish();
rollback;
