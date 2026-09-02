-- Tests for migration 20260101000166: owner_financial_summary() and the budget_vs_actual()
-- authorization fix (both are SECURITY DEFINER and must not be callable cross-org).

begin;
select plan(9);

insert into auth.users (id, email) values
  ('a5000000-0000-0000-0000-000000000001', 'a5-accountant@test.propertyvault.example'),
  ('a5000000-0000-0000-0000-000000000002', 'a5-other-org@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'a5000000-0000-0000-0000-000000000001';
select public.create_organization('A5 Summary Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'A5 Summary Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'a5000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'A5 Summary Test Org'),
  'A5 Summary Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'A5 Unit', 'occupied' from public.properties p where p.nickname = 'A5 Summary Property';
insert into public.tenants (org_id, full_name, status)
select id, 'A5 Tenant', 'active' from public.organizations where legal_name = 'A5 Summary Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 10000, 10000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'A5 Unit'
where o.legal_name = 'A5 Summary Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'A5 Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'A5 Summary Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'A5 Tenant';
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, '2026-09-01', 10000, 'pending'
from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'A5 Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'A5 Summary Test Org';
select public.invoice_rent_schedule((select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A5 Unit'));
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.leases l on l.id = i.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'A5 Unit'),
  4000, '2026-09-05', 'eft', 'partial payment', null
);

insert into public.expenses (org_id, property_id, category, amount, invoice_date)
select o.id, p.id, 'Water', 800, '2026-09-10'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'A5 Summary Property'
where o.legal_name = 'A5 Summary Test Org';
insert into public.expenses (org_id, property_id, category, amount, invoice_date)
select o.id, p.id, 'Levies', 1200, '2026-09-11'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'A5 Summary Property'
where o.legal_name = 'A5 Summary Test Org';
insert into public.expenses (org_id, property_id, category, amount, invoice_date)
select o.id, p.id, 'Garden service', 500, '2026-09-12'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'A5 Summary Property'
where o.legal_name = 'A5 Summary Test Org';

select is(
  (select rent_planned from public.owner_financial_summary((select id from public.properties where nickname = 'A5 Summary Property'), '2026-09-01')),
  10000::numeric,
  'rent_planned is the September rent_schedules total (R10,000)'
);

select is(
  (select rent_collected from public.owner_financial_summary((select id from public.properties where nickname = 'A5 Summary Property'), '2026-09-01')),
  4000::numeric,
  'rent_collected is the real invoice_payments total (R4,000 partial payment)'
);

select is(
  (select rent_outstanding from public.owner_financial_summary((select id from public.properties where nickname = 'A5 Summary Property'), '2026-09-01')),
  6000::numeric,
  'rent_outstanding is planned - collected = R6,000'
);

select is(
  (select utilities_expense from public.owner_financial_summary((select id from public.properties where nickname = 'A5 Summary Property'), '2026-09-01')),
  800::numeric,
  'utilities_expense matches the Water-categorised expense'
);

select is(
  (select rates_and_levies_expense from public.owner_financial_summary((select id from public.properties where nickname = 'A5 Summary Property'), '2026-09-01')),
  1200::numeric,
  'rates_and_levies_expense matches the Levies-categorised expense'
);

select is(
  (select other_expenses from public.owner_financial_summary((select id from public.properties where nickname = 'A5 Summary Property'), '2026-09-01')),
  500::numeric,
  'other_expenses matches the unrecognised-category expense (garden service)'
);

select is(
  (select total_expenses from public.owner_financial_summary((select id from public.properties where nickname = 'A5 Summary Property'), '2026-09-01')),
  2500::numeric,
  'total_expenses is the sum of all three (800 + 1200 + 500 = 2500)'
);

reset role;

-- === cross-org authorization: neither function is callable for another org's property ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'a5000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select * from public.owner_financial_summary((select id from public.properties where nickname = 'A5 Summary Property'), '2026-09-01') $$,
  null, null,
  'owner_financial_summary is refused for a caller with no access to this organization (SECURITY DEFINER auth fix)'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a5000000-0000-0000-0000-000000000001';
select public.set_monthly_budget(
  (select id from public.organizations where legal_name = 'A5 Summary Test Org'),
  (select id from public.properties where nickname = 'A5 Summary Property'),
  '2026-09-01', 5000
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'a5000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select * from public.budget_vs_actual((select id from public.properties where nickname = 'A5 Summary Property'), '2026-09-01') $$,
  null, null,
  'budget_vs_actual is refused for a caller with no access to this organization (SECURITY DEFINER auth fix)'
);

reset role;

select * from finish();
rollback;
