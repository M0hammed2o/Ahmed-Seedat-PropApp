-- Android V1 cleanup pass (2026-09-17). Confirming a tenant-reported payment failed in production
-- with "could not be allocated ... it may already be fully paid", which was untrue: the invoice was
-- issued, unpaid, and for the exact amount. The real cause was an organisation with NO chart of
-- accounts -- seed_chart_of_accounts() only runs inside create_organization(), and the demo and
-- provisioning scripts insert the organisation row directly -- so post_journal_entry refused and
-- confirm_payment_report collapsed every failure into one generic code.
--
-- Proves: that cause now has its own error code, nothing is half-written when it fires, confirming
-- works once the accounts exist, and a double tap never records the payment twice.

begin;
select plan(14);

insert into auth.users (id, email) values
  ('ac000000-0000-0000-0000-000000000001', 'coa-confirm-accountant@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'ac000000-0000-0000-0000-000000000001';
select public.create_organization('COA Confirm Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'COA Confirm Test Org'));

-- Reproduce an organisation created outside create_organization(): no ledger accounts at all.
delete from public.chart_of_accounts
where org_id = (select id from public.organizations where legal_name = 'COA Confirm Test Org');

set local role authenticated;
set local "request.jwt.claim.sub" = 'ac000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'COA Confirm Test Org'),
  'COA Confirm Property', '1 Ledger St', 'Durban', 'ZA', 'house'::public.property_type
);

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'C1', 'occupied' from public.properties p where p.nickname = 'COA Confirm Property';

insert into public.tenants (org_id, full_name, status)
select id, 'COA Confirm Tenant', 'active' from public.organizations where legal_name = 'COA Confirm Test Org';

insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, date '2026-01-01', 7500, 7500, 'active', 'manual'
from public.organizations o
join public.units u on u.org_id = o.id and u.unit_label = 'C1'
where o.legal_name = 'COA Confirm Test Org';

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'COA Confirm Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'COA Confirm Tenant';

insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select l.org_id, l.id, date '2026-03-01', 7500, 'invoiced'
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'COA Confirm Test Org';

insert into public.invoices (org_id, lease_id, tenant_id, period, amount, status, issued_at)
select l.org_id, l.id, t.id, date '2026-03-01', 7500, 'issued', now()
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'COA Confirm Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'COA Confirm Tenant';

-- The tenant normally files this through the portal; inserted here as the table owner because the
-- staff member under test has no insert path of their own on payment_reports.
reset role;
insert into public.payment_reports (org_id, tenant_id, property_id, lease_id, rent_schedule_id, reported_by_tenant, reported_by_user_id, amount, payment_method, payment_date, status)
select o.id, t.id, p.id, l.id, rs.id, true, 'ac000000-0000-0000-0000-000000000001', 7500, 'eft', date '2026-03-05', 'reported'
from public.organizations o
join public.tenants t on t.org_id = o.id and t.full_name = 'COA Confirm Tenant'
join public.properties p on p.org_id = o.id and p.nickname = 'COA Confirm Property'
join public.leases l on l.org_id = o.id
join public.rent_schedules rs on rs.lease_id = l.id and rs.due_date = date '2026-03-01'
where o.legal_name = 'COA Confirm Test Org';

set local role authenticated;
set local "request.jwt.claim.sub" = 'ac000000-0000-0000-0000-000000000001';

-- ============================================================
-- A. No ledger accounts: a named cause, and nothing written.
-- ============================================================
create temporary table coa_confirm_result as
select * from public.confirm_payment_report(
  (select pr.id from public.payment_reports pr
   join public.organizations o on o.id = pr.org_id
   where o.legal_name = 'COA Confirm Test Org')
);

select is(
  (select success from coa_confirm_result), false,
  'confirming without a chart of accounts does not succeed'
);
select is(
  (select error_code from coa_confirm_result), 'chart_of_accounts_incomplete',
  'the missing chart of accounts is named, not reported as a generic allocation failure'
);
select is(
  (select pr.status::text from public.payment_reports pr join public.organizations o on o.id = pr.org_id
   where o.legal_name = 'COA Confirm Test Org'),
  'reported',
  'the report stays reported when the posting is refused'
);
select is(
  (select pr.invoice_payment_id from public.payment_reports pr join public.organizations o on o.id = pr.org_id
   where o.legal_name = 'COA Confirm Test Org'),
  null,
  'no invoice payment is linked when the posting is refused'
);
select is(
  (select count(*) from public.invoice_payments p
   join public.invoices i on i.id = p.invoice_id
   join public.organizations o on o.id = i.org_id
   where o.legal_name = 'COA Confirm Test Org'),
  0::bigint,
  'no payment row is written when the posting is refused'
);

-- ============================================================
-- B. With the accounts seeded, the same call allocates the payment.
-- ============================================================
reset role;
select public.seed_chart_of_accounts((select id from public.organizations where legal_name = 'COA Confirm Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'ac000000-0000-0000-0000-000000000001';

create temporary table coa_confirm_ok as
select * from public.confirm_payment_report(
  (select pr.id from public.payment_reports pr
   join public.organizations o on o.id = pr.org_id
   where o.legal_name = 'COA Confirm Test Org')
);

select is((select success from coa_confirm_ok), true, 'confirming succeeds once the organisation has its ledger accounts');
select is((select error_code from coa_confirm_ok), null, 'no error code on the successful confirmation');
select is((select ledger_allocated from coa_confirm_ok), true, 'the payment is reported as allocated to the ledger');
select isnt((select invoice_payment_id from coa_confirm_ok), null, 'the confirmation returns the invoice payment it created');

select is(
  (select pr.status::text from public.payment_reports pr join public.organizations o on o.id = pr.org_id
   where o.legal_name = 'COA Confirm Test Org'),
  'confirmed',
  'the report is now confirmed'
);
select is(
  (select sum(p.amount) from public.invoice_payments p
   join public.invoices i on i.id = p.invoice_id
   join public.organizations o on o.id = i.org_id
   where o.legal_name = 'COA Confirm Test Org'),
  7500::numeric,
  'the full amount is allocated against the invoice'
);

-- ============================================================
-- C. Double tap: idempotent, never a second payment.
-- ============================================================
create temporary table coa_confirm_again as
select * from public.confirm_payment_report(
  (select pr.id from public.payment_reports pr
   join public.organizations o on o.id = pr.org_id
   where o.legal_name = 'COA Confirm Test Org')
);

select is((select success from coa_confirm_again), true, 'confirming an already-confirmed report still reports success');
select is(
  (select count(*) from public.invoice_payments p
   join public.invoices i on i.id = p.invoice_id
   join public.organizations o on o.id = i.org_id
   where o.legal_name = 'COA Confirm Test Org'),
  1::bigint,
  'a second confirmation does not record the payment twice'
);
select is(
  (select sum(p.amount) from public.invoice_payments p
   join public.invoices i on i.id = p.invoice_id
   join public.organizations o on o.id = i.org_id
   where o.legal_name = 'COA Confirm Test Org'),
  7500::numeric,
  'the allocated total is unchanged by the second confirmation'
);

select * from finish();
rollback;
