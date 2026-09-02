-- Tests for migration 20260101000164 (V1 property budgeting pass): property_budgets,
-- budget_category_lines, set_monthly_budget, distribute_annual_budget, budget_vs_actual.

begin;
select plan(15);

insert into auth.users (id, email) values
  ('d5000000-0000-0000-0000-000000000001', 'd5-accountant@test.propertyvault.example'),
  ('d5000000-0000-0000-0000-000000000002', 'd5-tenant-user@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values ('d5111111-0000-0000-0000-000000000001', 'D5 Test Org', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('d5111111-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'accountant', 'active', now());

insert into public.properties (id, org_id, owner_user_id, nickname, address_line1, city, province, postal_code)
values ('d5222222-0000-0000-0000-000000000001', 'd5111111-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'D5 Test Property', '1 Test St', 'Cape Town', 'Western Cape', '8001');

insert into public.tenants (id, org_id, full_name, status, user_id)
values ('d5555555-0000-0000-0000-000000000001', 'd5111111-0000-0000-0000-000000000001', 'D5 Test Tenant', 'active', 'd5000000-0000-0000-0000-000000000002');

-- === set_monthly_budget: scenario 7 (R25,000 monthly budget) ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'd5000000-0000-0000-0000-000000000001'; -- accountant

select isnt(
  public.set_monthly_budget('d5111111-0000-0000-0000-000000000001', 'd5222222-0000-0000-0000-000000000001', '2026-09-01', 25000),
  null,
  'accountant can set a September monthly budget of R25,000'
);

select is(
  (select planned_amount from public.property_budgets where property_id = 'd5222222-0000-0000-0000-000000000001' and month = '2026-09-01'),
  25000::numeric,
  'the stored planned amount is 25000'
);

-- Upsert -- setting again for the same month updates, never duplicates.
select isnt(
  public.set_monthly_budget('d5111111-0000-0000-0000-000000000001', 'd5222222-0000-0000-0000-000000000001', '2026-09-01', 26000),
  null,
  'setting the same property+month again upserts rather than erroring'
);

select is(
  (select count(*) from public.property_budgets where property_id = 'd5222222-0000-0000-0000-000000000001' and month = '2026-09-01'),
  1::bigint,
  'still exactly one row for September -- no duplicate'
);

select is(
  (select planned_amount from public.property_budgets where property_id = 'd5222222-0000-0000-0000-000000000001' and month = '2026-09-01'),
  26000::numeric,
  'the planned amount is updated to 26000'
);

-- Reset to 25000 for the budget-vs-actual scenario below.
select public.set_monthly_budget('d5111111-0000-0000-0000-000000000001', 'd5222222-0000-0000-0000-000000000001', '2026-09-01', 25000);

-- === distribute_annual_budget ===
select is(
  (select count(*) from public.distribute_annual_budget('d5111111-0000-0000-0000-000000000001', 'd5222222-0000-0000-0000-000000000001', 2027, 300000)),
  12::bigint,
  'distribute_annual_budget creates exactly 12 monthly rows'
);

select is(
  (select sum(planned_amount) from public.property_budgets where property_id = 'd5222222-0000-0000-0000-000000000001' and month >= '2027-01-01' and month < '2028-01-01'),
  300000::numeric,
  'the 12 distributed monthly rows sum exactly to the annual total (remainder folded into December)'
);

select is(
  (select planned_amount from public.property_budgets where property_id = 'd5222222-0000-0000-0000-000000000001' and month = '2027-06-01'),
  (select planned_amount from public.property_budgets where property_id = 'd5222222-0000-0000-0000-000000000001' and month = '2027-07-01'),
  'non-December distributed months are equal to each other'
);

-- === budget_category_lines ===
insert into public.budget_category_lines (budget_id, org_id, category, planned_amount)
select id, 'd5111111-0000-0000-0000-000000000001', 'water', 2400
from public.property_budgets where property_id = 'd5222222-0000-0000-0000-000000000001' and month = '2026-09-01';

select is(
  (select count(*) from public.budget_category_lines bl join public.property_budgets pb on pb.id = bl.budget_id where pb.property_id = 'd5222222-0000-0000-0000-000000000001'),
  1::bigint,
  'a category budget line can be attached to a monthly budget'
);

-- === budget_vs_actual: scenario 7 (R25,000 budget, R16,800 actual, 67.2% used) ===
insert into public.expenses (org_id, property_id, category, amount, invoice_date)
values
  ('d5111111-0000-0000-0000-000000000001', 'd5222222-0000-0000-0000-000000000001', 'Water', 2400, '2026-09-05'),
  ('d5111111-0000-0000-0000-000000000001', 'd5222222-0000-0000-0000-000000000001', 'Maintenance', 14400, '2026-09-15');

select is(
  (select actual_amount from public.budget_vs_actual('d5222222-0000-0000-0000-000000000001', '2026-09-01')),
  16800::numeric,
  'actual is summed from expenses only (2400 + 14400 = 16800) -- scenario 7'
);

select is(
  (select remaining_amount from public.budget_vs_actual('d5222222-0000-0000-0000-000000000001', '2026-09-01')),
  8200::numeric,
  'remaining budget is 25000 - 16800 = 8200'
);

select is(
  (select percent_used from public.budget_vs_actual('d5222222-0000-0000-0000-000000000001', '2026-09-01')),
  67.2::numeric,
  'percent used is 67.2%'
);

-- An expense outside the queried month must not be counted.
insert into public.expenses (org_id, property_id, category, amount, invoice_date)
values ('d5111111-0000-0000-0000-000000000001', 'd5222222-0000-0000-0000-000000000001', 'Water', 500, '2026-08-31');

select is(
  (select actual_amount from public.budget_vs_actual('d5222222-0000-0000-0000-000000000001', '2026-09-01')),
  16800::numeric,
  'an August expense does not bleed into September''s actual total'
);

reset role;

-- === tenant denial (scenario 12/13: tenant attempts owner-budget access) ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'd5000000-0000-0000-0000-000000000002'; -- tenant, no org membership

select is(
  (select count(*) from public.property_budgets where property_id = 'd5222222-0000-0000-0000-000000000001'),
  0::bigint,
  'a tenant (no org membership) cannot see any property_budgets rows -- owner-budget access denied'
);

select throws_ok(
  $$ select public.set_monthly_budget('d5111111-0000-0000-0000-000000000001', 'd5222222-0000-0000-0000-000000000001', '2026-10-01', 10000) $$,
  null, null,
  'a tenant cannot set a property budget'
);

reset role;

select * from finish();
rollback;
