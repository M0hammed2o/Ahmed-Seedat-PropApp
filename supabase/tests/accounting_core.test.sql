-- Tests for the core double-entry ledger (TASKS.md M14 part 1, migration 20260101000035):
-- chart_of_accounts seeding, post_journal_entry()'s balance/period validation,
-- reverse_journal_entry()'s linkage, and -- the single most important assertion in this project
-- so far -- that journal_entries/journal_lines are genuinely immutable even against the
-- postgres superuser connection this test file itself runs as by default, not merely "no RLS
-- policy grants it" (RLS doesn't even apply to a superuser/BYPASSRLS role, so that alone would
-- prove nothing about real immutability -- see this migration's own header note).

begin;
select plan(21);

insert into auth.users (id, email) values
  ('ac000000-0000-0000-0000-000000000001', 'accounting-principal@test.propertyvault.example'),
  ('ac000000-0000-0000-0000-000000000002', 'accounting-viewer@test.propertyvault.example');

-- === Chart of accounts seeding: create_organization() now seeds it atomically ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'ac000000-0000-0000-0000-000000000001';

select isnt(
  (select public.create_organization('Accounting Test Org', 'agency')),
  null,
  'create_organization() still succeeds after being extended to seed the chart of accounts'
);

select is(
  (select count(*) from public.chart_of_accounts co
     join public.organizations o on o.id = co.org_id
     where o.legal_name = 'Accounting Test Org' and co.is_system),
  11::bigint,
  'exactly 11 system accounts were seeded for the new org'
);

select is(
  (select count(*) from public.chart_of_accounts co
     join public.organizations o on o.id = co.org_id
     where o.legal_name = 'Accounting Test Org' and co.ledger_class = 'trust'),
  2::bigint,
  'exactly 2 of the seeded accounts are trust-class (Trust Bank Account, Tenant Deposits Held)'
);

-- === post_journal_entry(): balance and shape validation ===
select throws_ok(
  $$ select public.post_journal_entry(
       (select id from public.organizations where legal_name = 'Accounting Test Org'),
       current_date, 'Unbalanced test entry', 'adjustment', null,
       jsonb_build_array(
         jsonb_build_object('account_id', (select id from public.chart_of_accounts where code = '1000' and org_id = (select id from public.organizations where legal_name = 'Accounting Test Org')), 'debit', 100),
         jsonb_build_object('account_id', (select id from public.chart_of_accounts where code = '4000' and org_id = (select id from public.organizations where legal_name = 'Accounting Test Org')), 'credit', 50)
       )
     ) $$,
  'P0001',
  'Unbalanced journal entry: total debits 100.00 != total credits 50.00',
  'post_journal_entry() rejects an unbalanced entry (100 debit vs 50 credit) rather than posting it partially'
);

select is(
  (select count(*) from public.journal_entries where description = 'Unbalanced test entry'),
  0::bigint,
  'the rejected unbalanced entry was not partially inserted -- zero journal_entries rows exist for it'
);

select throws_ok(
  $$ select public.post_journal_entry(
       (select id from public.organizations where legal_name = 'Accounting Test Org'),
       current_date, 'Single line entry', 'adjustment', null,
       jsonb_build_array(jsonb_build_object('account_id', gen_random_uuid(), 'debit', 100))
     ) $$,
  'P0001',
  'A journal entry requires an array of at least two lines',
  'post_journal_entry() rejects an entry with fewer than two lines'
);

-- === post_journal_entry(): the real, balanced, correctly-authorized path ===
select lives_ok(
  $$ select public.post_journal_entry(
       (select id from public.organizations where legal_name = 'Accounting Test Org'),
       current_date, 'Rent invoice for Unit 1', 'rent_invoice', null,
       jsonb_build_array(
         jsonb_build_object('account_id', (select id from public.chart_of_accounts where code = '1100' and org_id = (select id from public.organizations where legal_name = 'Accounting Test Org')), 'debit', 8500),
         jsonb_build_object('account_id', (select id from public.chart_of_accounts where code = '4000' and org_id = (select id from public.organizations where legal_name = 'Accounting Test Org')), 'credit', 8500)
       )
     ) $$,
  'a balanced, correctly-authorized entry posts successfully'
);

select is(
  (select count(*) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.description = 'Rent invoice for Unit 1'),
  2::bigint,
  'exactly 2 journal_lines rows were created for the posted entry'
);

select is(
  (select sum(debit) - sum(credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.description = 'Rent invoice for Unit 1'),
  0::numeric,
  'the posted entry''s lines sum to zero (debits exactly equal credits)'
);

-- === Immutability: the single most important assertion in this project so far. This entire test
--     file runs, up to this point, in the default `postgres` superuser connection context (only
--     switched to `authenticated` above for the RLS-relevant calls) -- postgres bypasses RLS
--     entirely already. If the trigger blocks even THIS, immutability is real; if it only blocked
--     `authenticated`, it would prove nothing about a compromised service-role credential. ===
reset role;

select throws_ok(
  $$ update public.journal_entries set description = 'HACKED'
     where description = 'Rent invoice for Unit 1' $$,
  'P0001',
  'journal_entries rows cannot be updated except to set reversed_by_entry_id (ACCOUNTING.md §1)',
  'even the postgres superuser connection cannot UPDATE a posted journal_entries row''s description'
);

select throws_ok(
  $$ delete from public.journal_entries where description = 'Rent invoice for Unit 1' $$,
  'P0001',
  'journal_entries rows can never be deleted (ACCOUNTING.md §1)',
  'even the postgres superuser connection cannot DELETE a posted journal_entries row'
);

select throws_ok(
  $$ update public.journal_lines set debit = 999999
     where journal_entry_id = (select id from public.journal_entries where description = 'Rent invoice for Unit 1') $$,
  'P0001',
  'journal_lines rows are permanently immutable once posted (ACCOUNTING.md §1)',
  'even the postgres superuser connection cannot UPDATE a posted journal_lines row''s amount'
);

select throws_ok(
  $$ delete from public.journal_lines
     where journal_entry_id = (select id from public.journal_entries where description = 'Rent invoice for Unit 1') $$,
  'P0001',
  'journal_lines rows are permanently immutable once posted (ACCOUNTING.md §1)',
  'even the postgres superuser connection cannot DELETE a posted journal_lines row'
);

select is(
  (select description from public.journal_entries where description = 'Rent invoice for Unit 1'),
  'Rent invoice for Unit 1',
  'confirms none of the four attack attempts above actually changed anything'
);

-- === The same real-immutability fix, applied to audit_events (migration 20260101000036) --
--     discovered during this same review: identically documented as "no update/delete policy...
--     trustworthy audit trail," identically insufficient against BYPASSRLS. Still in the
--     postgres-superuser context from `reset role;` above. ===
insert into public.audit_events (org_id, actor_user_id, actor_type, action, target_type, target_id)
select id, 'ac000000-0000-0000-0000-000000000001'::uuid, 'admin', 'test_action', 'test_entity', gen_random_uuid()
from public.organizations where legal_name = 'Accounting Test Org';

select throws_ok(
  $$ update public.audit_events set action = 'HACKED' where action = 'test_action' $$,
  'P0001',
  'audit_events rows are permanently immutable once written (trustworthy audit trail requirement)',
  'even the postgres superuser connection cannot UPDATE an audit_events row'
);

select throws_ok(
  $$ delete from public.audit_events where action = 'test_action' $$,
  'P0001',
  'audit_events rows are permanently immutable once written (trustworthy audit trail requirement)',
  'even the postgres superuser connection cannot DELETE an audit_events row'
);

-- === reverse_journal_entry(): the sanctioned correction path ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'ac000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.reverse_journal_entry(
       (select id from public.journal_entries where description = 'Rent invoice for Unit 1'),
       current_date, 'Test reversal'
     ) $$,
  'reverse_journal_entry() succeeds against the correctly-posted entry'
);

select is(
  (select reversed_by_entry_id is not null from public.journal_entries where description = 'Rent invoice for Unit 1'),
  true,
  'the original entry''s reversed_by_entry_id is now set (the one narrow mutation the trigger allows)'
);

select is(
  (select sum(debit) - sum(credit) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     where je.description = 'Test reversal'),
  0::numeric,
  'the reversal entry itself is balanced (it was posted via post_journal_entry(), same validation)'
);

select throws_ok(
  $$ select public.reverse_journal_entry(
       (select id from public.journal_entries where description = 'Rent invoice for Unit 1')
     ) $$,
  'P0001',
  null,
  'attempting to reverse an already-reversed entry raises rather than double-reversing'
);

-- === Period locking (ACCOUNTING.md §9) ===
insert into public.accounting_periods (org_id, period_start, period_end, status, closed_by, closed_at)
select id, '2026-01-01'::date, '2026-01-31'::date, 'closed', 'ac000000-0000-0000-0000-000000000001'::uuid, now()
from public.organizations where legal_name = 'Accounting Test Org';

select throws_ok(
  $$ select public.post_journal_entry(
       (select id from public.organizations where legal_name = 'Accounting Test Org'),
       '2026-01-15'::date, 'Backdated post attempt', 'adjustment', null,
       jsonb_build_array(
         jsonb_build_object('account_id', (select id from public.chart_of_accounts where code = '1000' and org_id = (select id from public.organizations where legal_name = 'Accounting Test Org')), 'debit', 10),
         jsonb_build_object('account_id', (select id from public.chart_of_accounts where code = '4000' and org_id = (select id from public.organizations where legal_name = 'Accounting Test Org')), 'credit', 10)
       )
     ) $$,
  'P0001',
  'Cannot post to a closed accounting period (entry_date 2026-01-15)',
  'post_journal_entry() rejects a post dated into a closed period'
);

select * from finish();
rollback;
