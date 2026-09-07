-- Tests for migration 20260101000170: a VOID expense must never count as spend, in any of the
-- three financial surfaces that read `expenses`.
--
-- Public UAT 2026-09-08 corrected the application side first (computeDashboardKpis counts every
-- NON-void expense). These functions applied no status filter at all, so a voided expense still
-- counted as money spent -- overstating operating cost, understating net position, and inflating
-- budget actuals, while diverging from the dashboard by exactly the voided amount.
--
-- Each assertion below is written as a DIFFERENCE: the same figure is read with only a void expense
-- added, and must not move. A test that merely asserted a total could pass while silently counting
-- the wrong rows.

begin;
select plan(8);

insert into auth.users (id, email) values
  ('b7000000-0000-0000-0000-000000000001', 'b7-owner@test.propertyvault.example'),
  ('b7000000-0000-0000-0000-000000000002', 'b7-outsider@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b7000000-0000-0000-0000-000000000001';
select public.create_organization('B7 Void Expense Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'B7 Void Expense Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'b7000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'B7 Void Expense Org'),
  'B7 Void Property', '1 Void St', 'Durban', 'ZA', 'house'::public.property_type
);

-- Two real expenses that MUST count: one pending (what the web form actually creates) and one
-- reimbursed (existing accounting semantics, deliberately preserved).
insert into public.expenses (org_id, property_id, category, amount, invoice_date, status)
select o.id, p.id, 'Water', 900, '2026-09-10', 'pending'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'B7 Void Property'
where o.legal_name = 'B7 Void Expense Org';
insert into public.expenses (org_id, property_id, category, amount, invoice_date, status)
select o.id, p.id, 'Levies', 1100, '2026-09-11', 'reimbursed'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'B7 Void Property'
where o.legal_name = 'B7 Void Expense Org';

-- budget_vs_actual() returns NULL actuals until a budget exists for the month, so give the
-- property one. The figure itself is irrelevant to these assertions -- only the actual matters.
select public.set_monthly_budget(
  (select id from public.organizations where legal_name = 'B7 Void Expense Org'),
  (select id from public.properties where nickname = 'B7 Void Property'),
  '2026-09-01', 30000
);

-- Baseline, before any void expense exists: 900 + 1100 = 2000.
select is(
  (select total_expenses from public.owner_financial_summary(
     (select id from public.properties where nickname = 'B7 Void Property'), '2026-09-01')),
  2000::numeric,
  'baseline: property summary counts the pending and reimbursed expenses (900 + 1100)'
);
select is(
  (select total_expenses from public.owner_portfolio_financial_summary(
     (select id from public.organizations where legal_name = 'B7 Void Expense Org'), '2026-09-01')),
  2000::numeric,
  'baseline: portfolio summary counts the pending and reimbursed expenses'
);
select is(
  (select actual_amount from public.budget_vs_actual(
     (select id from public.properties where nickname = 'B7 Void Property'), '2026-09-01')),
  2000::numeric,
  'baseline: budget actual counts the pending and reimbursed expenses'
);

-- Now add a large VOID expense in the same property and month. Nothing above may move.
insert into public.expenses (org_id, property_id, category, amount, invoice_date, status)
select o.id, p.id, 'Maintenance', 50000, '2026-09-12', 'void'
from public.organizations o join public.properties p on p.org_id = o.id and p.nickname = 'B7 Void Property'
where o.legal_name = 'B7 Void Expense Org';

select is(
  (select total_expenses from public.owner_financial_summary(
     (select id from public.properties where nickname = 'B7 Void Property'), '2026-09-01')),
  2000::numeric,
  'owner_financial_summary EXCLUDES the void expense -- a R50 000 void must not move total_expenses'
);
select is(
  (select total_expenses from public.owner_portfolio_financial_summary(
     (select id from public.organizations where legal_name = 'B7 Void Expense Org'), '2026-09-01')),
  2000::numeric,
  'owner_portfolio_financial_summary EXCLUDES the void expense'
);
select is(
  (select actual_amount from public.budget_vs_actual(
     (select id from public.properties where nickname = 'B7 Void Property'), '2026-09-01')),
  2000::numeric,
  'budget_vs_actual EXCLUDES the void expense -- a void must never inflate budget actuals'
);

-- Net operating position must likewise ignore it: with no rent collected, a counted R50 000 void
-- would have shown -52 000 instead of -2 000.
select is(
  (select net_operating_position from public.owner_portfolio_financial_summary(
     (select id from public.organizations where legal_name = 'B7 Void Expense Org'), '2026-09-01')),
  (-2000)::numeric,
  'net operating position ignores the void expense'
);

-- The authorization guard these functions carry is unchanged by migration 170.
set local "request.jwt.claim.sub" = 'b7000000-0000-0000-0000-000000000002';
select throws_ok(
  format(
    'select * from public.owner_portfolio_financial_summary(%L, %L)',
    (select id from public.organizations where legal_name = 'B7 Void Expense Org'),
    '2026-09-01'
  ),
  'Caller does not have access to this organization''s financial summary',
  'migration 170 preserves the cross-org authorization guard'
);

select * from finish();
rollback;
