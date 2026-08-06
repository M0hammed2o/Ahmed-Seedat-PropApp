-- Tests for TASKS.md M14 part 2's four posting operations (migration 20260101000038):
-- record_expense(), invoice_rent_schedule(), confirm_bank_transaction_match(),
-- post_lease_deposit(). Exercises a real end-to-end flow (property -> unit -> tenant -> lease
-- with deposit -> deposit posted -> rent invoiced -> partially paid -> fully paid -> expense
-- recorded) rather than only testing each function in isolation, matching how
-- multi_tenant_foundation_integration.test.sql proved the M1-M5 foundation as one system.
--
-- Uses repeated subqueries keyed on unique text fields (nickname/label/description) rather than
-- psql \gset variables -- an earlier version used \gset, but its captured :'var' references did
-- not interpolate correctly inside the $$ ... $$ blocks passed to throws_ok/lives_ok (syntax
-- error at or near ":", found by actually running it, not assumed). Every other test file this
-- session uses this same subquery pattern successfully; matching it here traded some verbosity
-- for zero risk of the same class of bug recurring.

begin;
select plan(20);

insert into auth.users (id, email) values
  ('af000000-0000-0000-0000-000000000001', 'posting-accountant@test.propertyvault.example'),
  ('af000000-0000-0000-0000-000000000002', 'posting-agent-only@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'af000000-0000-0000-0000-000000000001';

select isnt(
  (select public.create_organization('Posting Ops Test Org', 'agency')),
  null,
  'org created (principal counts as accountant+ via has_org_role ranking)'
);

-- Second member: agent-only, to prove the PERMISSIONS.md role split holds for real. No client
-- INSERT policy exists on organization_members by design (only create_organization()/
-- accept_organization_invite() may create membership rows) -- `reset role` for this one
-- fixture-setup statement, matching multi_tenant_foundation_integration.test.sql's established fix.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'af000000-0000-0000-0000-000000000002'::uuid, 'agent', 'active', now()
from public.organizations where legal_name = 'Posting Ops Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'af000000-0000-0000-0000-000000000001';

-- properties no longer has a client-facing INSERT policy (20260101000064) -- create_property()
-- is the only sanctioned path as of that migration.
select public.create_property(
  (select id from public.organizations where legal_name = 'Posting Ops Test Org'),
  'Posting Ops Property', '1 Test Street', 'Cape Town', 'ZA', 'house'::public.property_type
);

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Posting Ops Unit', 'vacant'
from public.properties p where p.nickname = 'Posting Ops Property';

insert into public.tenants (org_id, full_name, status)
select id, 'Posting Ops Tenant', 'active'
from public.organizations where legal_name = 'Posting Ops Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 8500, 8500, 'active', 'manual'
from public.organizations o
join public.units u on u.org_id = o.id and u.unit_label = 'Posting Ops Unit'
where o.legal_name = 'Posting Ops Test Org';

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'Posting Ops Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'Posting Ops Tenant';

insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, current_date, 8500, 'pending'
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'Posting Ops Test Org';

-- === PERMISSIONS.md §2 role split, proven for real: an agent-only member cannot post ===
set local "request.jwt.claim.sub" = 'af000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.post_lease_deposit(
       (select l.id from public.leases l
          join public.organizations o on o.id = l.org_id
          where o.legal_name = 'Posting Ops Test Org')
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'an agent-only member cannot call post_lease_deposit() -- accounting-post is accountant+ only, not agent'
);

set local "request.jwt.claim.sub" = 'af000000-0000-0000-0000-000000000001';

-- === post_lease_deposit() ===
select lives_ok(
  $$ select public.post_lease_deposit(
       (select l.id from public.leases l
          join public.organizations o on o.id = l.org_id
          where o.legal_name = 'Posting Ops Test Org')
     ) $$,
  'principal (satisfies accountant+ via has_org_role ranking) can post the lease deposit'
);

select is(
  (select tl.current_balance from public.trust_ledgers tl
     join public.leases l on l.id = tl.lease_id
     join public.organizations o on o.id = l.org_id
     where o.legal_name = 'Posting Ops Test Org'),
  8500::numeric,
  'the trust ledger opens with a current_balance matching the deposit amount'
);

select is(
  (select tle.entry_type from public.trust_ledger_entries tle
     join public.trust_ledgers tl on tl.id = tle.trust_ledger_id
     join public.leases l on l.id = tl.lease_id
     join public.organizations o on o.id = l.org_id
     where o.legal_name = 'Posting Ops Test Org'),
  'deposit_received'::public.trust_ledger_entry_type,
  'a deposit_received trust_ledger_entries row was created'
);

select is(
  (select sum(jl.debit) - sum(jl.credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_type = 'deposit' and je.description = 'Deposit received'),
  0::numeric,
  'the deposit journal entry is balanced'
);

-- 2-arg form: checks sqlstate only, auto-generated description -- the exact message includes a
-- UUID not known at test-authoring time (this test uses subqueries, not captured variables).
select throws_ok(
  $$ select public.post_lease_deposit(
       (select l.id from public.leases l
          join public.organizations o on o.id = l.org_id
          where o.legal_name = 'Posting Ops Test Org')
     ) $$,
  'P0001'
);

-- === invoice_rent_schedule() ===
select lives_ok(
  $$ select public.invoice_rent_schedule(
       (select rs.id from public.rent_schedules rs
          join public.organizations o on o.id = rs.org_id
          where o.legal_name = 'Posting Ops Test Org')
     ) $$,
  'accountant can invoice the pending rent schedule'
);

select is(
  (select rs.status from public.rent_schedules rs
     join public.organizations o on o.id = rs.org_id
     where o.legal_name = 'Posting Ops Test Org'),
  'invoiced'::public.rent_schedule_status,
  'the rent schedule moved to invoiced'
);

select is(
  (select count(*) from public.invoices i
     join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Posting Ops Test Org' and i.status = 'issued'),
  1::bigint,
  'an issued invoice was created'
);

select throws_ok(
  $$ select public.invoice_rent_schedule(
       (select rs.id from public.rent_schedules rs
          join public.organizations o on o.id = rs.org_id
          where o.legal_name = 'Posting Ops Test Org')
     ) $$,
  'P0001'
);

-- === confirm_bank_transaction_match(): partial payment first (ACCOUNTING.md §10) ===
insert into public.bank_accounts (org_id, account_class, bank_name)
select id, 'business', 'Posting Ops Test Bank'
from public.organizations where legal_name = 'Posting Ops Test Org';

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 3000, 'First partial payment'
from public.bank_accounts ba where ba.bank_name = 'Posting Ops Test Bank';

select lives_ok(
  $$ select public.confirm_bank_transaction_match(
       (select id from public.bank_transactions where description = 'First partial payment'),
       (select rs.id from public.rent_schedules rs
          join public.organizations o on o.id = rs.org_id
          where o.legal_name = 'Posting Ops Test Org')
     ) $$,
  'a partial payment (3000 of 8500) can be confirmed'
);

select is(
  (select rs.status from public.rent_schedules rs
     join public.organizations o on o.id = rs.org_id
     where o.legal_name = 'Posting Ops Test Org'),
  'partial'::public.rent_schedule_status,
  'the rent schedule moved to partial, not paid, matching the actual matched amount (ACCOUNTING.md §10)'
);

select is(
  (select jl.debit from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_type = 'payment' and jl.debit > 0
     and je.source_id = (select id from public.bank_transactions where description = 'First partial payment')),
  3000::numeric,
  'the payment entry posted exactly the matched amount (3000), never the full scheduled 8500'
);

-- Second transaction covers the remainder -- proves the schedule can still be matched again
-- while in 'partial' status (confirm_bank_transaction_match()'s allowed-status check includes it).
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 5500, 'Second covering payment'
from public.bank_accounts ba where ba.bank_name = 'Posting Ops Test Bank';

select lives_ok(
  $$ select public.confirm_bank_transaction_match(
       (select id from public.bank_transactions where description = 'Second covering payment'),
       (select rs.id from public.rent_schedules rs
          join public.organizations o on o.id = rs.org_id
          where o.legal_name = 'Posting Ops Test Org')
     ) $$,
  'the remaining balance (5500) can be matched against the same still-partial schedule'
);

select is(
  (select rs.status from public.rent_schedules rs
     join public.organizations o on o.id = rs.org_id
     where o.legal_name = 'Posting Ops Test Org'),
  'paid'::public.rent_schedule_status,
  'the rent schedule is now fully paid after the second (covering) payment'
);

select throws_ok(
  $$ select public.confirm_bank_transaction_match(
       (select id from public.bank_transactions where description = 'First partial payment'),
       (select rs.id from public.rent_schedules rs
          join public.organizations o on o.id = rs.org_id
          where o.legal_name = 'Posting Ops Test Org')
     ) $$,
  'P0001'
);

-- === record_expense() ===
insert into public.expenses (org_id, property_id, category, amount, status)
select o.id, p.id, 'Maintenance', 450, 'pending'
from public.properties p
join public.organizations o on o.id = p.org_id and o.legal_name = 'Posting Ops Test Org';

select lives_ok(
  $$ select public.record_expense(
       (select e.id from public.expenses e
          join public.organizations o on o.id = e.org_id
          where o.legal_name = 'Posting Ops Test Org'),
       false
     ) $$,
  'a pending expense can be recorded (unpaid -- posts to Accounts Payable)'
);

select is(
  (select e.status from public.expenses e
     join public.organizations o on o.id = e.org_id
     where o.legal_name = 'Posting Ops Test Org'),
  'recorded'::public.expense_status,
  'the expense moved to recorded'
);

select is(
  (select co.code from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where je.source_type = 'expense' and jl.debit > 0
     and je.description = 'Expense: Maintenance'),
  '5000',
  'the "Maintenance" category matched to the seeded "Maintenance Expense" (5000) account, not the Other Expense fallback'
);

select * from finish();
rollback;
