-- Tests for 20260101000146_bank_transaction_fields_and_categorisation.sql:
-- match_bank_transaction_to_expense() -- the "Expense" bank-transaction matching destination
-- added alongside the existing rent-schedule matching (confirm_bank_transaction_match(),
-- untouched). Follows the same setup/role-switching conventions as cash_management.test.sql.

begin;
select plan(11);

insert into auth.users (id, email) values
  ('fc000000-0000-0000-0000-000000000001', 'banktxn-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Bank Txn Categorisation Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Bank Txn Categorisation Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000001';

select set_config(
  'pgtap.banktxn.org_id',
  (select id::text from public.organizations where legal_name = 'Bank Txn Categorisation Test Org'),
  false
);

select set_config(
  'pgtap.banktxn.property_id',
  (select public.create_property(
    current_setting('pgtap.banktxn.org_id')::uuid,
    'Bank Txn Test Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

insert into public.bank_accounts (org_id, account_class, bank_name)
values (current_setting('pgtap.banktxn.org_id')::uuid, 'business', 'Bank Txn Test Bank');

select set_config(
  'pgtap.banktxn.bank_account_id',
  (select id::text from public.bank_accounts where bank_name = 'Bank Txn Test Bank'),
  false
);

-- New columns exist and accept values (property_id, unit_id, tenant_id, vendor_id, category,
-- document_id, notes, expense_id -- all nullable/additive).
insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.banktxn.property_id')::uuid, current_setting('pgtap.banktxn.org_id')::uuid, 'U1', 'vacant');

select lives_ok(
  $$ insert into public.bank_transactions (
       bank_account_id, transaction_date, amount, description, property_id, unit_id, category, notes
     )
     select
       current_setting('pgtap.banktxn.bank_account_id')::uuid, '2026-08-01', -850, 'Plumbing invoice payment',
       current_setting('pgtap.banktxn.property_id')::uuid,
       (select id from public.units where property_id = current_setting('pgtap.banktxn.property_id')::uuid),
       'maintenance', 'Staff note'
  $$,
  'a bank transaction accepts the new manual-tag columns (property_id, unit_id, category, notes)'
);

select set_config(
  'pgtap.banktxn.transaction_id',
  (select id::text from public.bank_transactions where description = 'Plumbing invoice payment'),
  false
);

-- A pending expense to match against (bypassing the API layer, same as cash_management.test.sql's
-- direct rent_schedules insert) -- chart_of_accounts is seeded by create_organization() already
-- (migration 20260101000035/142), so record_expense() can resolve real accounts.
insert into public.expenses (org_id, property_id, category, amount, status)
values (current_setting('pgtap.banktxn.org_id')::uuid, current_setting('pgtap.banktxn.property_id')::uuid, 'Maintenance', 850, 'pending');

select set_config(
  'pgtap.banktxn.expense_id',
  (select id::text from public.expenses where org_id = current_setting('pgtap.banktxn.org_id')::uuid),
  false
);

-- ==== match_bank_transaction_to_expense(): the happy path ====

select lives_ok(
  $$ select public.match_bank_transaction_to_expense(
    current_setting('pgtap.banktxn.transaction_id')::uuid,
    current_setting('pgtap.banktxn.expense_id')::uuid
  ) $$,
  'the property principal (accountant+ by role ranking) can match a bank transaction to a pending expense'
);

select is(
  (select match_status from public.bank_transactions where id = current_setting('pgtap.banktxn.transaction_id')::uuid),
  'matched'::public.bank_transaction_match_status,
  'the bank transaction is now matched'
);

select is(
  (select expense_id from public.bank_transactions where id = current_setting('pgtap.banktxn.transaction_id')::uuid),
  current_setting('pgtap.banktxn.expense_id')::uuid,
  'the bank transaction records which expense it was matched to'
);

select isnt(
  (select matched_journal_entry_id from public.bank_transactions where id = current_setting('pgtap.banktxn.transaction_id')::uuid),
  null,
  'a real journal_entry_id was recorded, proving record_expense() actually posted'
);

select is(
  (select status from public.expenses where id = current_setting('pgtap.banktxn.expense_id')::uuid),
  'recorded'::public.expense_status,
  'record_expense() transitioned the expense from pending to recorded, exactly as calling it directly would'
);

select is(
  (select count(*)::int from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_type = 'expense' and je.source_id = current_setting('pgtap.banktxn.expense_id')::uuid),
  2,
  'exactly one balanced (2-line) journal entry was posted for this expense -- no duplicate posting'
);

-- ==== idempotency: a second match attempt on the same (already-matched) transaction is rejected ====

insert into public.expenses (org_id, property_id, category, amount, status)
values (current_setting('pgtap.banktxn.org_id')::uuid, current_setting('pgtap.banktxn.property_id')::uuid, 'Maintenance', 850, 'pending');
select set_config(
  'pgtap.banktxn.expense2_id',
  (select id::text from public.expenses where org_id = current_setting('pgtap.banktxn.org_id')::uuid and id <> current_setting('pgtap.banktxn.expense_id')::uuid),
  false
);

select throws_ok(
  $$ select public.match_bank_transaction_to_expense(
    current_setting('pgtap.banktxn.transaction_id')::uuid,
    current_setting('pgtap.banktxn.expense2_id')::uuid
  ) $$,
  'Bank transaction ' || current_setting('pgtap.banktxn.transaction_id') || ' is already matched',
  'a second match attempt on the same bank transaction is rejected (idempotency)'
);

-- ==== matching a NON-pending expense is rejected ====

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
values (current_setting('pgtap.banktxn.bank_account_id')::uuid, '2026-08-02', -850, 'Second plumbing invoice');
select set_config(
  'pgtap.banktxn.transaction2_id',
  (select id::text from public.bank_transactions where description = 'Second plumbing invoice'),
  false
);

select throws_ok(
  $$ select public.match_bank_transaction_to_expense(
    current_setting('pgtap.banktxn.transaction2_id')::uuid,
    current_setting('pgtap.banktxn.expense_id')::uuid
  ) $$,
  'Expense ' || current_setting('pgtap.banktxn.expense_id') || ' is not pending (current status: recorded)',
  'matching an already-recorded (non-pending) expense is rejected'
);

-- ==== cross-org: an expense from a DIFFERENT org cannot be matched ====

reset role;
insert into auth.users (id, email) values
  ('fc000000-0000-0000-0000-000000000002', 'banktxn-other-org@test.propertyvault.example');
set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000002';
select public.create_organization('Bank Txn Other Org', 'agency');
select set_config(
  'pgtap.banktxn.other_org_id',
  (select id::text from public.organizations where legal_name = 'Bank Txn Other Org'),
  false
);
reset role;
select public.activate_trial_after_payment(current_setting('pgtap.banktxn.other_org_id')::uuid);
set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000002';
select set_config(
  'pgtap.banktxn.other_property_id',
  (select public.create_property(
    current_setting('pgtap.banktxn.other_org_id')::uuid,
    'Other Org Property', '2 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);
insert into public.expenses (org_id, property_id, category, amount, status)
values (current_setting('pgtap.banktxn.other_org_id')::uuid, current_setting('pgtap.banktxn.other_property_id')::uuid, 'Maintenance', 500, 'pending');
select set_config(
  'pgtap.banktxn.other_org_expense_id',
  (select id::text from public.expenses where org_id = current_setting('pgtap.banktxn.other_org_id')::uuid),
  false
);

set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select public.match_bank_transaction_to_expense(
    current_setting('pgtap.banktxn.transaction2_id')::uuid,
    current_setting('pgtap.banktxn.other_org_expense_id')::uuid
  ) $$,
  'Expense not found (or not in the same org as the bank account)',
  'an expense belonging to a different organization cannot be matched (cross-org isolation)'
);

select * from finish();
rollback;
