-- Tests for migration 20260101000165 (payment-report ledger allocation fix,
-- UTILITIES_RATES_BUDGET_GAP_AUDIT.md §7 finding): confirm_payment_report() must allocate through
-- record_invoice_payment() -- the one authoritative ledger entry point -- when it can be
-- unambiguously matched to an issued invoice, and must never double-allocate on a re-confirm.

begin;
select plan(17);

insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'f5-accountant@test.propertyvault.example'),
  ('f5000000-0000-0000-0000-000000000002', 'f5-tenant-user@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';
select public.create_organization('F5 Ledger Test Org', 'agency');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'F5 Ledger Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'F5 Ledger Test Org'),
  'F5 Ledger Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);

insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'F5 Unit', 'occupied' from public.properties p where p.nickname = 'F5 Ledger Property';
insert into public.tenants (org_id, full_name, status, user_id)
select id, 'F5 Tenant', 'active', 'f5000000-0000-0000-0000-000000000002' from public.organizations where legal_name = 'F5 Ledger Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 12500, 12500, 'active', 'manual'
from public.organizations o join public.units u on u.org_id = o.id and u.unit_label = 'F5 Unit'
where o.legal_name = 'F5 Ledger Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true from public.leases l
join public.units u on u.id = l.unit_id and u.unit_label = 'F5 Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'F5 Ledger Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'F5 Tenant';
insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
select o.id, l.id, current_date, 12500, 'pending'
from public.leases l join public.units u on u.id = l.unit_id and u.unit_label = 'F5 Unit'
join public.organizations o on o.id = l.org_id and o.legal_name = 'F5 Ledger Test Org';

-- === outcome 2: rent_schedule_id is null -- acknowledgement-only, unchanged legacy behaviour ===
-- Reported by staff (the accountant) on the tenant's behalf -- matches payment_reports_insert_staff
-- exactly (reported_by_tenant=false, reported_by_user_id=auth.uid()), avoiding a session switch to
-- the tenant just to satisfy the tenant-self insert policy's own auth.uid() check.
insert into public.payment_reports (org_id, property_id, lease_id, tenant_id, reported_by_tenant, reported_by_user_id, amount, payment_method, payment_date)
select o.id, p.id, l.id, t.id, false, 'f5000000-0000-0000-0000-000000000001', 12500, 'eft', current_date
from public.organizations o
join public.properties p on p.org_id = o.id and p.nickname = 'F5 Ledger Property'
join public.leases l on l.org_id = o.id
join public.tenants t on t.org_id = o.id and t.full_name = 'F5 Tenant'
where o.legal_name = 'F5 Ledger Test Org';

select is(
  (select ledger_allocated from public.confirm_payment_report(
    (select id from public.payment_reports where reported_by_tenant = false and rent_schedule_id is null)
  )),
  false,
  'confirming a report with no rent_schedule_id is acknowledgement-only -- ledger_allocated is false'
);

select is(
  (select count(*) from public.invoice_payments),
  0::bigint,
  'no invoice_payments row was created for the rent_schedule_id-less report'
);

-- === outcome 3: rent_schedule_id set, but invoice not yet issued -- confirmation refused ===
insert into public.payment_reports (org_id, property_id, lease_id, rent_schedule_id, tenant_id, reported_by_tenant, reported_by_user_id, amount, payment_method, payment_date)
select o.id, p.id, l.id, rs.id, t.id, false, 'f5000000-0000-0000-0000-000000000001', 12500, 'eft', current_date
from public.organizations o
join public.properties p on p.org_id = o.id and p.nickname = 'F5 Ledger Property'
join public.leases l on l.org_id = o.id
join public.rent_schedules rs on rs.lease_id = l.id
join public.tenants t on t.org_id = o.id and t.full_name = 'F5 Tenant'
where o.legal_name = 'F5 Ledger Test Org';

select is(
  (select success from public.confirm_payment_report(
    (select id from public.payment_reports where rent_schedule_id is not null)
  )),
  false,
  'confirmation is refused when rent_schedule_id is set but no invoice has been issued yet'
);

select is(
  (select error_code from public.confirm_payment_report(
    (select id from public.payment_reports where rent_schedule_id is not null)
  )),
  'invoice_not_issued',
  'the refusal reason is invoice_not_issued, not a silent downgrade to acknowledgement-only'
);

select is(
  (select status from public.payment_reports where rent_schedule_id is not null),
  'reported'::public.payment_report_status,
  'the report status is unchanged (still reported) after a refused confirmation'
);

-- === outcome 1: rent_schedule_id set AND a matching issued invoice exists -- real allocation ===
select public.invoice_rent_schedule((select rs.id from public.rent_schedules rs join public.leases l on l.id = rs.lease_id join public.units u on u.id = l.unit_id where u.unit_label = 'F5 Unit'));

select is(
  (select status from public.invoices where lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'F5 Unit')),
  'issued'::public.invoice_status,
  'the invoice is now issued -- fixture sanity check before the real-allocation assertions'
);

select is(
  (select success from public.confirm_payment_report(
    (select id from public.payment_reports where rent_schedule_id is not null)
  )),
  true,
  'confirming now (with an issued invoice) succeeds'
);

select is(
  (select ledger_allocated from public.confirm_payment_report(
    (select id from public.payment_reports where rent_schedule_id is not null)
  )),
  true,
  'ledger_allocated is true -- this is the important behavioural fix (scenario 9)'
);

select is(
  (select coalesce(sum(ip.amount), 0) from public.invoice_payments ip
     join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'F5 Unit')),
  12500::numeric,
  'a real invoice_payments row of R12,500 now exists -- the authoritative ledger was actually updated'
);

select is(
  (select status from public.rent_schedules where lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'F5 Unit')),
  'paid'::public.rent_schedule_status,
  'rent_schedules.status recomputed to paid via the SAME shared helper record_invoice_payment() already uses (scenario 9: paid/partial/outstanding status updates)'
);

select isnt(
  (select invoice_payment_id from public.payment_reports where rent_schedule_id is not null),
  null,
  'payment_reports.invoice_payment_id is linked to the new invoice_payments row for traceability'
);

-- === idempotency: re-confirming does not double-allocate (scenario 11) ===
select is(
  (select success from public.confirm_payment_report(
    (select id from public.payment_reports where rent_schedule_id is not null)
  )),
  true,
  'a second confirm call on an already-confirmed report still returns success (idempotent)'
);

select is(
  (select count(*) from public.invoice_payments ip
     join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'F5 Unit')),
  1::bigint,
  'still exactly ONE invoice_payments row after a second confirm call -- no double allocation'
);

select is(
  (select coalesce(sum(ip.amount), 0) from public.invoice_payments ip
     join public.invoices i on i.id = ip.invoice_id
     where i.lease_id = (select l.id from public.leases l join public.units u on u.id = l.unit_id where u.unit_label = 'F5 Unit')),
  12500::numeric,
  'the total allocated is still exactly R12,500 -- not R25,000 from a double-count'
);

-- === audit trail: write_lifecycle_audit_event fired for the utility/budget/cost RPCs in this pass ===
select is(
  (select count(*) from public.audit_events where action = 'payment.recorded'),
  1::bigint,
  'record_invoice_payment (called from inside confirm_payment_report) wrote its own payment.recorded audit event'
);

reset role;

-- === tenant denial: a tenant cannot call confirm_payment_report at all ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000002'; -- tenant

select is(
  (select success from public.confirm_payment_report(
    (select id from public.payment_reports where rent_schedule_id is null)
  )),
  false,
  'a tenant (not accountant+) cannot confirm any payment report'
);

-- Either 'forbidden' (RLS lets the tenant see the row, has_org_role denies the action) or
-- 'not_found' (RLS hides the row from this session outright) is a safe outcome here -- both deny
-- the tenant. Asserting membership rather than one exact code so this doesn't flake on which of
-- the two safe paths a given session takes.
select ok(
  (select error_code from public.confirm_payment_report(
    (select id from public.payment_reports where rent_schedule_id is null)
  )) in ('forbidden', 'not_found'),
  'a tenant is denied (forbidden or not_found -- both are safe) rather than able to confirm'
);

reset role;

select * from finish();
rollback;
