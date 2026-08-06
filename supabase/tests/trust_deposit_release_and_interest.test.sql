-- Tests for TASKS.md M14 part 3 / TECHNICAL_DEBT_REGISTER.md TD-22 (migration 20260101000051):
-- release_trust_deposit(), accrue_trust_interest(), accrue_trust_interest_for_org(). Follows the
-- same fixture pattern as accounting_posting_operations.test.sql (create_organization() for a
-- principal who satisfies accountant+ via has_org_role ranking, subquery-keyed fixtures, an
-- agent-only second member to prove the PERMISSIONS.md role split for real).

begin;
select plan(21);

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'trust-accountant@test.propertyvault.example'),
  ('b1000000-0000-0000-0000-000000000002', 'trust-agent-only@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

select isnt(
  (select public.create_organization('Trust Release Test Org', 'agency')),
  null,
  'org created'
);

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'b1000000-0000-0000-0000-000000000002'::uuid, 'agent', 'active', now()
from public.organizations where legal_name = 'Trust Release Test Org';
update public.organizations set deposit_interest_pct = 5.00 where legal_name = 'Trust Release Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

-- properties no longer has a client-facing INSERT policy (20260101000064) -- create_property()
-- is the only sanctioned path as of that migration.
select public.create_property(
  (select id from public.organizations where legal_name = 'Trust Release Test Org'),
  'Trust Release Property', '1 Test Street', 'Cape Town', 'ZA', 'house'::public.property_type
);

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Trust Release Unit', 'occupied'
from public.properties p where p.nickname = 'Trust Release Property';

insert into public.tenants (org_id, full_name, status)
select id, 'Trust Release Tenant', 'active'
from public.organizations where legal_name = 'Trust Release Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 10000, 10000, 'active', 'manual'
from public.organizations o
join public.units u on u.org_id = o.id and u.unit_label = 'Trust Release Unit'
where o.legal_name = 'Trust Release Test Org';

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'Trust Release Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'Trust Release Tenant';

select public.post_lease_deposit(
  (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org')
);

-- === Release gate: no completed move_out inspection yet ===
select throws_ok(
  $$ select public.release_trust_deposit(
       (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org'),
       2000, 8000, 'carpet damage'
     ) $$,
  'P0001',
  null,
  'release is rejected with no completed move_out inspection on the lease'
);

-- A scheduled/in_progress move_out inspection is not enough -- must be status='completed'.
insert into public.inspections (org_id, property_id, unit_id, lease_id, inspection_type, scheduled_at, status)
select o.id, p.id, u.id, l.id, 'move_out', now(), 'scheduled'
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'Trust Release Test Org'
join public.units u on u.id = l.unit_id
join public.properties p on p.id = u.property_id;

select throws_ok(
  $$ select public.release_trust_deposit(
       (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org'),
       2000, 8000, 'carpet damage'
     ) $$,
  'P0001',
  null,
  'release is still rejected while the move_out inspection is only scheduled, not completed'
);

update public.inspections
set status = 'completed', landlord_signed_at = now(), tenant_signed_at = now()
where lease_id = (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org')
  and inspection_type = 'move_out';

-- === Amount validation: deduction + refund must equal the full current_balance ===
select throws_ok(
  $$ select public.release_trust_deposit(
       (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org'),
       2000, 5000, 'partial mismatch'
     ) $$,
  'P0001',
  null,
  'release is rejected when deduction + refund does not equal the trust ledger''s current balance'
);

-- === Role split: agent-only cannot release ===
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.release_trust_deposit(
       (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org'),
       2000, 8000, 'carpet damage'
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'an agent-only member cannot call release_trust_deposit()'
);
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

-- === The real, correctly-authorized release ===
select lives_ok(
  $$ select public.release_trust_deposit(
       (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org'),
       2000, 8000, 'carpet damage'
     ) $$,
  'accountant releases the deposit: 2000 deduction + 8000 refund = 10000 current_balance'
);

select is(
  (select tl.current_balance from public.trust_ledgers tl
     join public.leases l on l.id = tl.lease_id
     join public.organizations o on o.id = l.org_id
     where o.legal_name = 'Trust Release Test Org'),
  0::numeric,
  'the trust ledger balance is now zero'
);

select is(
  (select tl.status from public.trust_ledgers tl
     join public.leases l on l.id = tl.lease_id
     join public.organizations o on o.id = l.org_id
     where o.legal_name = 'Trust Release Test Org'),
  'released'::public.trust_ledger_status,
  'the trust ledger is marked released'
);

select is(
  (select count(*) from public.trust_ledger_entries tle
     join public.trust_ledgers tl on tl.id = tle.trust_ledger_id
     join public.leases l on l.id = tl.lease_id
     join public.organizations o on o.id = l.org_id
     where o.legal_name = 'Trust Release Test Org' and tle.entry_type = 'deduction' and tle.amount = 2000),
  1::bigint,
  'a deduction trust_ledger_entries row for 2000 was recorded'
);

select is(
  (select count(*) from public.trust_ledger_entries tle
     join public.trust_ledgers tl on tl.id = tle.trust_ledger_id
     join public.leases l on l.id = tl.lease_id
     join public.organizations o on o.id = l.org_id
     where o.legal_name = 'Trust Release Test Org' and tle.entry_type = 'refund' and tle.amount = 8000),
  1::bigint,
  'a refund trust_ledger_entries row for 8000 was recorded'
);

select is(
  (select sum(jl.debit) - sum(jl.credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.description = 'Deposit release (settlement)'),
  0::numeric,
  'the release journal entry (Dr Deposits Held / Cr Trust Bank) is balanced'
);

select is(
  (select co.code from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where je.description like 'Deposit deduction:%' and jl.credit = 2000),
  '4900',
  'the deduction portion credits the new Deposit Deduction Income (4900) account'
);

select is(
  (select jl.debit from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.chart_of_accounts co on co.id = jl.account_id
     where je.description like 'Deposit deduction:%' and co.code = '1000'),
  2000::numeric,
  'the deduction portion debits the Business Bank Account (1000) for exactly the deducted amount'
);

-- === Double-release guard ===
select throws_ok(
  $$ select public.release_trust_deposit(
       (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org'),
       0, 1, 'second attempt'
     ) $$,
  'P0001',
  null,
  'releasing an already-released trust ledger raises rather than double-releasing'
);

-- === accrue_trust_interest(): a second lease/deposit so the first ledger's 'released' state
-- doesn't interfere ===
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Trust Interest Unit', 'occupied'
from public.properties p where p.nickname = 'Trust Release Property';

insert into public.tenants (org_id, full_name, status)
select id, 'Trust Interest Tenant', 'active'
from public.organizations where legal_name = 'Trust Release Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 6000, 6000, 'active', 'manual'
from public.organizations o
join public.units u on u.org_id = o.id and u.unit_label = 'Trust Interest Unit'
where o.legal_name = 'Trust Release Test Org';

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'Trust Release Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'Trust Interest Tenant'
where l.rent_amount = 6000;

select public.post_lease_deposit(
  (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org' and l.rent_amount = 6000)
);

-- Backdate the ledger by exactly 365 days so a 5% annual rate produces an exact, assertable
-- amount (6000 * 0.05 * 365/365 = 300.00) rather than a sub-cent, time-of-test-run-dependent value.
update public.trust_ledgers
set created_at = now() - interval '365 days'
where lease_id = (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Trust Release Test Org' and l.rent_amount = 6000);

set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.accrue_trust_interest(
       (select tl.id from public.trust_ledgers tl join public.leases l on l.id = tl.lease_id where l.rent_amount = 6000)
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'an agent-only member cannot call accrue_trust_interest()'
);
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.accrue_trust_interest(
       (select tl.id from public.trust_ledgers tl join public.leases l on l.id = tl.lease_id where l.rent_amount = 6000)
     ) $$,
  'accountant accrues interest on the active ledger'
);

select is(
  (select tl.current_balance from public.trust_ledgers tl join public.leases l on l.id = tl.lease_id where l.rent_amount = 6000),
  6300.00::numeric,
  'current_balance grew by exactly 300.00 (6000 * 5% over 365 days)'
);

select is(
  (select tle.amount from public.trust_ledger_entries tle
     join public.trust_ledgers tl on tl.id = tle.trust_ledger_id
     join public.leases l on l.id = tl.lease_id
     where l.rent_amount = 6000 and tle.entry_type = 'interest_accrued'),
  300.00::numeric,
  'an interest_accrued trust_ledger_entries row for exactly 300.00 was recorded'
);

select is(
  (select sum(jl.debit) - sum(jl.credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.description = 'Trust deposit interest accrual'),
  0::numeric,
  'the interest journal entry (Dr Trust Interest Expense / Cr Tenant Deposits Held) is balanced'
);

-- === Released ledger cannot accrue further interest ===
select throws_ok(
  $$ select public.accrue_trust_interest(
       (select tl.id from public.trust_ledgers tl
          join public.leases l on l.id = tl.lease_id
          join public.organizations o on o.id = l.org_id
          where o.legal_name = 'Trust Release Test Org' and tl.status = 'released')
     ) $$,
  'P0001',
  null,
  'accrue_trust_interest() rejects an already-released trust ledger'
);

-- === accrue_trust_interest_for_org(): bulk wrapper skips the released ledger, only touches the
-- active one, and is itself idempotent for "no time elapsed" (immediate re-run is a no-op) ===
select is(
  (select count(*) from public.accrue_trust_interest_for_org(
     (select id from public.organizations where legal_name = 'Trust Release Test Org')
   )),
  0::bigint,
  'accrue_trust_interest_for_org() immediately re-run accrues nothing further (no time has elapsed since the accrual above)'
);

select * from finish();
rollback;
