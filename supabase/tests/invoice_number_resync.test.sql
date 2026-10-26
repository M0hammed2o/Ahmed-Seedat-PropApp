-- Migration 185: rent-invoice numbering never hands out a number that already exists, even when rows were copied in
-- with explicit numbers ahead of the shared sequence (the production defect found 2026-10-26).

begin;
select plan(3);

insert into public.organizations (id, legal_name, org_type, status) values
  ('ab185000-0000-0000-0000-000000000001', 'Invoice Numbering Test Org', 'agency', 'active');
insert into public.properties (id, org_id, nickname, address_line1, city) values
  ('ab185000-0000-0000-0000-000000000002', 'ab185000-0000-0000-0000-000000000001', 'Numbering Flat', '1 Test Road', 'Durban');
insert into public.units (id, org_id, property_id, unit_label) values
  ('ab185000-0000-0000-0000-000000000003', 'ab185000-0000-0000-0000-000000000001', 'ab185000-0000-0000-0000-000000000002', 'Flat 1');
insert into public.tenants (id, org_id, full_name, status) values
  ('ab185000-0000-0000-0000-000000000004', 'ab185000-0000-0000-0000-000000000001', 'Numbering Tenant', 'active');
insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status) values
  ('ab185000-0000-0000-0000-000000000005', 'ab185000-0000-0000-0000-000000000001', 'ab185000-0000-0000-0000-000000000003', '2026-01-01', 5000, 'active');

-- Simulate copied rows: the next two numbers the sequence would generate already exist.
select set_config('pgtap.inv.next', (select last_value + 1 from public.invoice_number_seq)::text, true);
insert into public.invoices (org_id, lease_id, tenant_id, period, amount, invoice_number)
select 'ab185000-0000-0000-0000-000000000001', 'ab185000-0000-0000-0000-000000000005', 'ab185000-0000-0000-0000-000000000004',
       ('2026-0' || g || '-01')::date, 5000, 'INV-' || lpad((current_setting('pgtap.inv.next')::bigint + g - 1)::text, 6, '0')
  from generate_series(1, 2) g;

select lives_ok(
  $$insert into public.invoices (org_id, lease_id, tenant_id, period, amount)
    values ('ab185000-0000-0000-0000-000000000001', 'ab185000-0000-0000-0000-000000000005', 'ab185000-0000-0000-0000-000000000004', '2026-03-01', 5000)$$,
  'a new invoice is numbered even when the next sequence values are already taken'
);
select is(
  (select count(distinct invoice_number)::int from public.invoices where org_id = 'ab185000-0000-0000-0000-000000000001'),
  3, 'all three invoice numbers are distinct'
);
select ok(
  (select last_value from public.invoice_number_seq) >=
  (select max((regexp_match(invoice_number, '(\d+)$'))[1]::bigint) from public.invoices),
  'the sequence is at or beyond the highest invoice number in use'
);

select * from finish();
rollback;
