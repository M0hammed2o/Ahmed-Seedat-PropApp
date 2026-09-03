-- Tests for migration 20260101000168: expenses.category_code -- the canonical financial
-- classification owner_financial_summary()/owner_portfolio_financial_summary() bucket expenses by,
-- entirely independent of the free-text category/notes fields (web financials V1 pass, part 2,
-- WORKLOG.md this date). Proves the exact scenarios the task asked for: rates vs levies split,
-- water vs electricity split, a free-text description that doesn't change the canonical
-- classification, and OTHER never accidentally becoming a specific category because of wording.

begin;
select plan(13);

insert into auth.users (id, email) values
  ('c6000000-0000-0000-0000-000000000001', 'c6-accountant@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000001';
select public.create_organization('C6 Category Code Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'C6 Category Code Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'C6 Category Code Test Org'),
  'C6 Category Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);

-- === Test A: rates & taxes vs levies are split, not combined ===
insert into public.expenses (org_id, property_id, category, category_code, amount, invoice_date)
select o.id, p.id, 'Rates & taxes', 'rates_taxes', 1500, '2026-09-05'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'C6 Category Property'
where o.legal_name = 'C6 Category Code Test Org';
insert into public.expenses (org_id, property_id, category, category_code, amount, invoice_date)
select o.id, p.id, 'Levies', 'levies', 2200, '2026-09-06'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'C6 Category Property'
where o.legal_name = 'C6 Category Code Test Org';

select is(
  (select rates_taxes_expense from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  1500::numeric, 'Test A: rates_taxes_expense = 1500'
);
select is(
  (select levies_expense from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  2200::numeric, 'Test A: levies_expense = 2200'
);
select is(
  (select rates_and_levies_expense from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  3700::numeric, 'Test A: rates_and_levies_expense (backward-compat combined) = 1500 + 2200 = 3700'
);

-- === Test B: water vs electricity are split, and sum into utilities_expense ===
insert into public.expenses (org_id, property_id, category, category_code, amount, invoice_date)
select o.id, p.id, 'Water', 'water', 2400, '2026-09-07'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'C6 Category Property'
where o.legal_name = 'C6 Category Code Test Org';
insert into public.expenses (org_id, property_id, category, category_code, amount, invoice_date)
select o.id, p.id, 'Electricity', 'electricity', 1100, '2026-09-08'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'C6 Category Property'
where o.legal_name = 'C6 Category Code Test Org';

select is(
  (select utilities_expense from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  3500::numeric, 'Test B: utilities_expense = water + electricity = 3500'
);
select is(
  (select water_expense from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  2400::numeric, 'Test B: water_expense = 2400'
);
select is(
  (select electricity_expense from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  1100::numeric, 'Test B: electricity_expense = 1100'
);

-- === Test C: a free-text description unrelated to "rates" still counts as rates when
-- category_code says so -- classification is driven by category_code alone, never by parsing the
-- human-readable text. ===
insert into public.expenses (org_id, property_id, category, category_code, amount, invoice_date, notes)
select o.id, p.id, 'eThekwini Municipality September account', 'rates_taxes', 900, '2026-09-09',
  'Paid via EFT, ref 88213'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'C6 Category Property'
where o.legal_name = 'C6 Category Code Test Org';

select is(
  (select rates_taxes_expense from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  2400::numeric, -- 1500 (Test A) + 900 (this row)
  'Test C: an expense described as "eThekwini Municipality September account" still counts as rates because category_code = rates_taxes, regardless of its free-text description'
);

-- === Test D: OTHER never becomes utilities/rates/levies just because notes/category mention
-- those words -- proves bucketing reads category_code exclusively, never string-matches
-- category/notes. ===
insert into public.expenses (org_id, property_id, category, category_code, amount, invoice_date, notes)
select o.id, p.id, 'Electricity board dispute settlement', 'other', 600, '2026-09-10',
  'Legal settlement referencing water and rates disputes -- not an actual utility or rates cost'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'C6 Category Property'
where o.legal_name = 'C6 Category Code Test Org';

select is(
  (select other_expenses from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  600::numeric, 'Test D: the settlement expense lands in other_expenses'
);
select is(
  (select utilities_expense from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  3500::numeric, 'Test D: utilities_expense is unaffected by "Electricity"/"water" appearing in category/notes text (still 3500 from Test B)'
);
select is(
  (select rates_and_levies_expense from public.owner_financial_summary((select id from public.properties where nickname = 'C6 Category Property'), '2026-09-01')),
  4600::numeric, 'Test D: rates_and_levies_expense is unaffected by "rates" appearing in notes text (still 2400 rates_taxes + 2200 levies = 4600 from Tests A/C, unchanged by this OTHER-classified expense)'
);

-- === Backward compatibility: a caller that only sets category (never category_code) -- e.g. an
-- older code path, or these very fixtures elsewhere in this test suite -- still gets a sensible
-- classification via the inference trigger, and an explicitly-set category_code is never silently
-- re-inferred/overwritten. ===
insert into public.expenses (org_id, property_id, category, amount, invoice_date)
select o.id, p.id, 'Security', 450, '2026-09-11'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'C6 Category Property'
where o.legal_name = 'C6 Category Code Test Org';

select is(
  (select category_code from public.expenses where category = 'Security' and property_id = (select id from public.properties where nickname = 'C6 Category Property'))::text,
  'security',
  'Backward compat: inserting only category=''Security'' (no category_code) infers category_code=''security'' via the trigger'
);

update public.expenses set notes = 'irrelevant edit'
where category = 'eThekwini Municipality September account'
  and property_id = (select id from public.properties where nickname = 'C6 Category Property');

select is(
  (select category_code from public.expenses where category = 'eThekwini Municipality September account' and property_id = (select id from public.properties where nickname = 'C6 Category Property'))::text,
  'rates_taxes',
  'An explicitly-set category_code survives an unrelated UPDATE (e.g. editing notes) -- never silently re-inferred from category text'
);

-- === DB-level enum enforcement: an unrecognised category_code is rejected, not silently accepted ===
select throws_ok(
  $$ insert into public.expenses (org_id, property_id, category, category_code, amount, invoice_date)
     select o.id, p.id, 'Bogus', 'not_a_real_category', 100, '2026-09-12'
     from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'C6 Category Property'
     where o.legal_name = 'C6 Category Code Test Org' $$,
  null, null,
  'An unrecognised category_code value is rejected by the enum type itself'
);

reset role;

select * from finish();
rollback;
