-- Tests for TASKS.md M14 part 3 (migration 20260101000052): generate_owner_statements(),
-- issue_owner_statement(), confirm_owner_statement_payout(). Builds a real two-owner,
-- two-property portfolio (one property single-owner, one property split 60/40) with real
-- payment/expense journal entries, then verifies ACCOUNTING.md §10's rounding-remainder rule
-- holds exactly.

begin;
select plan(20);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'stmt-accountant@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Owner Statement Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Owner Statement Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

update public.organizations set management_fee_pct = 10.00 where legal_name = 'Owner Statement Test Org';

-- Two owners: Owner A (sole owner of Property 1), Owner A + Owner B split 60/40 on Property 2.
insert into public.owners (org_id, name)
select id, 'Owner A' from public.organizations where legal_name = 'Owner Statement Test Org';
insert into public.owners (org_id, name)
select id, 'Owner B' from public.organizations where legal_name = 'Owner Statement Test Org';

-- properties no longer has a client-facing INSERT policy (20260101000064) -- create_property()
-- is the only sanctioned path as of that migration.
select public.create_property(
  (select id from public.organizations where legal_name = 'Owner Statement Test Org'),
  'Statement Property 1', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
select public.create_property(
  (select id from public.organizations where legal_name = 'Owner Statement Test Org'),
  'Statement Property 2', '2 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);

insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100
from public.properties p, public.owners o
where p.nickname = 'Statement Property 1' and o.name = 'Owner A' and o.org_id = p.org_id;

insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 60
from public.properties p, public.owners o
where p.nickname = 'Statement Property 2' and o.name = 'Owner A' and o.org_id = p.org_id;
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 40
from public.properties p, public.owners o
where p.nickname = 'Statement Property 2' and o.name = 'Owner B' and o.org_id = p.org_id;

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'U1', 'occupied' from public.properties p where p.nickname = 'Statement Property 1';
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'U1', 'occupied' from public.properties p where p.nickname = 'Statement Property 2';

insert into public.tenants (org_id, full_name, status)
select id, 'Statement Tenant 1', 'active' from public.organizations where legal_name = 'Owner Statement Test Org';
insert into public.tenants (org_id, full_name, status)
select id, 'Statement Tenant 2', 'active' from public.organizations where legal_name = 'Owner Statement Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
select u.org_id, u.id, '2026-01-01'::date, 10000, 'active', 'manual'
from public.units u join public.properties p on p.id = u.property_id where p.nickname = 'Statement Property 1';
insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
select u.org_id, u.id, '2026-01-01'::date, 10001, 'active', 'manual'
from public.units u join public.properties p on p.id = u.property_id where p.nickname = 'Statement Property 2';

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id
join public.tenants t on t.org_id = p.org_id and t.full_name = 'Statement Tenant 1'
where p.nickname = 'Statement Property 1';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id
join public.tenants t on t.org_id = p.org_id and t.full_name = 'Statement Tenant 2'
where p.nickname = 'Statement Property 2';

insert into public.bank_accounts (org_id, account_class, bank_name)
select id, 'business', 'Statement Test Bank' from public.organizations where legal_name = 'Owner Statement Test Org';

-- Rent schedules + invoices + payments, dated inside January 2026 (the test period).
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select l.org_id, l.id, date_trunc('month', current_date)::date, l.rent_amount, 'pending'
from public.leases l join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id
where p.nickname in ('Statement Property 1', 'Statement Property 2');

select public.invoice_rent_schedule(rs.id) from public.rent_schedules rs
join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id
where p.nickname = 'Statement Property 1';
select public.invoice_rent_schedule(rs.id) from public.rent_schedules rs
join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id
where p.nickname = 'Statement Property 2';

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 10000, 'Rent payment property 1'
from public.bank_accounts ba where ba.bank_name = 'Statement Test Bank';
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 10001, 'Rent payment property 2'
from public.bank_accounts ba where ba.bank_name = 'Statement Test Bank';

select public.confirm_bank_transaction_match(
  (select id from public.bank_transactions where description = 'Rent payment property 1'),
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id where p.nickname = 'Statement Property 1')
);
select public.confirm_bank_transaction_match(
  (select id from public.bank_transactions where description = 'Rent payment property 2'),
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id where p.nickname = 'Statement Property 2')
);

-- An expense against Property 2 only (500), also inside January.
insert into public.expenses (org_id, property_id, category, amount, status)
select p.org_id, p.id, 'Maintenance', 500, 'pending'
from public.properties p where p.nickname = 'Statement Property 2';
select public.record_expense(
  (select e.id from public.expenses e join public.properties p on p.id = e.property_id where p.nickname = 'Statement Property 2'),
  false
);

-- === generate_owner_statements(): the real batch draft ===
select is(
  (select count(*) from public.generate_owner_statements(
     (select id from public.organizations where legal_name = 'Owner Statement Test Org'), date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
   )),
  2::bigint,
  'exactly 2 owner statements generated (Owner A and Owner B)'
);

-- Owner A: 100% of Property 1 (10000 rent, 0 expenses) + 60% of Property 2 (10001 rent, 500 expenses)
-- rent = 10000 + round(10001*0.6,2)=6000.60 -> 16000.60; expenses = 0 + round(500*0.6,2)=300.00
select is(
  (select rent_collected from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'),
  16000.60::numeric,
  'Owner A rent_collected = 10000 (100% of P1) + 6000.60 (60% of P2 10001) = 16000.60'
);

select is(
  (select expenses_total from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'),
  300.00::numeric,
  'Owner A expenses_total = 60% of the 500 expense = 300.00'
);

select is(
  (select management_fee from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'),
  1600.06::numeric,
  'Owner A management_fee = 10% of rent_collected (16000.60) = 1600.06'
);

select is(
  (select net_payable from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'),
  (16000.60 - 300.00 - 1600.06)::numeric,
  'Owner A net_payable = rent_collected - expenses_total - management_fee, reconciles exactly'
);

-- Owner B: 40% of Property 2 only. Owner A took the rounding-stable-first slot (owner_id order),
-- so Owner B (the LAST owner in stable order for Property 2) absorbs the remainder --
-- rent = 10001 - 6000.60 = 4000.40 exactly (not a naively-rounded 4000.40 that might drift).
select is(
  (select rent_collected from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner B'),
  4000.40::numeric,
  'Owner B rent_collected = remainder (10001 - 6000.60) = 4000.40, sum-exact with Owner A''s share'
);

select is(
  (select (select rent_collected from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = date_trunc('month', current_date)::date)
        + (select rent_collected from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner B' and os.period_start = date_trunc('month', current_date)::date)),
  20001.00::numeric,
  'ACCOUNTING.md §10 invariant: sum of both owners'' rent shares equals the true combined total (10000 + 10001) exactly, no cent lost or gained'
);

select is(
  (select os.status from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'),
  'draft'::public.owner_statement_status,
  'freshly generated statements start as draft'
);

-- === Re-running generation on a still-draft statement recomputes it (idempotent-safe, not a duplicate) ===
select is(
  (select count(*) from public.owner_statements os
     join public.organizations org on org.id = os.org_id
     where org.legal_name = 'Owner Statement Test Org' and os.period_start = date_trunc('month', current_date)::date),
  2::bigint,
  'still exactly 2 rows after generation (no duplicates)'
);

select lives_ok(
  $$ select public.generate_owner_statements(
       (select id from public.organizations where legal_name = 'Owner Statement Test Org'), date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
     ) $$,
  're-running generate_owner_statements() for the same period does not error'
);

select is(
  (select count(*) from public.owner_statements os
     join public.organizations org on org.id = os.org_id
     where org.legal_name = 'Owner Statement Test Org' and os.period_start = date_trunc('month', current_date)::date),
  2::bigint,
  'still exactly 2 rows after re-running (draft rows updated in place, not duplicated)'
);

-- === issue_owner_statement(): freezes the draft ===
select lives_ok(
  $$ select public.issue_owner_statement(
       (select os.id from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A')
     ) $$,
  'accountant issues Owner A''s draft statement'
);

select is(
  (select os.status from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'),
  'issued'::public.owner_statement_status,
  'Owner A''s statement is now issued'
);

select throws_ok(
  $$ select public.issue_owner_statement(
       (select os.id from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A')
     ) $$,
  'P0001',
  null,
  'issuing an already-issued statement raises rather than re-issuing'
);

-- === Issued statements are frozen: regenerating the same period does not overwrite Owner A ===
select public.generate_owner_statements(
  (select id from public.organizations where legal_name = 'Owner Statement Test Org'), date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date
);

select is(
  (select rent_collected from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'),
  16000.60::numeric,
  'Owner A''s issued statement numbers are unchanged after a regeneration attempt (frozen snapshot, ACCOUNTING.md §5)'
);

-- === confirm_owner_statement_payout(): the owner_payout journal entry ===
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, (current_date + interval '1 month')::date, -(select net_payable from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'), 'Owner A payout'
from public.bank_accounts ba where ba.bank_name = 'Statement Test Bank';

select throws_ok(
  $$ select public.confirm_owner_statement_payout(
       (select os.id from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner B'),
       (select id from public.bank_transactions where description = 'Owner A payout')
     ) $$,
  'P0001',
  null,
  'cannot pay out Owner B''s statement while it is still a draft (must be issued first)'
);

select lives_ok(
  $$ select public.confirm_owner_statement_payout(
       (select os.id from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'),
       (select id from public.bank_transactions where description = 'Owner A payout')
     ) $$,
  'accountant confirms Owner A''s payout against the outgoing bank transaction'
);

select is(
  (select os.status from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A'),
  'paid'::public.owner_statement_status,
  'Owner A''s statement is now paid'
);

select is(
  (select sum(jl.debit) - sum(jl.credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_type = 'owner_payout' and je.description = 'Owner statement payout'),
  0::numeric,
  'the owner_payout journal entry (Dr Owner Equity / Cr Business Bank) is balanced'
);

select * from finish();
rollback;
