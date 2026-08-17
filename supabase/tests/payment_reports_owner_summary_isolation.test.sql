-- WhatsApp V1 final pre-production pass, Phase 10 (WORKLOG.md 2026-08-17). Dedicated multi-owner
-- and cross-org isolation coverage for the two tables this pass added real UI on top of --
-- payment_reports and owner_property_summaries -- that the earlier migration's own pgTAP file
-- (payment_reports_and_phone_verification.test.sql) didn't cover: a shared property must show the
-- SAME report to BOTH co-owners, an unrelated owner in the same org must see NEITHER, and
-- owner_property_summaries' manager-only staff-visibility floor must actually hold.

begin;
select plan(9);

insert into auth.users (id, email) values
  ('fb000000-0000-0000-0000-000000000001', 'fb-owner-a@test.propertyvault.example'),
  ('fb000000-0000-0000-0000-000000000002', 'fb-owner-b@test.propertyvault.example'),
  ('fb000000-0000-0000-0000-000000000003', 'fb-manager@test.propertyvault.example'),
  ('fb000000-0000-0000-0000-000000000004', 'fb-agent@test.propertyvault.example'),
  ('fb000000-0000-0000-0000-000000000005', 'fb-tenant@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values ('fb111111-0000-0000-0000-000000000001', 'FB Test Org', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('fb111111-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000003', 'manager', 'active', now()),
  ('fb111111-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000004', 'agent', 'active', now());

insert into public.owners (id, org_id, name, owner_type, status, user_id, phone)
values
  ('fb222222-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'Owner A', 'individual', 'active', 'fb000000-0000-0000-0000-000000000001', '+27821110001'),
  ('fb222222-0000-0000-0000-000000000002', 'fb111111-0000-0000-0000-000000000001', 'Owner B', 'individual', 'active', 'fb000000-0000-0000-0000-000000000002', '+27821110002');

-- Property A: Owner A only. Property B: Owner B only. Property Shared: BOTH Owner A and Owner B.
insert into public.properties (id, org_id, owner_user_id, nickname, address_line1, city, province, postal_code)
values
  ('fb333333-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', 'FB Property A', '1 A St', 'Cape Town', 'Western Cape', '8001'),
  ('fb333333-0000-0000-0000-000000000002', 'fb111111-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000002', 'FB Property B', '2 B St', 'Cape Town', 'Western Cape', '8001'),
  ('fb333333-0000-0000-0000-000000000003', 'fb111111-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', 'FB Property Shared', '3 Shared St', 'Cape Town', 'Western Cape', '8001');

insert into public.property_owners (property_id, owner_id, ownership_pct)
values
  ('fb333333-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 100),
  ('fb333333-0000-0000-0000-000000000002', 'fb222222-0000-0000-0000-000000000002', 100),
  ('fb333333-0000-0000-0000-000000000003', 'fb222222-0000-0000-0000-000000000001', 60),
  ('fb333333-0000-0000-0000-000000000003', 'fb222222-0000-0000-0000-000000000002', 40);

insert into public.units (id, property_id, org_id, unit_label)
values
  ('fb444444-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'A1'),
  ('fb444444-0000-0000-0000-000000000002', 'fb333333-0000-0000-0000-000000000002', 'fb111111-0000-0000-0000-000000000001', 'B1'),
  ('fb444444-0000-0000-0000-000000000003', 'fb333333-0000-0000-0000-000000000003', 'fb111111-0000-0000-0000-000000000001', 'S1');

insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status)
values
  ('fb555555-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb444444-0000-0000-0000-000000000001', current_date - 30, 5000, 'active'),
  ('fb555555-0000-0000-0000-000000000002', 'fb111111-0000-0000-0000-000000000001', 'fb444444-0000-0000-0000-000000000002', current_date - 30, 5000, 'active'),
  ('fb555555-0000-0000-0000-000000000003', 'fb111111-0000-0000-0000-000000000001', 'fb444444-0000-0000-0000-000000000003', current_date - 30, 5000, 'active');

insert into public.tenants (id, org_id, full_name, status, user_id)
values ('fb666666-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'FB Test Tenant', 'active', 'fb000000-0000-0000-0000-000000000005');

-- One payment_reports row per property, staff-reported (reported_by_tenant=false keeps the
-- fixture simple -- reported_by_user_id can be any real auth.users row per the FK).
insert into public.payment_reports (id, org_id, property_id, lease_id, tenant_id, reported_by_tenant, reported_by_user_id, amount, payment_method, payment_date)
values
  ('fb777777-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000001', 'fb555555-0000-0000-0000-000000000001', 'fb666666-0000-0000-0000-000000000001', false, 'fb000000-0000-0000-0000-000000000003', 1000, 'cash', current_date),
  ('fb777777-0000-0000-0000-000000000002', 'fb111111-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000002', 'fb555555-0000-0000-0000-000000000002', 'fb666666-0000-0000-0000-000000000001', false, 'fb000000-0000-0000-0000-000000000003', 2000, 'cash', current_date),
  ('fb777777-0000-0000-0000-000000000003', 'fb111111-0000-0000-0000-000000000001', 'fb333333-0000-0000-0000-000000000003', 'fb555555-0000-0000-0000-000000000003', 'fb666666-0000-0000-0000-000000000001', false, 'fb000000-0000-0000-0000-000000000003', 3000, 'cash', current_date);

insert into public.owner_property_summaries (id, org_id, owner_id, owner_user_id, period_start, period_end, property_count)
values
  ('fb888888-0000-0000-0000-000000000001', 'fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', '2026-03-01', '2026-03-31', 2),
  ('fb888888-0000-0000-0000-000000000002', 'fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000002', 'fb000000-0000-0000-0000-000000000002', '2026-03-01', '2026-03-31', 2);

-- === payment_reports: Owner A sees only their own property + the shared one, never Owner B's ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000001';

select set_eq(
  $$ select id from public.payment_reports where org_id = 'fb111111-0000-0000-0000-000000000001' $$,
  $$ values ('fb777777-0000-0000-0000-000000000001'::uuid), ('fb777777-0000-0000-0000-000000000003'::uuid) $$,
  'Owner A sees their own property''s report and the shared property''s report, never Owner B''s unrelated property'
);

reset role;

-- === payment_reports: Owner B sees only their own property + the shared one, never Owner A's ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000002';

select set_eq(
  $$ select id from public.payment_reports where org_id = 'fb111111-0000-0000-0000-000000000001' $$,
  $$ values ('fb777777-0000-0000-0000-000000000002'::uuid), ('fb777777-0000-0000-0000-000000000003'::uuid) $$,
  'Owner B sees their own property''s report and the shared property''s report, never Owner A''s unrelated property'
);

select is(
  (select count(*)::int from public.payment_reports where id = 'fb777777-0000-0000-0000-000000000003'),
  1,
  'the shared property''s report is visible to Owner B (confirms multi-owner visibility, not a fluke of Owner A''s own scoping)'
);

reset role;

-- === owner_property_summaries: strict per-owner isolation ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000001';

select set_eq(
  $$ select id from public.owner_property_summaries where org_id = 'fb111111-0000-0000-0000-000000000001' $$,
  $$ values ('fb888888-0000-0000-0000-000000000001'::uuid) $$,
  'Owner A can only see their own owner_property_summaries row, never Owner B''s'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000002';

select set_eq(
  $$ select id from public.owner_property_summaries where org_id = 'fb111111-0000-0000-0000-000000000001' $$,
  $$ values ('fb888888-0000-0000-0000-000000000002'::uuid) $$,
  'Owner B can only see their own owner_property_summaries row, never Owner A''s'
);

reset role;

-- === owner_property_summaries: manager+ staff can review both owners'' summaries in their org ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.owner_property_summaries where org_id = 'fb111111-0000-0000-0000-000000000001'),
  2,
  'a manager-role staff member sees every owner''s summary in their own org'
);

reset role;

-- === owner_property_summaries: agent (below the manager floor) staff sees none ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000004';

select is(
  (select count(*)::int from public.owner_property_summaries where org_id = 'fb111111-0000-0000-0000-000000000001'),
  0,
  'an agent-role staff member (below the manager floor) sees zero owner summaries -- the policy''s manager-only floor actually holds'
);

reset role;

-- === owner_property_summaries: no client insert policy at all (system-generated only) ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ insert into public.owner_property_summaries (org_id, owner_id, owner_user_id, period_start, period_end)
     values ('fb111111-0000-0000-0000-000000000001', 'fb222222-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', '2026-04-01', '2026-04-30') $$,
  '42501',
  null,
  'an owner cannot insert their own owner_property_summaries row directly -- only the service-role daily-jobs sweep may'
);

reset role;

-- === a tenant (no org role, no owner row) sees zero payment_reports outside their own ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000005';

select is(
  (select count(*)::int from public.owner_property_summaries where org_id = 'fb111111-0000-0000-0000-000000000001'),
  0,
  'a tenant, holding neither an org role nor an owner row, sees zero owner_property_summaries'
);

reset role;

select * from finish();
rollback;
