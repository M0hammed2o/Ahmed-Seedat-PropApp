-- MANDATORY tenant-balance test (P0 correction pass, WORKLOG.md this date): proves the tenant
-- Balance figure -- sum of (invoice.amount - non-reversed invoice_payments) across every non-void
-- invoice -- walks through the exact approved scenario step by step. This is precisely what
-- lib/invoicing.ts's loadInvoicesWithBalances() computes per invoice and the tenant detail page
-- sums across invoices (apps/admin/app/(dashboard)/tenants/[id]/page.tsx:
-- `invoices.reduce((sum, inv) => sum + inv.balance, 0)`) -- verified here at the DB level, which is
-- the actual source of truth that TypeScript function reads.

begin;
select plan(7);

insert into auth.users (id, email) values
  ('e6000000-0000-0000-0000-000000000001', 'tenant-balance-accountant@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'e6000000-0000-0000-0000-000000000001';
select public.create_organization('Tenant Balance Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Tenant Balance Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'e6000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'Tenant Balance Test Org'),
  'Tenant Balance Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'TB Unit', 'occupied' from public.properties p where p.nickname = 'Tenant Balance Property';
insert into public.tenants (org_id, full_name, status)
select id, 'TB Tenant', 'active' from public.organizations where legal_name = 'Tenant Balance Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 20000, 20000, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'TB Unit'
where o.legal_name = 'Tenant Balance Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'TB Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Tenant Balance Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'TB Tenant';
insert into public.bank_accounts (org_id, account_class, bank_name)
select id, 'business', 'TB Bank' from public.organizations where legal_name = 'Tenant Balance Test Org';

-- The rent invoice (R20,000) and the manual invoice (R2,000).
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, current_date, 20000, 'pending'
from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'TB Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'Tenant Balance Test Org';
select public.invoice_rent_schedule(
  (select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'TB Unit')
);
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Tenant Balance Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'TB Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Tenant Balance Test Org'),
  current_date, current_date + 7, 'TB-REF-1', 'TB Manual invoice', null,
  '[{"description":"Parking","quantity":1,"unitPrice":2000}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Tenant Balance Test Org' and i.description = 'TB Manual invoice')
);

-- Tenant balance = sum(invoice.amount - paid) across every non-void invoice for this tenant.
-- (mirrors loadInvoicesWithBalances()'s per-invoice balance, summed exactly as the tenant page does)
create or replace function pg_temp.tb_balance() returns numeric as $$
  select coalesce(sum(
    case when i.voided_at is not null then 0
    else greatest(0, i.amount - coalesce((select sum(ip.amount) from public.invoice_payments ip where ip.invoice_id = i.id and ip.reversed_at is null), 0))
    end
  ), 0)
  from public.invoices i
  join public.tenants t on t.id = i.tenant_id
  where t.full_name = 'TB Tenant';
$$ language sql;

select is(pg_temp.tb_balance(), 22000::numeric, 'Initial tenant balance is R22,000 (R20,000 rent + R2,000 manual)');

-- Record R15,000 against rent.
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Tenant Balance Test Org' and i.source = 'rent_schedule'),
  15000, current_date, 'eft', 'TB-RENT-1', 'First rent payment'
);
select is(pg_temp.tb_balance(), 7000::numeric, 'After R15,000 against rent: balance is R7,000 (R5,000 rent + R2,000 manual)');

-- Record R2,000 against the manual invoice (pays it off completely).
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Tenant Balance Test Org' and i.description = 'TB Manual invoice'),
  2000, current_date, 'cash', 'TB-MANUAL-1', 'Manual invoice paid in full'
);
select is(pg_temp.tb_balance(), 5000::numeric, 'After R2,000 against manual: balance is R5,000 (rent only)');

-- Record the final R5,000 against rent.
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Tenant Balance Test Org' and i.source = 'rent_schedule'),
  5000, current_date, 'eft', 'TB-RENT-2', 'Final rent payment'
);
select is(pg_temp.tb_balance(), 0::numeric, 'After the final R5,000 against rent: balance is R0');

-- Reverse the R5,000 final rent payment.
select public.reverse_invoice_payment(
  (select ip.id from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id where i.org_id = (select id from public.organizations where legal_name = 'Tenant Balance Test Org') and ip.reference = 'TB-RENT-2'),
  'Bounced EFT'
);
select is(pg_temp.tb_balance(), 5000::numeric, 'After reversing the R5,000: balance is back to R5,000');

-- Void a separate, unpaid R1,000 invoice -- must NOT change the balance at all (it was already
-- excluded from any "paid" contribution, and void further guarantees it never contributes).
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Tenant Balance Test Org'),
  (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'TB Unit'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Tenant Balance Test Org'),
  current_date, current_date + 7, 'TB-REF-2', 'TB Unpaid invoice to void', null,
  '[{"description":"Should not affect balance","quantity":1,"unitPrice":1000}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Tenant Balance Test Org' and i.description = 'TB Unpaid invoice to void')
);
-- Before voiding: balance SHOULD include this new R1000 invoice's own balance (R1000) -- proving
-- the void test below is a real before/after comparison, not a coincidence of it never having
-- counted.
select is(pg_temp.tb_balance(), 6000::numeric, 'Before voiding: the new unpaid R1,000 invoice DOES count (balance is R5,000 + R1,000 = R6,000)');

select public.void_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Tenant Balance Test Org' and i.description = 'TB Unpaid invoice to void'),
  'Never going to be paid'
);
select is(pg_temp.tb_balance(), 5000::numeric, 'After voiding the unpaid R1,000 invoice: balance returns to R5,000 -- the void invoice is excluded, not double-subtracted');

select * from finish();
rollback;
