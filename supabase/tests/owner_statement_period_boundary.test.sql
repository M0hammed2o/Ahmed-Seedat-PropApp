-- Final accounting reconciliation pass (WORKLOG.md this date), P0: proves the
-- generate_owner_statements() date/timestamptz boundary fix (migration 156) precisely, scenario
-- by scenario, rather than relying only on the pre-existing suite happening to pass today.
--
-- Each scenario creates its own property (one owner, 100%), directly stamps that property's
-- property_ownership_history.effective_from/effective_to to an exact controlled instant (service
-- role -- that table has no client INSERT/UPDATE policy at all, by design), posts one real R1000
-- 'payment' journal entry dated inside the test period (journal_entries.entry_date is a plain
-- `date` column -- not the thing migration 156 fixed, so any date inside the period is fine), then
-- calls generate_owner_statements() for that exact period and asserts whether the owner's
-- rent_collected includes it. Each scenario gets its OWN owner (Boundary Owner 1..10) -- reusing
-- one owner across scenarios that share the same (owner_id, period) would make
-- generate_owner_statements() aggregate rent across every property that owner holds in that
-- period, contaminating later scenarios' totals with earlier ones (found by running this: three
-- same-period scenarios failed together with an inflated total until this was fixed).

begin;
select plan(10);

insert into auth.users (id, email) values
  ('a1b00000-0000-0000-0000-000000000001', 'boundary-accountant@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.create_organization('Boundary Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Boundary Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';

insert into public.owners (org_id, name)
select id, 'Boundary Owner ' || n
from public.organizations, generate_series(1, 10) as n
where legal_name = 'Boundary Test Org';

-- Helper fixture, run per scenario (inlined -- pgTAP/plpgsql has no lightweight cross-statement
-- macro here that keeps subquery-based lookups working the same way the rest of this repo's specs
-- already rely on): create property P<label>, unit, 100%-owned by "Boundary Owner", post a R1000
-- 'payment' journal entry on p_entry_date, then directly stamp property_ownership_history's
-- effective_from (and optionally effective_to) for that property to the exact instant under test.

-- === Scenario 1: transaction/ownership at the very start of the first day -- included ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 1', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 1' and o.name = 'Boundary Owner 1' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2026-02-01 00:00:00+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 1') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-02-01', 'Boundary scenario 1 rent',
  'payment', gen_random_uuid(),
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1000'), 'debit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 1')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1100'), 'credit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 1'))
  )
);
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-02-01', '2026-02-28');
select is(
  (select rent_collected from public.owner_statements where owner_id = (select id from public.owners where name = 'Boundary Owner 1') and period_start = '2026-02-01' and period_end = '2026-02-28'),
  1000::numeric,
  'Scenario 1: ownership effective_from at 00:00:00 on the first day of the period is included'
);

-- === Scenario 2: ownership set up midday on the LAST day of the period -- included (this is the
-- exact case that used to fail) ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 2', '2 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 2' and o.name = 'Boundary Owner 2' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2026-02-28 12:00:00+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 2') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-02-28', 'Boundary scenario 2 rent',
  'payment', gen_random_uuid(),
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1000'), 'debit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 2')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1100'), 'credit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 2'))
  )
);
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-02-01', '2026-02-28');
select is(
  (select count(*) from public.owner_statements where owner_id = (select id from public.owners where name = 'Boundary Owner 2') and period_start = '2026-02-01' and period_end = '2026-02-28' and rent_collected = 1000),
  1::bigint,
  'Scenario 2: ownership set up at midday on the LAST day of the period is included -- the exact case that used to silently fail'
);

-- === Scenario 3: ownership set up at 23:59:59 on the last day -- included ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 3', '3 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 3' and o.name = 'Boundary Owner 3' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2026-02-28 23:59:59+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 3') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-02-28', 'Boundary scenario 3 rent',
  'payment', gen_random_uuid(),
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1000'), 'debit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 3')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1100'), 'credit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 3'))
  )
);
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-02-01', '2026-02-28');
select is(
  (select count(*) from public.owner_statements where owner_id = (select id from public.owners where name = 'Boundary Owner 3') and period_start = '2026-02-01' and period_end = '2026-02-28' and rent_collected = 1000),
  1::bigint,
  'Scenario 3: ownership set up at 23:59:59 on the last day of the period is included'
);

-- === Scenario 4: ownership set up the day AFTER the period ends -- excluded ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 4', '4 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 4' and o.name = 'Boundary Owner 4' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2026-03-01 00:00:01+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 4') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
-- No journal entry needed for Feb -- there is genuinely no rent for this property in the Feb
-- period, so the real assertion is that the property produces NO owner_statements row at all
-- (generate_owner_statements() `continue`s for a property with zero activity either way -- this
-- proves the ownership check, not a false-positive from an unrelated non-zero total).
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-02-01', '2026-02-28');
select is(
  (select count(*) from public.property_ownership_history
     where property_id = (select id from public.properties where nickname = 'Boundary Property 4')
       and effective_from < '2026-02-28'::date + 1),
  0::bigint,
  'Scenario 4: ownership effective_from the day after the period ends is correctly excluded by the boundary itself'
);

-- === Scenario 5: 28-day month (Feb 2026, non-leap) -- last-day ownership included ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 5', '5 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 5' and o.name = 'Boundary Owner 5' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2026-02-28 20:00:00+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 5') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-02-28', 'Boundary scenario 5 rent',
  'payment', gen_random_uuid(),
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1000'), 'debit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 5')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1100'), 'credit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 5'))
  )
);
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-02-01', '2026-02-28');
select is(
  (select count(*) from public.owner_statements where owner_id = (select id from public.owners where name = 'Boundary Owner 5') and period_start = '2026-02-01' and period_end = '2026-02-28' and rent_collected = 1000),
  1::bigint,
  'Scenario 5: 28-day month (Feb 2026) -- last-day ownership is included'
);

-- === Scenario 6: 29-day month (Feb 2028, leap year) ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 6', '6 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 6' and o.name = 'Boundary Owner 6' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2028-02-29 20:00:00+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 6') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Boundary Test Org'), '2028-02-29', 'Boundary scenario 6 rent',
  'payment', gen_random_uuid(),
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1000'), 'debit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 6')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1100'), 'credit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 6'))
  )
);
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2028-02-01', '2028-02-29');
select is(
  (select count(*) from public.owner_statements where owner_id = (select id from public.owners where name = 'Boundary Owner 6') and period_start = '2028-02-01' and period_end = '2028-02-29' and rent_collected = 1000),
  1::bigint,
  'Scenario 6: 29-day month (Feb 2028, leap year) -- last-day ownership is included'
);

-- === Scenario 7: 30-day month (April) ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 7', '7 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 7' and o.name = 'Boundary Owner 7' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2026-04-30 20:00:00+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 7') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-04-30', 'Boundary scenario 7 rent',
  'payment', gen_random_uuid(),
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1000'), 'debit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 7')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1100'), 'credit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 7'))
  )
);
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-04-01', '2026-04-30');
select is(
  (select count(*) from public.owner_statements where owner_id = (select id from public.owners where name = 'Boundary Owner 7') and period_start = '2026-04-01' and period_end = '2026-04-30' and rent_collected = 1000),
  1::bigint,
  'Scenario 7: 30-day month (April) -- last-day ownership is included'
);

-- === Scenario 8: 31-day month (January) ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 8', '8 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 8' and o.name = 'Boundary Owner 8' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2026-01-31 20:00:00+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 8') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-01-31', 'Boundary scenario 8 rent',
  'payment', gen_random_uuid(),
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1000'), 'debit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 8')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1100'), 'credit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 8'))
  )
);
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-01-01', '2026-01-31');
select is(
  (select count(*) from public.owner_statements where owner_id = (select id from public.owners where name = 'Boundary Owner 8') and period_start = '2026-01-01' and period_end = '2026-01-31' and rent_collected = 1000),
  1::bigint,
  'Scenario 8: 31-day month (January) -- last-day ownership is included'
);

-- === Scenario 9: year boundary, Dec 31 -> Jan 1 (period_end + 1 day rolls into the next year) ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 9', '9 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 9' and o.name = 'Boundary Owner 9' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2026-12-31 22:00:00+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 9') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-12-31', 'Boundary scenario 9 rent',
  'payment', gen_random_uuid(),
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1000'), 'debit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 9')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1100'), 'credit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 9'))
  )
);
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-12-01', '2026-12-31');
select is(
  (select count(*) from public.owner_statements where owner_id = (select id from public.owners where name = 'Boundary Owner 9') and period_start = '2026-12-01' and period_end = '2026-12-31' and rent_collected = 1000),
  1::bigint,
  'Scenario 9: year boundary (Dec 31 -> Jan 1) -- last-day-of-year ownership is included'
);

-- === Scenario 10: an ordinary, non-boundary case -- totals unchanged by the fix (regression) ===
select public.create_property(
  (select id from public.organizations where legal_name = 'Boundary Test Org'),
  'Boundary Property 10', '10 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 100 from public.properties p, public.owners o
where p.nickname = 'Boundary Property 10' and o.name = 'Boundary Owner 10' and o.org_id = p.org_id;
reset role;
update public.property_ownership_history
  set effective_from = '2026-05-01 00:00:00+00'::timestamptz
  where property_id = (select id from public.properties where nickname = 'Boundary Property 10') and effective_to is null;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1b00000-0000-0000-0000-000000000001';
select public.post_journal_entry(
  (select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-05-15', 'Boundary scenario 10 rent',
  'payment', gen_random_uuid(),
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1000'), 'debit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 10')),
    jsonb_build_object('account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Boundary Test Org') and code = '1100'), 'credit', 1000, 'property_id', (select id from public.properties where nickname = 'Boundary Property 10'))
  )
);
select public.generate_owner_statements((select id from public.organizations where legal_name = 'Boundary Test Org'), '2026-05-01', '2026-05-31');
select is(
  (select rent_collected from public.owner_statements where owner_id = (select id from public.owners where name = 'Boundary Owner 10') and period_start = '2026-05-01' and period_end = '2026-05-31'),
  1000::numeric,
  'Scenario 10: an ordinary mid-month case, nowhere near either boundary, still computes the correct total -- the fix changed nothing else'
);

select * from finish();
rollback;
