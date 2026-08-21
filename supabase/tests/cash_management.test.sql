-- Tests for 20260101000073_cash_management.sql: record_cash_receipt()/confirm_cash_receipt_deposit()
-- (variance calculation, rent_schedule status), the mixed cash+bank cumulative-total fix in
-- confirm_bank_transaction_match(), and RLS (staff_or_owner, matching every other Stage 3 table).

begin;
select plan(12);

insert into auth.users (id, email) values
  ('fb000000-0000-0000-0000-000000000001', 'cash-principal@test.propertyvault.example'),
  ('fb000000-0000-0000-0000-000000000002', 'cash-outsider@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Cash Management Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Cash Management Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000001';

select set_config(
  'pgtap.cash_test.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Cash Management Test Org'),
    'Cash Test Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
select current_setting('pgtap.cash_test.property_id')::uuid, id, 'U1', 'occupied'
from public.organizations where legal_name = 'Cash Management Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
select u.org_id, u.id, '2026-01-01', 10000, 'active', 'manual'
from public.units u where u.property_id = current_setting('pgtap.cash_test.property_id')::uuid;

select set_config('pgtap.cash_test.lease_id', (select id::text from public.leases limit 1), false);

insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select (select id from public.organizations where legal_name = 'Cash Management Test Org'),
  current_setting('pgtap.cash_test.lease_id')::uuid, '2026-01-01', 10000, 'invoiced';

select set_config('pgtap.cash_test.schedule_id', (select id::text from public.rent_schedules limit 1), false);

insert into public.bank_accounts (org_id, account_class, bank_name)
select id, 'business', 'Cash Test Bank' from public.organizations where legal_name = 'Cash Management Test Org';

-- ==== record_cash_receipt(): logging the physical collection ====

select lives_ok(
  $$ select public.record_cash_receipt(
    (select id from public.organizations where legal_name = 'Cash Management Test Org'),
    current_setting('pgtap.cash_test.property_id')::uuid,
    6000,
    current_setting('pgtap.cash_test.lease_id')::uuid,
    current_setting('pgtap.cash_test.schedule_id')::uuid
  ) $$,
  'the property owner (principal, agent+ by role ranking) can record a cash receipt'
);

select set_config('pgtap.cash_test.receipt_id', (select id::text from public.cash_receipts limit 1), false);

select ok(
  (select receipt_number from public.cash_receipts where id = current_setting('pgtap.cash_test.receipt_id')::uuid) like 'CR-%',
  'a receipt_number was auto-generated in the CR-###### format'
);

select is(
  (select deposited_at from public.cash_receipts where id = current_setting('pgtap.cash_test.receipt_id')::uuid),
  null,
  'a newly-recorded cash receipt is not yet deposited'
);

-- ==== confirm_cash_receipt_deposit(): a partial cash deposit (6000 of the 10000 due) ====

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, '2026-01-05', 6000, 'Cash deposit 1' from public.bank_accounts where bank_name = 'Cash Test Bank';

select lives_ok(
  $$ select public.confirm_cash_receipt_deposit(
    current_setting('pgtap.cash_test.receipt_id')::uuid,
    (select id from public.bank_transactions where description = 'Cash deposit 1'),
    6000
  ) $$,
  'confirming an exact deposit (6000 received, 6000 banked) succeeds'
);

select is(
  (select variance from public.cash_receipts where id = current_setting('pgtap.cash_test.receipt_id')::uuid),
  0.00::numeric,
  'variance is exactly zero when the deposited amount matches what was received'
);

select is(
  (select status from public.rent_schedules where id = current_setting('pgtap.cash_test.schedule_id')::uuid),
  'partial'::public.rent_schedule_status,
  'the rent_schedule is "partial" after a 6000 cash deposit against a 10000 schedule'
);

-- ==== A second receipt, completed via a BANK transfer (the mixed cash+bank cumulative fix) ====

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, '2026-01-20', 4000, 'Remaining rent via EFT' from public.bank_accounts where bank_name = 'Cash Test Bank';

select lives_ok(
  $$ select public.confirm_bank_transaction_match(
    (select id from public.bank_transactions where description = 'Remaining rent via EFT'),
    current_setting('pgtap.cash_test.schedule_id')::uuid
  ) $$,
  'the remaining 4000 is matched via a normal bank transaction'
);

select is(
  (select status from public.rent_schedules where id = current_setting('pgtap.cash_test.schedule_id')::uuid),
  'paid'::public.rent_schedule_status,
  'the schedule is "paid" once cash (6000) + bank (4000) together cover the full 10000 -- the cumulative fix, verified not assumed'
);

-- ==== A second cash receipt with a genuine variance (bundled deposit, more banked than received) ====

select public.record_cash_receipt(
  (select id from public.organizations where legal_name = 'Cash Management Test Org'),
  current_setting('pgtap.cash_test.property_id')::uuid,
  1000
);
select set_config(
  'pgtap.cash_test.receipt2_id',
  (select id::text from public.cash_receipts where amount = 1000),
  false
);

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, '2026-02-01', 1050, 'Bundled cash deposit' from public.bank_accounts where bank_name = 'Cash Test Bank';

select public.confirm_cash_receipt_deposit(
  current_setting('pgtap.cash_test.receipt2_id')::uuid,
  (select id from public.bank_transactions where description = 'Bundled cash deposit'),
  1050
);

select is(
  (select variance from public.cash_receipts where id = current_setting('pgtap.cash_test.receipt2_id')::uuid),
  50.00::numeric,
  'variance correctly reflects 50 more banked than was originally received (bundled deposit)'
);

-- ==== RLS: staff_or_owner, same shape as every other Stage 3 table ====

set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.cash_receipts where id = current_setting('pgtap.cash_test.receipt_id')::uuid),
  0,
  'an outsider (no org membership, no property_access) cannot see the cash receipt'
);

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'fb000000-0000-0000-0000-000000000002', 'viewer', 'active', now()
from public.organizations where legal_name = 'Cash Management Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.cash_receipts where id = current_setting('pgtap.cash_test.receipt_id')::uuid),
  1,
  'a coworker who joins the org is auto-granted access that cascades to cash receipts'
);

select * from finish();
rollback;
