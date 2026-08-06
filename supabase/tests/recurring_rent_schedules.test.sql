-- Recurring rent-schedule generation tests (TASKS.md M10, TECHNICAL_DEBT_REGISTER.md TD-20,
-- migration 20260101000050) -- generate_rent_schedules_for_lease() /
-- generate_rent_schedules_for_active_leases(). Run as service_role (the function's only grantee)
-- since these are system-job functions, not user-facing RLS paths -- org isolation here means
-- "org_id on every generated row matches the lease's own org_id", not an RLS denial test.

begin;
select plan(16);

insert into public.organizations (id, legal_name, org_type)
values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Rent Schedule Test Org A', 'agency'),
  ('c2c2c2c2-0000-0000-0000-000000000001', 'Rent Schedule Test Org B', 'agency');

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values
  ('c3c3c3c3-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'RS Test Property A', '1 Test St', 'Cape Town', 'ZA', 'apartment'),
  ('c4c4c4c4-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000001', 'RS Test Property B', '2 Test St', 'Cape Town', 'ZA', 'apartment');

insert into public.units (id, property_id, org_id, unit_label, status)
values
  ('c5c5c5c5-0000-0000-0000-000000000001', 'c3c3c3c3-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'Unit A1', 'occupied'),
  ('c6c6c6c6-0000-0000-0000-000000000001', 'c3c3c3c3-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'Unit A2', 'occupied'),
  ('c7c7c7c7-0000-0000-0000-000000000001', 'c3c3c3c3-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'Unit A3', 'occupied'),
  ('c8c8c8c8-0000-0000-0000-000000000001', 'c3c3c3c3-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'Unit A4', 'occupied'),
  ('c9c9c9c9-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000001', 'Unit B1', 'occupied');

-- Lease 1: open-ended, started 3 full months ago (day-of-month 15, safe from month-end drift) --
-- exercises "first month" (already has period 0 from a simulated approve_application() insert)
-- and "subsequent months" together.
insert into public.leases (id, org_id, unit_id, start_date, end_date, rent_amount, status, source)
values ('d1d1d1d1-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001',
        'c5c5c5c5-0000-0000-0000-000000000001', (current_date - interval '3 months')::date, null, 5000, 'active', 'manual');
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
values ('c1c1c1c1-0000-0000-0000-000000000001', 'd1d1d1d1-0000-0000-0000-000000000001',
        (current_date - interval '3 months')::date, 5000, 'pending');

-- Lease 2: ends partway through the generation horizon -- must not generate at/after end_date.
insert into public.leases (id, org_id, unit_id, start_date, end_date, rent_amount, status, source)
values ('d2d2d2d2-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001',
        'c6c6c6c6-0000-0000-0000-000000000001', (current_date - interval '2 months')::date,
        (current_date + interval '10 days')::date, 4000, 'active', 'manual');
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
values ('c1c1c1c1-0000-0000-0000-000000000001', 'd2d2d2d2-0000-0000-0000-000000000001',
        (current_date - interval '2 months')::date, 4000, 'pending');

-- Lease 3: terminated -- must never generate a new row regardless of dates.
insert into public.leases (id, org_id, unit_id, start_date, end_date, rent_amount, status, source)
values ('d3d3d3d3-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001',
        'c7c7c7c7-0000-0000-0000-000000000001', (current_date - interval '3 months')::date, null, 3000, 'terminated', 'manual');
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
values ('c1c1c1c1-0000-0000-0000-000000000001', 'd3d3d3d3-0000-0000-0000-000000000001',
        (current_date - interval '3 months')::date, 3000, 'pending');

-- Lease 4: first period already partially paid -- generator must never touch it, only add new rows.
insert into public.leases (id, org_id, unit_id, start_date, end_date, rent_amount, status, source)
values ('d4d4d4d4-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001',
        'c8c8c8c8-0000-0000-0000-000000000001', (current_date - interval '1 month')::date, null, 6000, 'active', 'manual');
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
values ('c1c1c1c1-0000-0000-0000-000000000001', 'd4d4d4d4-0000-0000-0000-000000000001',
        (current_date - interval '1 month')::date, 6000, 'partial');

-- Lease 5 (Org B): proves generation is org-scoped when run in bulk.
insert into public.leases (id, org_id, unit_id, start_date, end_date, rent_amount, status, source)
values ('d5d5d5d5-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000001',
        'c9c9c9c9-0000-0000-0000-000000000001', (current_date - interval '2 months')::date, null, 7000, 'active', 'manual');
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
values ('c2c2c2c2-0000-0000-0000-000000000001', 'd5d5d5d5-0000-0000-0000-000000000001',
        (current_date - interval '2 months')::date, 7000, 'pending');

set local role service_role;

-- === Lease 1: open-ended, 3 months of history missing, generate through "today" ===
select is(
  public.generate_rent_schedules_for_lease('d1d1d1d1-0000-0000-0000-000000000001'::uuid, current_date),
  3,
  'lease 1: generates the 3 missing periods (months 2, 3, 4) up through today'
);

select is(
  (select count(*) from public.rent_schedules where lease_id = 'd1d1d1d1-0000-0000-0000-000000000001'),
  4::bigint,
  'lease 1: now has 4 total rent_schedules rows (1 original + 3 generated)'
);

-- Idempotency / retry-safety: running it again produces zero new rows, no duplicates.
select is(
  public.generate_rent_schedules_for_lease('d1d1d1d1-0000-0000-0000-000000000001'::uuid, current_date),
  0,
  'lease 1: re-running the generator for the same horizon creates zero new rows (idempotent)'
);

select is(
  (select count(*) from public.rent_schedules where lease_id = 'd1d1d1d1-0000-0000-0000-000000000001'),
  4::bigint,
  'lease 1: row count unchanged after re-running (no duplicates from retry)'
);

select is(
  (select count(distinct due_date) from public.rent_schedules where lease_id = 'd1d1d1d1-0000-0000-0000-000000000001'),
  4::bigint,
  'lease 1: every generated due_date is distinct (unique constraint holds)'
);

-- === Lease 2: ends mid-horizon -- must stop strictly before end_date ===
select generate_rent_schedules_for_lease('d2d2d2d2-0000-0000-0000-000000000001'::uuid, (current_date + interval '2 months')::date);

select is(
  (select count(*) from public.rent_schedules
   where lease_id = 'd2d2d2d2-0000-0000-0000-000000000001' and due_date >= (select end_date from public.leases where id = 'd2d2d2d2-0000-0000-0000-000000000001')),
  0::bigint,
  'lease 2: no rent_schedules row generated at or after the lease end_date'
);

select ok(
  (select count(*) from public.rent_schedules where lease_id = 'd2d2d2d2-0000-0000-0000-000000000001') >= 1,
  'lease 2: at least the pre-existing period remains (ended lease keeps its history)'
);

-- === Lease 3: terminated -- generator is a no-op ===
select is(
  public.generate_rent_schedules_for_lease('d3d3d3d3-0000-0000-0000-000000000001'::uuid, (current_date + interval '2 months')::date),
  0,
  'lease 3: terminated lease generates zero new rows'
);

select is(
  (select count(*) from public.rent_schedules where lease_id = 'd3d3d3d3-0000-0000-0000-000000000001'),
  1::bigint,
  'lease 3: terminated lease still has only its original 1 row'
);

-- === Lease 4: partially paid first period is preserved untouched, new rows still generate ===
select generate_rent_schedules_for_lease('d4d4d4d4-0000-0000-0000-000000000001'::uuid, current_date);

select is(
  (select status from public.rent_schedules where lease_id = 'd4d4d4d4-0000-0000-0000-000000000001'
     and due_date = (current_date - interval '1 month')::date),
  'partial',
  'lease 4: the pre-existing partially-paid row keeps its status untouched'
);

select ok(
  (select count(*) from public.rent_schedules where lease_id = 'd4d4d4d4-0000-0000-0000-000000000001') > 1,
  'lease 4: a new pending row was generated alongside the preserved partial row'
);

-- === Bulk generator: org isolation and full-portfolio sweep ===
select public.generate_rent_schedules_for_active_leases(current_date);

select ok(
  (select count(*) from public.rent_schedules where lease_id = 'd5d5d5d5-0000-0000-0000-000000000001') > 1,
  'bulk generator: Org B''s active lease also received new generated rows'
);

select is(
  (select count(*) from public.rent_schedules rs
     join public.leases l on l.id = rs.lease_id
     where rs.lease_id = 'd5d5d5d5-0000-0000-0000-000000000001' and rs.org_id <> l.org_id),
  0::bigint,
  'bulk generator: every generated row''s org_id matches its own lease''s org_id (no cross-org leakage)'
);

select is(
  (select count(*) from public.rent_schedules where lease_id = 'd3d3d3d3-0000-0000-0000-000000000001'),
  1::bigint,
  'bulk generator: terminated lease still untouched by the full-portfolio sweep'
);

-- === Privilege lockdown: EXECUTE is denied to normal authenticated/anon roles ===
set local role authenticated;

select throws_ok(
  $$ select public.generate_rent_schedules_for_lease('d1d1d1d1-0000-0000-0000-000000000001'::uuid) $$,
  '42501',
  null,
  'authenticated role cannot call generate_rent_schedules_for_lease() directly (service_role only)'
);

select throws_ok(
  $$ select public.generate_rent_schedules_for_active_leases() $$,
  '42501',
  null,
  'authenticated role cannot call generate_rent_schedules_for_active_leases() directly (service_role only)'
);

select * from finish();
rollback;
