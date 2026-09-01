-- MANDATORY accounting test (P0 correction pass, WORKLOG.md this date): proves invoice_payments is
-- genuinely the ONE authoritative allocation ledger for bank-matched and cash-deposited rent
-- payments, not a total computed independently alongside a second bank_transactions/cash_receipts
-- sum. Exact numeric scenario as specified: a R20,000 invoice, a R15,000 match, then a R5,000
-- match, must total R20,000 -- never R30,000 or R40,000 from double-counting the same receipt
-- through two different tables. Same shape proven for cash, and for a manual payment recorded
-- before any bank transaction exists, later linked without creating a second payment or a second
-- GL entry.

begin;
select plan(33);

insert into auth.users (id, email) values
  ('e5000000-0000-0000-0000-000000000001', 'single-source-accountant@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'e5000000-0000-0000-0000-000000000001';
select public.create_organization('Single Source Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Single Source Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'e5000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'Single Source Test Org'),
  'Single Source Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.bank_accounts (org_id, account_class, bank_name)
select id, 'business', 'Single Source Bank' from public.organizations where legal_name = 'Single Source Test Org';

-- ============================================================
-- Group A: bank-matched rent invoice, R20,000, split R15,000 + R5,000 -- the exact mandated scenario.
-- ============================================================
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'A Unit', 'occupied' from public.properties p where p.nickname = 'Single Source Property';
insert into public.tenants (org_id, full_name, status)
select id, 'A Tenant', 'active' from public.organizations where legal_name = 'Single Source Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 20000, 20000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'A Unit'
where o.legal_name = 'Single Source Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'A Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Single Source Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'A Tenant';
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, current_date, 20000, 'pending'
from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'A Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Single Source Test Org';
select public.invoice_rent_schedule(
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit')
);

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, current_date, 15000, 'A first payment' from public.bank_accounts where bank_name = 'Single Source Bank';
select public.confirm_bank_transaction_match(
  (select id from public.bank_transactions where description = 'A first payment'),
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit')
);

select is(
  (select coalesce(sum(ip.amount), 0) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit')),
  15000::numeric,
  'A: invoice_payments total is exactly R15,000 after the first match -- not R30,000'
);
select is(
  (select i.amount - coalesce((select sum(ip.amount) from public.invoice_payments ip where ip.invoice_id = i.id and ip.reversed_at is null), 0)
     from public.invoices i where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit')),
  5000::numeric,
  'A: balance is exactly R5,000 after the first R15,000 match against the R20,000 invoice'
);

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, current_date, 5000, 'A second payment' from public.bank_accounts where bank_name = 'Single Source Bank';
select public.confirm_bank_transaction_match(
  (select id from public.bank_transactions where description = 'A second payment'),
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit')
);

select is(
  (select coalesce(sum(ip.amount), 0) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit')),
  20000::numeric,
  'A: invoice_payments total is exactly R20,000 after both matches -- not R40,000'
);
select is(
  (select i.amount - coalesce((select sum(ip.amount) from public.invoice_payments ip where ip.invoice_id = i.id and ip.reversed_at is null), 0)
     from public.invoices i where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit')),
  0::numeric,
  'A: balance is exactly R0 once both matches together cover the full R20,000'
);
select is(
  (select rs.status::text from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit'),
  'paid',
  'A: the rent_schedule is paid, derived from the same single invoice_payments source'
);
select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit')),
  2::bigint,
  'A: exactly two invoice_payments rows exist -- one per bank match, never merged or split'
);

-- GL proof: Bank (1000) debited exactly R20,000 total, AR (1100) credited exactly R20,000 total,
-- across BOTH payment journal entries -- never R40,000 from a duplicate posting.
select is(
  (select sum(jl.debit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where co.code = '1000' and je.source_type = 'payment'
       and je.source_id in (select id from public.bank_transactions where description in ('A first payment', 'A second payment'))),
  20000::numeric,
  'A: Bank (1000) was debited exactly R20,000 total across both real payments -- not R40,000'
);
select is(
  (select sum(jl.credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where co.code = '1100' and je.source_type = 'payment'
       and je.source_id in (select id from public.bank_transactions where description in ('A first payment', 'A second payment'))),
  20000::numeric,
  'A: Accounts Receivable (1100) was credited exactly R20,000 total -- matches the Bank debit exactly'
);

-- ============================================================
-- Group B: the equivalent cash path -- R20,000 invoice, split R15,000 + R5,000 cash deposits.
-- ============================================================
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'B Unit', 'occupied' from public.properties p where p.nickname = 'Single Source Property';
insert into public.tenants (org_id, full_name, status)
select id, 'B Tenant', 'active' from public.organizations where legal_name = 'Single Source Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 20000, 20000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'B Unit'
where o.legal_name = 'Single Source Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'B Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Single Source Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'B Tenant';
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, current_date, 20000, 'pending'
from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'B Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Single Source Test Org';
select public.invoice_rent_schedule(
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit')
);

select public.record_cash_receipt(
  (select id from public.organizations where legal_name = 'Single Source Test Org'),
  (select id from public.properties where nickname = 'Single Source Property'),
  15000,
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit'),
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit')
);
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, current_date, 15000, 'B first cash deposit' from public.bank_accounts where bank_name = 'Single Source Bank';
select public.confirm_cash_receipt_deposit(
  (select id from public.cash_receipts where amount = 15000 and property_id = (select id from public.properties where nickname = 'Single Source Property')),
  (select id from public.bank_transactions where description = 'B first cash deposit'),
  15000
);

select is(
  (select coalesce(sum(ip.amount), 0) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit')),
  15000::numeric,
  'B (cash): invoice_payments total is exactly R15,000 after the first deposit -- not R30,000'
);
select is(
  (select i.amount - coalesce((select sum(ip.amount) from public.invoice_payments ip where ip.invoice_id = i.id and ip.reversed_at is null), 0)
     from public.invoices i where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit')),
  5000::numeric,
  'B (cash): balance is exactly R5,000 after the first R15,000 cash deposit'
);

select public.record_cash_receipt(
  (select id from public.organizations where legal_name = 'Single Source Test Org'),
  (select id from public.properties where nickname = 'Single Source Property'),
  5000,
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit'),
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit')
);
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, current_date, 5000, 'B second cash deposit' from public.bank_accounts where bank_name = 'Single Source Bank';
select public.confirm_cash_receipt_deposit(
  (select id from public.cash_receipts where amount = 5000 and property_id = (select id from public.properties where nickname = 'Single Source Property')),
  (select id from public.bank_transactions where description = 'B second cash deposit'),
  5000
);

select is(
  (select coalesce(sum(ip.amount), 0) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit')),
  20000::numeric,
  'B (cash): invoice_payments total is exactly R20,000 after both deposits -- not R40,000'
);
select is(
  (select i.amount - coalesce((select sum(ip.amount) from public.invoice_payments ip where ip.invoice_id = i.id and ip.reversed_at is null), 0)
     from public.invoices i where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit')),
  0::numeric,
  'B (cash): balance is exactly R0 once both deposits together cover the full R20,000'
);
select is(
  (select rs.status::text from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit'),
  'paid',
  'B (cash): the rent_schedule is paid, derived from the same single invoice_payments source'
);
select is(
  (select sum(jl.debit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where co.code = '1000' and je.source_type = 'payment'
       and je.source_id in (select id from public.cash_receipts where property_id = (select id from public.properties where nickname = 'Single Source Property'))),
  20000::numeric,
  'B (cash): Bank (1000) was debited exactly R20,000 total across both cash deposits -- not R40,000'
);
select is(
  (select sum(jl.credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where co.code = '1100' and je.source_type = 'payment'
       and je.source_id in (select id from public.cash_receipts where property_id = (select id from public.properties where nickname = 'Single Source Property'))),
  20000::numeric,
  'B (cash): Accounts Receivable (1100) was credited exactly R20,000 total'
);

-- cash_receipt_id and bank_transaction_id are mutually exclusive on the two rows just created --
-- proves the cash path never accidentally links via the deposit-slip bank_transaction (which could
-- legitimately back several receipts bundled into one deposit).
select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit')
       and ip.cash_receipt_id is not null and ip.bank_transaction_id is null),
  2::bigint,
  'B (cash): both allocations are linked via cash_receipt_id, never bank_transaction_id'
);

-- ============================================================
-- Group C: a manual invoice payment recorded before any bank transaction exists, later linked --
-- exactly one invoice_payments row, exactly one GL receipt, throughout.
-- ============================================================
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'C Unit', 'occupied' from public.properties p where p.nickname = 'Single Source Property';
insert into public.tenants (org_id, full_name, status)
select id, 'C Tenant', 'active' from public.organizations where legal_name = 'Single Source Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 1000, 1000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'C Unit'
where o.legal_name = 'Single Source Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'C Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Single Source Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'C Tenant';
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Single Source Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'C Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Single Source Test Org' and t.full_name = 'C Tenant'),
  current_date, current_date + 7, 'REF-C', 'C invoice', null,
  '[{"description":"Repairs","quantity":1,"unitPrice":1000}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Single Source Test Org' and i.description = 'C invoice')
);
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Single Source Test Org' and i.description = 'C invoice'),
  1000, current_date, 'eft', 'REF-C1', 'Recorded before the bank feed caught up'
);

select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id
     where i.org_id = (select id from public.organizations where legal_name = 'Single Source Test Org') and i.description = 'C invoice'),
  1::bigint,
  'C: exactly one invoice_payments row exists after recording a payment with no bank transaction'
);
select is(
  (select count(*) from public.journal_entries je
     where je.source_type = 'payment'
       and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.description = 'C invoice')),
  1::bigint,
  'C: exactly one GL receipt (journal entry) exists for that payment'
);

-- A bank transaction is imported AFTER the fact and linked to the SAME existing payment.
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, current_date, 1000, 'C bank feed catches up' from public.bank_accounts where bank_name = 'Single Source Bank';
select public.link_bank_transaction_to_invoice_payment(
  (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.description = 'C invoice'),
  (select id from public.bank_transactions where description = 'C bank feed catches up')
);

select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id
     where i.org_id = (select id from public.organizations where legal_name = 'Single Source Test Org') and i.description = 'C invoice'),
  1::bigint,
  'C: still exactly one invoice_payments row after linking a bank transaction -- no second payment was created'
);
select is(
  (select count(*) from public.journal_entries je
     where je.source_type = 'payment'
       and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.description = 'C invoice')),
  1::bigint,
  'C: still exactly one GL receipt after linking -- no second journal entry was posted for the same money'
);
select is(
  (select match_status::text from public.bank_transactions where description = 'C bank feed catches up'),
  'matched',
  'C: the linked bank transaction is now marked matched'
);

-- A zero or negative payment amount is refused outright -- checked before the overpayment
-- comparison, so this holds regardless of the invoice's current balance.
select throws_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Single Source Test Org' and i.description = 'C invoice'),
       0, current_date, 'eft', 'REF-ZERO', 'Should be refused'
     ) $$,
  'P0001',
  'Payment amount must be positive',
  'C: a R0 payment is refused'
);
select throws_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Single Source Test Org' and i.description = 'C invoice'),
       -100, current_date, 'eft', 'REF-NEG', 'Should be refused'
     ) $$,
  'P0001',
  'Payment amount must be positive',
  'C: a negative payment amount is refused'
);

-- ============================================================
-- Group D: reversing a payment that confirm_bank_transaction_match() itself created (not a
-- manually-recorded one) -- migration 159's own new code path, not yet exercised by any other
-- test. Reverses the R5,000 second match from Group A.
-- ============================================================
select public.reverse_invoice_payment(
  (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit' and ip.amount = 5000),
  'Bank match reversal test'
);

select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit'),
  2::bigint,
  'D: both invoice_payments rows for invoice A still exist -- reversal never deletes'
);
select is(
  (select coalesce(sum(ip.amount), 0) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit' and ip.reversed_at is null),
  15000::numeric,
  'D: the reversed R5,000 no longer counts toward paid -- back to R15,000'
);
select is(
  (select rs.status::text from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit'),
  'partial',
  'D: the rent_schedule recomputes back down to partial after the reversal'
);
select is(
  (select row(match_status::text, matched_rent_schedule_id, matched_journal_entry_id) from public.bank_transactions where description = 'A second payment'),
  row('unmatched'::text, null::uuid, null::uuid),
  'D: the bank transaction confirm_bank_transaction_match() matched is released back to unmatched, matched_rent_schedule_id cleared -- can be rematched'
);
select is(
  (select count(*) from public.journal_entries je where je.source_type = 'reversal'
     and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit' and ip.amount = 5000)),
  1::bigint,
  'D: exactly one reversing journal entry was posted -- never duplicated'
);
select is(
  (select count(*) from public.audit_events where action = 'payment.reversed' and entity_type = 'invoice_payments'
     and entity_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A Unit' and ip.amount = 5000)),
  1::bigint,
  'D: a payment.reversed audit event was written for the bank-match-created payment'
);

-- ============================================================
-- Group E: reversing a payment that confirm_cash_receipt_deposit() itself created -- releases the
-- cash receipt back to un-deposited, symmetric to Group D's bank release.
-- ============================================================
select public.reverse_invoice_payment(
  (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit' and ip.amount = 5000),
  'Cash deposit reversal test'
);

select is(
  (select coalesce(sum(ip.amount), 0) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit' and ip.reversed_at is null),
  15000::numeric,
  'E: the reversed R5,000 cash allocation no longer counts toward paid -- back to R15,000'
);
select is(
  (select rs.status::text from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit'),
  'partial',
  'E: the rent_schedule recomputes back down to partial after the cash reversal'
);
select is(
  (select row(deposited_at, deposit_bank_transaction_id, deposited_amount, variance, journal_entry_id) from public.cash_receipts where amount = 5000 and property_id = (select id from public.properties where nickname = 'Single Source Property')),
  row(null::timestamptz, null::uuid, null::numeric, null::numeric, null::uuid),
  'E: the cash receipt is released back to un-deposited -- all deposit fields cleared, can be re-deposited'
);
select is(
  (select count(*) from public.journal_entries je where je.source_type = 'reversal'
     and je.source_id = (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'B Unit' and ip.amount = 5000)),
  1::bigint,
  'E: exactly one reversing journal entry was posted for the cash reversal too'
);

select * from finish();
rollback;
