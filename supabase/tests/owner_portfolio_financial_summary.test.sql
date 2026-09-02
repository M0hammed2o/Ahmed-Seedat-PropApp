-- Tests for migration 20260101000167: owner_portfolio_financial_summary() -- portfolio-wide (not
-- property-scoped), live (never cached), with cross-org authorization.

begin;
select plan(11);

insert into auth.users (id, email) values
  ('b5000000-0000-0000-0000-000000000001', 'b5-accountant@test.propertyvault.example'),
  ('b5000000-0000-0000-0000-000000000002', 'b5-other-org@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select public.create_organization('B5 Portfolio Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';

-- Two properties in the same org -- proves this is a PORTFOLIO sum, not one property's figures.
select public.create_property(
  (select id from public.organizations where legal_name = 'B5 Portfolio Test Org'),
  'B5 Property One', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
select public.create_property(
  (select id from public.organizations where legal_name = 'B5 Portfolio Test Org'),
  'B5 Property Two', '2 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Unit A', 'occupied' from public.properties p where p.nickname = 'B5 Property One';
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Unit B', 'occupied' from public.properties p where p.nickname = 'B5 Property Two';

insert into public.tenants (org_id, full_name, status)
select id, 'B5 Tenant One', 'active' from public.organizations where legal_name = 'B5 Portfolio Test Org';
insert into public.tenants (org_id, full_name, status)
select id, 'B5 Tenant Two', 'active' from public.organizations where legal_name = 'B5 Portfolio Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 8000, 8000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'Unit A'
where o.legal_name = 'B5 Portfolio Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 6000, 6000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'Unit B'
where o.legal_name = 'B5 Portfolio Test Org';

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'Unit A'
join public.organizations o on o.id = l.org_id join public.tenants t on t.org_id = o.id and t.full_name = 'B5 Tenant One'
where o.legal_name = 'B5 Portfolio Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'Unit B'
join public.organizations o on o.id = l.org_id join public.tenants t on t.org_id = o.id and t.full_name = 'B5 Tenant Two'
where o.legal_name = 'B5 Portfolio Test Org';

insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, '2026-09-01', 8000, 'pending'
from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'Unit A'
join public.organizations o on o.id = l.org_id where o.legal_name = 'B5 Portfolio Test Org';
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, '2026-09-01', 6000, 'pending'
from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'Unit B'
join public.organizations o on o.id = l.org_id where o.legal_name = 'B5 Portfolio Test Org';

-- Only Property One's rent gets paid this month.
select public.invoice_rent_schedule((select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'Unit A'));
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'Unit A'),
  8000, '2026-09-05', 'eft', null, null, null
);

-- Expenses on BOTH properties -- proves the sum spans the whole portfolio.
insert into public.expenses (org_id, property_id, category, amount, invoice_date)
select o.id, p.id, 'Water', 500, '2026-09-10' from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'B5 Property One' where o.legal_name = 'B5 Portfolio Test Org';
insert into public.expenses (org_id, property_id, category, amount, invoice_date)
select o.id, p.id, 'Levies', 700, '2026-09-11' from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'B5 Property Two' where o.legal_name = 'B5 Portfolio Test Org';

select is(
  (select rent_planned from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01')),
  14000::numeric,
  'rent_planned is the SUM across both properties (8000 + 6000), not one property''s figure'
);

select is(
  (select rent_collected from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01')),
  8000::numeric,
  'rent_collected is only Property One''s real payment -- Property Two remains unpaid'
);

select is(
  (select rent_outstanding from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01')),
  6000::numeric,
  'rent_outstanding is 14000 - 8000 = 6000'
);

select is(
  (select utilities_expense from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01')),
  500::numeric,
  'utilities_expense sums across both properties (only Property One had a Water expense)'
);

select is(
  (select rates_and_levies_expense from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01')),
  700::numeric,
  'rates_and_levies_expense sums across both properties (only Property Two had a Levies expense)'
);

select is(
  (select total_expenses from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01')),
  1200::numeric,
  'total_expenses is the portfolio-wide sum (500 + 700 = 1200)'
);

select is(
  (select property_count from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01')),
  2,
  'property_count reflects both properties in the org'
);

-- Budget only set on Property One -- proves budget aggregation only includes properties that have one.
select public.set_monthly_budget(
  (select id from public.organizations where legal_name = 'B5 Portfolio Test Org'),
  (select id from public.properties where nickname = 'B5 Property One'),
  '2026-09-01', 2000
);

select is(
  (select budget_planned from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01')),
  2000::numeric,
  'budget_planned only includes the one property with a budget set (Property Two contributes nothing)'
);

select is(
  (select net_operating_position from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01')),
  6800::numeric,
  'net_operating_position is rent collected (8000) minus total expenses (1200) = 6800 -- never labelled profit'
);

reset role;

-- === cross-org authorization ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select * from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Portfolio Test Org'), '2026-09-01') $$,
  null, null,
  'a caller with no access to this org cannot call owner_portfolio_financial_summary'
);

reset role;

-- === an org with zero properties returns zeros, not an error ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select public.create_organization('B5 Empty Org', 'agency');
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select is(
  (select property_count from public.owner_portfolio_financial_summary((select id from public.organizations where legal_name = 'B5 Empty Org'), '2026-09-01')),
  0,
  'an org with zero properties returns property_count = 0, not an error'
);
reset role;

select * from finish();
rollback;
