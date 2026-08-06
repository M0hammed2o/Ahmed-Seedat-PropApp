-- Tests for TASKS.md M14 part 3 (migration 20260101000053): compute_tax_pack(),
-- record_tax_pack_export(). Uses a tax year computed from current_date (SA tax year: 1 March -
-- end of February) so the test is not tied to a hardcoded date that could fall out of a
-- differently-configured environment's "today".

begin;
select plan(12);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'taxpack-accountant@test.propertyvault.example'),
  ('e1000000-0000-0000-0000-000000000002', 'taxpack-agent-only@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Tax Pack Test Org', 'agency')), null, 'org created');

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'e1000000-0000-0000-0000-000000000002'::uuid, 'agent', 'active', now()
from public.organizations where legal_name = 'Tax Pack Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

-- properties no longer has a client-facing INSERT policy (20260101000064) -- create_property()
-- is the only sanctioned path as of that migration.
select public.create_property(
  (select id from public.organizations where legal_name = 'Tax Pack Test Org'),
  'Tax Pack Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'U1', 'occupied' from public.properties p where p.nickname = 'Tax Pack Property';

insert into public.tenants (org_id, full_name, status)
select id, 'Tax Pack Tenant', 'active' from public.organizations where legal_name = 'Tax Pack Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, status, source)
select u.org_id, u.id, current_date, 9000, 'active', 'manual'
from public.units u join public.properties p on p.id = u.property_id where p.nickname = 'Tax Pack Property';

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'Tax Pack Test Org'
join public.tenants t on t.org_id = o.id;

insert into public.bank_accounts (org_id, account_class, bank_name)
select id, 'business', 'Tax Pack Test Bank' from public.organizations where legal_name = 'Tax Pack Test Org';

-- Rent invoiced + paid today (inside the current SA tax year by construction).
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select l.org_id, l.id, current_date, 9000, 'pending'
from public.leases l join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id
where p.nickname = 'Tax Pack Property';

select public.invoice_rent_schedule(rs.id) from public.rent_schedules rs
join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id
where p.nickname = 'Tax Pack Property';

insert into public.bank_transactions (bank_account_id, transaction_date, amount, description)
select ba.id, current_date, 9000, 'Tax pack rent payment'
from public.bank_accounts ba where ba.bank_name = 'Tax Pack Test Bank';

select public.confirm_bank_transaction_match(
  (select id from public.bank_transactions where description = 'Tax pack rent payment'),
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id join public.properties p on p.id = u.property_id where p.nickname = 'Tax Pack Property')
);

-- An expense today, inside the tax year.
insert into public.expenses (org_id, property_id, category, amount, status)
select p.org_id, p.id, 'Maintenance', 1200, 'pending'
from public.properties p where p.nickname = 'Tax Pack Property';
select public.record_expense(
  (select e.id from public.expenses e join public.properties p on p.id = e.property_id where p.nickname = 'Tax Pack Property'),
  false
);

-- A second journal entry dated 2 years before today -- must NOT appear in the current tax year's
-- pack. journal_entries is permanently immutable (ACCOUNTING.md §1) so this cannot be built by
-- posting-then-backdating; post_journal_entry() is called directly with an old entry_date instead
-- (a legitimate, real posting path -- exactly how a genuinely backdated correction would be
-- entered), rather than routing through record_expense(), which always posts at current_date.
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Tax Pack Test Org'),
  (current_date - interval '2 years')::date,
  'Old maintenance expense (outside tax year)',
  'expense',
  (select id from public.properties where nickname = 'Tax Pack Property'),
  jsonb_build_array(
    jsonb_build_object(
      'account_id', (select co.id from public.chart_of_accounts co join public.organizations o on o.id = co.org_id where o.legal_name = 'Tax Pack Test Org' and co.code = '5000'),
      'debit', 777,
      'property_id', (select id from public.properties where nickname = 'Tax Pack Property')
    ),
    jsonb_build_object(
      'account_id', (select co.id from public.chart_of_accounts co join public.organizations o on o.id = co.org_id where o.legal_name = 'Tax Pack Test Org' and co.code = '2000'),
      'credit', 777,
      'property_id', (select id from public.properties where nickname = 'Tax Pack Property')
    )
  )
);

-- The SA tax year containing "today", computed the same way the RPC does (1 March cutover).
-- current_date's tax year = year(current_date) if month >= 3, else year(current_date) - 1 + 1
-- (i.e. if before March, we're still in the tax year that STARTED the previous March and ENDS
-- this Feb, so its "p_tax_year" label is the current calendar year).

select is(
  (select count(*) from public.compute_tax_pack(
     (select id from public.organizations where legal_name = 'Tax Pack Test Org'),
     (case when extract(month from current_date) >= 3 then extract(year from current_date)::int + 1
           else extract(year from current_date)::int end)
   ) where account_type = 'income'),
  1::bigint,
  'exactly one income line (Rent Income) for the current tax year'
);

select is(
  (select amount from public.compute_tax_pack(
     (select id from public.organizations where legal_name = 'Tax Pack Test Org'),
     (case when extract(month from current_date) >= 3 then extract(year from current_date)::int + 1
           else extract(year from current_date)::int end)
   ) where account_type = 'income' and account_code = '4000'),
  9000.00::numeric,
  'Rent Income (4000) amount is exactly the invoiced/collected rent, 9000.00'
);

select is(
  (select amount from public.compute_tax_pack(
     (select id from public.organizations where legal_name = 'Tax Pack Test Org'),
     (case when extract(month from current_date) >= 3 then extract(year from current_date)::int + 1
           else extract(year from current_date)::int end)
   ) where account_type = 'expense' and account_code = '5000'),
  1200.00::numeric,
  'Maintenance Expense (5000) amount is exactly the in-year expense (1200.00), the 777 backdated one excluded'
);

select is(
  (select count(*) from public.compute_tax_pack(
     (select id from public.organizations where legal_name = 'Tax Pack Test Org'),
     (case when extract(month from current_date) >= 3 then extract(year from current_date)::int + 1
           else extract(year from current_date)::int end)
   ) where amount = 777.00),
  0::bigint,
  'the 2-years-ago expense (777) does not appear anywhere in the current tax year pack'
);

select is(
  (select property_id from public.compute_tax_pack(
     (select id from public.organizations where legal_name = 'Tax Pack Test Org'),
     (case when extract(month from current_date) >= 3 then extract(year from current_date)::int + 1
           else extract(year from current_date)::int end)
   ) where account_code = '4000'),
  (select id from public.properties where nickname = 'Tax Pack Property'),
  'the income line is correctly attributed to the property'
);

-- === Role split: agent-only cannot compute or export ===
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select * from public.compute_tax_pack(
       (select id from public.organizations where legal_name = 'Tax Pack Test Org'), 2027
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'an agent-only member cannot call compute_tax_pack()'
);

select throws_ok(
  $$ select public.record_tax_pack_export(
       (select id from public.organizations where legal_name = 'Tax Pack Test Org'), 2027
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'an agent-only member cannot call record_tax_pack_export()'
);
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

-- === Invalid tax_year is rejected ===
select throws_ok(
  $$ select * from public.compute_tax_pack(
       (select id from public.organizations where legal_name = 'Tax Pack Test Org'), 1999
     ) $$,
  'P0001',
  null,
  'a tax_year outside the valid range is rejected'
);

-- === record_tax_pack_export(): the audit record ===
select lives_ok(
  $$ select public.record_tax_pack_export(
       (select id from public.organizations where legal_name = 'Tax Pack Test Org'), 2027
     ) $$,
  'accountant can record a tax pack export'
);

select is(
  (select count(*) from public.tax_pack_exports tpe
     join public.organizations o on o.id = tpe.org_id
     where o.legal_name = 'Tax Pack Test Org' and tpe.tax_year = 2027),
  1::bigint,
  'exactly one tax_pack_exports audit row was written for tax_year 2027'
);

-- === Cross-org isolation: a second org's ledger never leaks into this org's pack ===
-- No client INSERT policy exists on organizations (create_organization() is the only path) --
-- reset role for this one fixture-setup statement, matching the established pattern used
-- throughout this session's test files.
reset role;
insert into public.organizations (id, legal_name, org_type)
values ('f1f1f1f1-0000-0000-0000-000000000001', 'Tax Pack Other Org', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('f1f1f1f1-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'principal', 'active', now());
set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.compute_tax_pack(
     'f1f1f1f1-0000-0000-0000-000000000001'::uuid,
     (case when extract(month from current_date) >= 3 then extract(year from current_date)::int + 1
           else extract(year from current_date)::int end)
   )),
  0::bigint,
  'a second, empty org''s tax pack has zero lines -- no cross-org leakage from Tax Pack Test Org''s ledger'
);

select * from finish();
rollback;
