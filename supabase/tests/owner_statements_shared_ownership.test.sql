-- Tests for 20260101000071_owner_statements_shared_ownership.sql: ownership-history-aware
-- statement generation (a mid-period-boundary ownership change must use the percentage that was
-- actually true for the period, not today's), the maintenance-reserve deduction, and partial
-- payout tracking (amount_paid/outstanding_balance/owner_statement_payouts). Posts journal
-- entries directly via post_journal_entry() (same shape confirm_bank_transaction_match() posts)
-- rather than the full rent-invoicing pipeline, to keep this test focused on what actually changed.

begin;
select plan(12);

insert into auth.users (id, email) values
  ('f9000000-0000-0000-0000-000000000001', 'osso-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f9000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Shared Ownership Statement Test Org', 'owner_managed')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Shared Ownership Statement Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f9000000-0000-0000-0000-000000000001';

update public.organizations set management_fee_pct = 10.00, maintenance_reserve_pct = 5.00
where legal_name = 'Shared Ownership Statement Test Org';

select set_config('pgtap.osso_test.org_id', (select id::text from public.organizations where legal_name = 'Shared Ownership Statement Test Org'), false);

insert into public.owners (org_id, name)
select current_setting('pgtap.osso_test.org_id')::uuid, x from unnest(array['Owner A', 'Owner B']) x;

select set_config(
  'pgtap.osso_test.property_id',
  (select public.create_property(
    current_setting('pgtap.osso_test.org_id')::uuid,
    'Shared Statement Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

-- Owner A is sole owner for January (the statement period below). property_ownership_history's
-- effective_from is populated from real wall-clock now() by the trigger (20260101000062), not
-- from any date this test controls -- since "now" in this environment is well after January 2026,
-- the freshly-inserted history row must be backdated directly (superuser, matching how this file
-- already resets role for organization_members) so it genuinely predates the fictional period
-- below. Without this, `effective_from <= period_end` is false for every row and the whole
-- ownership-history lookup silently finds nobody -- caught by test 2 failing outright the first
-- time this test was run, not assumed safe.
insert into public.property_owners (property_id, owner_id, ownership_pct)
select current_setting('pgtap.osso_test.property_id')::uuid, o.id, 100
from public.owners o where o.name = 'Owner A';

reset role;
update public.property_ownership_history
set effective_from = '2025-01-01'::timestamptz
where property_id = current_setting('pgtap.osso_test.property_id')::uuid;
set local role authenticated;
set local "request.jwt.claim.sub" = 'f9000000-0000-0000-0000-000000000001';

-- Post a January payment (10000) and expense (1000) directly, same shape real posting code uses.
select public.post_journal_entry(
  current_setting('pgtap.osso_test.org_id')::uuid, '2026-01-15', 'Rent payment received', 'payment', null,
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = current_setting('pgtap.osso_test.org_id')::uuid and code = '1000'), 'debit', 10000, 'property_id', current_setting('pgtap.osso_test.property_id')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = current_setting('pgtap.osso_test.org_id')::uuid and code = '1100'), 'credit', 10000, 'property_id', current_setting('pgtap.osso_test.property_id'))
  )
);
select public.post_journal_entry(
  current_setting('pgtap.osso_test.org_id')::uuid, '2026-01-20', 'Maintenance expense', 'expense', null,
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = current_setting('pgtap.osso_test.org_id')::uuid and code = '5000'), 'debit', 1000, 'property_id', current_setting('pgtap.osso_test.property_id')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = current_setting('pgtap.osso_test.org_id')::uuid and code = '2000'), 'credit', 1000, 'property_id', current_setting('pgtap.osso_test.property_id'))
  )
);

-- AFTER the January activity, ownership changes to a 50/50 split -- this must NOT affect a
-- statement generated for January, only for a later period.
insert into public.property_owners (property_id, owner_id, ownership_pct)
select current_setting('pgtap.osso_test.property_id')::uuid, o.id, 50
from public.owners o where o.name = 'Owner B';
update public.property_owners set ownership_pct = 50
where property_id = current_setting('pgtap.osso_test.property_id')::uuid
  and owner_id = (select id from public.owners where name = 'Owner A');

-- === Ownership-history awareness ===
select public.generate_owner_statements(current_setting('pgtap.osso_test.org_id')::uuid, '2026-01-01', '2026-01-31');

select is(
  (select count(*)::int from public.owner_statements os join public.owners o on o.id = os.owner_id
     where os.org_id = current_setting('pgtap.osso_test.org_id')::uuid and os.period_start = '2026-01-01' and o.name = 'Owner A'),
  1,
  'Owner A gets a January statement (100% ownership as of period_end, per history)'
);

select is(
  (select count(*)::int from public.owner_statements os join public.owners o on o.id = os.owner_id
     where os.org_id = current_setting('pgtap.osso_test.org_id')::uuid and os.period_start = '2026-01-01' and o.name = 'Owner B'),
  0,
  'Owner B gets NO January statement -- they held no share as of January''s period_end, even though they do today'
);

-- === Reserve deduction ===
-- rent 10000, expenses 1000, mgmt fee 10% of rent = 1000, reserve 5% of rent = 500
-- net_payable = 10000 - 1000 - 1000 - 500 = 7500
select is(
  (select reserve_amount from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = '2026-01-01'),
  500.00::numeric,
  'reserve_amount is 5% of rent_collected, matching organizations.maintenance_reserve_pct'
);

select is(
  (select net_payable from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = '2026-01-01'),
  7500.00::numeric,
  'net_payable correctly deducts management_fee AND reserve_amount, not just the fee'
);

select is(
  (select outstanding_balance from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = '2026-01-01'),
  7500.00::numeric,
  'outstanding_balance equals the full net_payable before any payout'
);

-- === Partial payout ===
select public.issue_owner_statement(
  (select os.id from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = '2026-01-01')
);

insert into public.bank_accounts (org_id, account_class, bank_name)
select current_setting('pgtap.osso_test.org_id')::uuid, 'business', 'Statement Payout Bank';

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, '2026-02-01', 3000, 'Partial owner payout' from public.bank_accounts where bank_name = 'Statement Payout Bank';

select lives_ok(
  $$ select public.confirm_owner_statement_payout(
    (select os.id from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = '2026-01-01'),
    (select id from public.bank_transactions where description = 'Partial owner payout'),
    3000
  ) $$,
  'a partial payout (3000 of 7500) is accepted'
);

select is(
  (select os.status from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = '2026-01-01'),
  'issued'::public.owner_statement_status,
  'status stays "issued" after a partial payout -- not yet fully paid'
);

select is(
  (select outstanding_balance from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = '2026-01-01'),
  4500.00::numeric,
  'outstanding_balance correctly reflects the remaining 4500 after a 3000 partial payout'
);

-- Second, final payout for the remainder.
insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select id, '2026-02-15', 4500, 'Final owner payout' from public.bank_accounts where bank_name = 'Statement Payout Bank';

select public.confirm_owner_statement_payout(
  (select os.id from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = '2026-01-01'),
  (select id from public.bank_transactions where description = 'Final owner payout')
);

select is(
  (select os.status from public.owner_statements os join public.owners o on o.id = os.owner_id where o.name = 'Owner A' and os.period_start = '2026-01-01'),
  'paid'::public.owner_statement_status,
  'status flips to "paid" once the outstanding balance reaches zero across two partial payouts'
);

select is(
  (select count(*)::int from public.owner_statement_payouts osp
     join public.owner_statements os on os.id = osp.owner_statement_id join public.owners o on o.id = os.owner_id
     where o.name = 'Owner A' and os.period_start = '2026-01-01'),
  2,
  'owner_statement_payouts has exactly two rows -- the full distribution history, not just the final one'
);

select is(
  (select sum(amount) from public.owner_statement_payouts osp
     join public.owner_statements os on os.id = osp.owner_statement_id join public.owners o on o.id = os.owner_id
     where o.name = 'Owner A' and os.period_start = '2026-01-01'),
  7500.00::numeric,
  'the two payouts sum to exactly the original net_payable'
);

select * from finish();
rollback;
