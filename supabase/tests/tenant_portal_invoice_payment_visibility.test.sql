-- Tenant-portal release-gate pass (WORKLOG.md this date), Part H: proves invoice_payments_select_
-- tenant_self (migration 20260101000161) actually lets the tenant see the SAME figures the
-- landlord side computes -- "the landlord portal and tenant portal must agree exactly" -- through
-- the exact mandated scenario (R20,000 invoice, R15,000 paid, R5,000 more, reverse R5,000), and
-- that a same-org co-tenant / different-org tenant sees none of it.

begin;
select plan(12);

insert into auth.users (id, email) values
  ('e8000000-0000-0000-0000-000000000001', 'tpv-accountant@test.propertyvault.example'),
  ('e8000000-0000-0000-0000-000000000002', 'tpv-tenant-a-user@test.propertyvault.example'),
  ('e8000000-0000-0000-0000-000000000003', 'tpv-tenant-b-user@test.propertyvault.example'),
  ('e8000000-0000-0000-0000-000000000004', 'tpv-tenant-orgc-user@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000001';
select public.create_organization('TPV Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'TPV Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000001';
select public.create_property(
  (select id from public.organizations where legal_name = 'TPV Test Org'),
  'TPV Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'TPV Unit A', 'occupied' from public.properties p where p.nickname = 'TPV Property';
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'TPV Unit B', 'occupied' from public.properties p where p.nickname = 'TPV Property';

-- Tenant A -- the one whose R20,000 invoice we walk through the mandated scenario.
insert into public.tenants (org_id, user_id, full_name, status)
select id, 'e8000000-0000-0000-0000-000000000002', 'TPV Tenant A', 'active' from public.organizations where legal_name = 'TPV Test Org';
-- Tenant B -- same org, different tenancy (co-tenant isolation).
insert into public.tenants (org_id, user_id, full_name, status)
select id, 'e8000000-0000-0000-0000-000000000003', 'TPV Tenant B', 'active' from public.organizations where legal_name = 'TPV Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 20000, 20000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'TPV Unit A'
where o.legal_name = 'TPV Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 6000, 6000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'TPV Unit B'
where o.legal_name = 'TPV Test Org';

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'TPV Unit A'
join public.organizations o on o.id = l.org_id and o.legal_name = 'TPV Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'TPV Tenant A';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'TPV Unit B'
join public.organizations o on o.id = l.org_id and o.legal_name = 'TPV Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'TPV Tenant B';

-- A second org + tenant, for the cross-org negative test.
select public.create_organization('TPV Other Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'TPV Other Org'));
insert into public.tenants (org_id, user_id, full_name, status)
select id, 'e8000000-0000-0000-0000-000000000004', 'TPV Org C Tenant', 'active' from public.organizations where legal_name = 'TPV Other Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000001';

-- Tenant A's R20,000 manual invoice, issued.
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'TPV Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'TPV Unit A'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'TPV Test Org' and t.full_name = 'TPV Tenant A'),
  current_date, current_date + 7, 'TPV-REF', 'TPV invoice', null,
  '[{"description":"Rent", "quantity":1, "unitPrice":20000}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'TPV Test Org' and i.description = 'TPV invoice')
);

-- pg_temp helper: sums exactly what a tenant's own RLS-scoped session can see for Tenant A's
-- invoice -- the same formula loadInvoicesWithBalances() uses, proven here against a REAL
-- caller-scoped read, not a service-role bypass.
create or replace function pg_temp.tpv_paid_visible_to_caller() returns numeric as $$
  select coalesce(sum(ip.amount), 0) from public.invoice_payments ip
  join public.invoices i on i.id = ip.invoice_id
  where i.description = 'TPV invoice' and ip.reversed_at is null;
$$ language sql;

-- Record R15,000.
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'TPV Test Org' and i.description = 'TPV invoice'),
  15000, current_date, 'eft', 'TPV-PAY-1', 'First payment'
);

-- Switch to Tenant A's own session -- everything from here reads through THEIR RLS, not staff.
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000002';

select is(pg_temp.tpv_paid_visible_to_caller(), 15000::numeric, 'Tenant A (own RLS session) sees exactly R15,000 paid after the first payment -- matches the landlord figure exactly');

set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000001';
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'TPV Test Org' and i.description = 'TPV invoice'),
  5000, current_date, 'eft', 'TPV-PAY-2', 'Final payment'
);
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000002';

select is(pg_temp.tpv_paid_visible_to_caller(), 20000::numeric, 'Tenant A sees exactly R20,000 paid after the second payment -- fully paid, matches the landlord figure');

set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000001';
select public.reverse_invoice_payment(
  (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.description = 'TPV invoice' and ip.reference = 'TPV-PAY-2'),
  'Bounced EFT'
);
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000002';

select is(pg_temp.tpv_paid_visible_to_caller(), 15000::numeric, 'Tenant A sees exactly R15,000 paid after the reversal -- back down, matches the landlord figure');

-- The reversed payment itself remains historically VISIBLE to the tenant (not hidden), correctly
-- flagged as reversed.
select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.description = 'TPV invoice'),
  2::bigint,
  'Tenant A sees BOTH invoice_payments rows -- the reversed one remains historically visible, never hidden'
);
select is(
  (select ip.reversed_at is not null from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.description = 'TPV invoice' and ip.reference = 'TPV-PAY-2'),
  true,
  'Tenant A can see that the second payment is marked reversed'
);

-- Tenant B (same org, different tenancy) sees NONE of Tenant A's payments.
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000003';
select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.description = 'TPV invoice'),
  0::bigint,
  'Tenant B (same org, co-tenant) sees ZERO of Tenant A''s invoice_payments rows'
);
select is(
  (select count(*) from public.invoices where description = 'TPV invoice'),
  0::bigint,
  'Tenant B cannot even see Tenant A''s invoice row'
);

-- A tenant in an entirely different org sees none of it either.
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000004';
select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.description = 'TPV invoice'),
  0::bigint,
  'A tenant in a completely different org sees ZERO of Tenant A''s invoice_payments rows'
);

-- Back to Tenant A -- sanity check the final invoice-level balance one more time, computed the
-- exact same way loadInvoicesWithBalances() computes it (amount - sum(non-reversed payments)).
set local "request.jwt.claim.sub" = 'e8000000-0000-0000-0000-000000000002';
select is(
  (select i.amount - coalesce((select sum(ip.amount) from public.invoice_payments ip where ip.invoice_id = i.id and ip.reversed_at is null), 0)
     from public.invoices i where i.description = 'TPV invoice'),
  5000::numeric,
  'Tenant A''s own final balance is exactly R5,000, computed the same formula the landlord side uses'
);

-- And Tenant A can see their own invoice row itself (positive control -- own data still works).
select is(
  (select count(*) from public.invoices where description = 'TPV invoice'),
  1::bigint,
  'Tenant A can see their own invoice row'
);
select is(
  (select status from public.invoices where description = 'TPV invoice'),
  'issued'::public.invoice_status,
  'Tenant A sees the correct invoice status'
);
select is(
  (select count(*) from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.description = 'TPV invoice' and ip.reversed_at is null),
  1::bigint,
  'Tenant A sees exactly one ACTIVE (non-reversed) payment row for their own invoice'
);

select * from finish();
rollback;
