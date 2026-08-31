-- Final completion + security hardening pass (WORKLOG.md this date), P0-1: proves the invoices/
-- invoice_line_items/invoice_payments RLS hardening (migration 20260101000153) against direct,
-- malicious/careless Supabase client operations -- not just that the sanctioned RPCs work, but that
-- the things they are NOT supposed to allow are actually refused at the database layer, for every
-- role this matters for (accountant, agent, cross-org). Same real end-to-end style as
-- manual_invoices.test.sql (create_organization() + role-switching via request.jwt.claim.sub).
--
-- Each "attempt" runs as a bare, top-level UPDATE/DELETE statement (not wrapped in a `with ... as
-- (update ... returning ...) select count(*) ...` CTE -- Postgres refuses a data-modifying
-- statement inside a CTE used as a scalar subquery, "must be at the top level"), then the very next
-- assertion confirms the row is unchanged (or, for DELETE, still exists). RLS silently matches zero
-- rows for a USING-clause failure (no error) -- the one exception is the "Bonus" transition test
-- below, where USING passes but WITH CHECK fails on the new row, which Postgres raises as a real
-- 42501 error for instead, so that one uses throws_ok().

begin;
select plan(13);

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'immutability-accountant@test.propertyvault.example'),
  ('c1000000-0000-0000-0000-000000000002', 'immutability-agent-only@test.propertyvault.example'),
  ('c1000000-0000-0000-0000-000000000003', 'immutability-outsider@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';

select isnt(
  (select public.create_organization('Immutability Test Org', 'agency')),
  null,
  'org created'
);
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Immutability Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'c1000000-0000-0000-0000-000000000002'::uuid, 'agent', 'active', now()
from public.organizations where legal_name = 'Immutability Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';

-- A second, completely unrelated org for the cross-org caller (test 6) -- user 3 is never a
-- member of "Immutability Test Org" at all.
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000003';
select public.create_organization('Immutability Outsider Org', 'agency');
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';

select public.create_property(
  (select id from public.organizations where legal_name = 'Immutability Test Org'),
  'Immutability Property', '1 Test Street', 'Cape Town', 'ZA', 'house'::public.property_type
);
insert into public.units (property_id, org_id, unit_label, status)
select p.id, p.org_id, 'Immutability Unit', 'occupied'
from public.properties p where p.nickname = 'Immutability Property';
insert into public.tenants (org_id, full_name, status)
select id, 'Immutability Tenant', 'active'
from public.organizations where legal_name = 'Immutability Test Org';
insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select o.id, u.id, current_date, 8500, 8500, 'active', 'manual'
from public.organizations o
join public.units u on u.org_id = o.id and u.unit_label = 'Immutability Unit'
where o.legal_name = 'Immutability Test Org';
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
select l.id, t.id, true
from public.leases l
join public.organizations o on o.id = l.org_id and o.legal_name = 'Immutability Test Org'
join public.tenants t on t.org_id = o.id and t.full_name = 'Immutability Tenant';

-- One draft, one issued invoice to attack.
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Immutability Test Org'),
  (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Immutability Test Org'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Immutability Test Org'),
  current_date, current_date + 7, 'REF-DRAFT', 'Draft target', null,
  '[{"description":"Water","quantity":1,"unitPrice":250}]'::jsonb
);
select public.create_manual_invoice(
  (select id from public.organizations where legal_name = 'Immutability Test Org'),
  (select l.id from public.leases l join public.organizations o on o.id = l.org_id where o.legal_name = 'Immutability Test Org'),
  (select t.id from public.tenants t join public.organizations o on o.id = t.org_id where o.legal_name = 'Immutability Test Org'),
  current_date, current_date + 7, 'REF-ISSUED', 'Issued target', null,
  '[{"description":"Parking","quantity":1,"unitPrice":300}]'::jsonb
);
select public.issue_manual_invoice(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target')
);

-- === Test 1: accountant direct UPDATE of a DRAFT invoice's financial fields -- must be ALLOWED
-- (this is the same mechanism update_manual_invoice() itself relies on) ===
select lives_ok(
  $$ update public.invoices set amount = 999
       where id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Draft target') $$,
  'Test 1: accountant CAN directly update a draft invoice''s financial fields'
);

-- === Test 2: accountant direct UPDATE of an ISSUED invoice's amount -- must be REFUSED ===
update public.invoices set amount = 1
  where id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target');

select is(
  (select amount from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target'),
  300::numeric,
  'Test 2: accountant direct UPDATE of an issued invoice''s amount is refused (RLS-blocked, silently matches zero rows) -- amount unchanged'
);

-- === Test 3: accountant direct UPDATE of an ISSUED invoice's line items -- must be REFUSED ===
update public.invoice_line_items set unit_price = 1
  where invoice_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target');

select is(
  (select unit_price from public.invoice_line_items ili
     join public.invoices i on i.id = ili.invoice_id
     join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target'),
  300::numeric,
  'Test 3: accountant direct UPDATE of an issued invoice''s line items is refused -- unit_price unchanged'
);

-- === Test 4: accountant direct DELETE of an ISSUED invoice -- must be REFUSED ===
delete from public.invoices
  where id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target');

select is(
  (select count(*) from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target'),
  1::bigint,
  'Test 4: accountant direct DELETE of an issued invoice is refused (no DELETE policy at all) -- the invoice still exists'
);

-- Also prove a raw client cannot even flip a DRAFT invoice straight to issued (only
-- issue_manual_invoice() may do that, via security definer). Unlike the tests above, USING passes
-- here (the row IS draft going in) but WITH CHECK fails on the new row (status would become
-- 'issued') -- Postgres raises a real "new row violates row-level security policy" error in that
-- case, rather than silently matching zero rows, so this needs throws_ok, not a row-count check.
select throws_ok(
  $$ update public.invoices set status = 'issued'
       where id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Draft target') $$,
  '42501',
  null,
  'Bonus: a raw client cannot transition a draft invoice to issued directly either (RLS WITH CHECK violation)'
);

-- === Test 5: agent (not accountant+) attempts the equivalent operations -- all refused ===
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000002';

update public.invoices set amount = 1
  where id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Draft target');

select is(
  (select amount from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Draft target'),
  999::numeric,
  'Test 5a: agent-only member cannot update even a DRAFT invoice (accountant+ only, not agent) -- amount stays 999'
);

select throws_ok(
  $$ select public.issue_manual_invoice(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Draft target')
     ) $$,
  'P0001',
  'Caller does not have accountant+ rights in this organization',
  'Test 5b: agent-only member cannot call issue_manual_invoice() either -- the RPC''s own check still holds under security definer'
);

set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';

-- === Test 6: cross-org caller (real principal of a completely different org) attempts the
-- equivalent operations against this org's invoices -- all refused ===
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000003';

-- A cross-org caller has no invoices_select_org_member visibility into this org's rows at all
-- (RLS hides them entirely, not just write-protects them) -- the UPDATE below silently matches
-- zero rows for that reason too, and record_invoice_payment()'s own `select ... where id = ...`
-- (not security definer) resolves NOT FOUND before it ever reaches its own has_org_role check, so
-- it raises "Invoice not found" rather than "not accountant+" -- the safer of the two outcomes
-- (never confirms the row's existence to an outsider), verified explicitly rather than assumed.
update public.invoices set amount = 1
  where id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Draft target');

select throws_ok(
  $$ select public.record_invoice_payment(
       (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target'),
       50, current_date, 'eft', null
     ) $$,
  'P0001',
  'Invoice not found',
  'Test 6b: a cross-org caller gets "not found", not confirmation the invoice exists -- record_invoice_payment() cannot be used against another org''s invoice'
);

set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';

select is(
  (select amount from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Draft target'),
  999::numeric,
  'Test 6a (confirmed as the real org member): the cross-org caller''s direct UPDATE attempt above never touched the row -- amount stays 999'
);

select is(
  (select count(*) from public.invoice_payments ip
     join public.invoices i on i.id = ip.invoice_id
     join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Immutability Test Org'),
  0::bigint,
  'Sanity: no invoice_payments row was ever created against this org''s issued invoice by any of the blocked attempts above'
);

-- === P1 re-confirmation (final accounting reconciliation pass): direct payment-table
-- manipulation is denied -- invoice_payments has an INSERT-only policy (migration 153), no
-- UPDATE/DELETE policy at all, so an accountant who legitimately created a payment via
-- record_invoice_payment() still cannot directly rewrite or delete it afterward. ===
select public.record_invoice_payment(
  (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target'),
  50, current_date, 'eft', 'Legitimate payment for the immutability check below'
);

update public.invoice_payments set amount = 1
  where invoice_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target');

select is(
  (select ip.amount from public.invoice_payments ip
     join public.invoices i on i.id = ip.invoice_id
     join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target'),
  50::numeric,
  'P1: a direct UPDATE on an invoice_payments row is refused (no UPDATE policy) -- amount stays 50'
);

delete from public.invoice_payments
  where invoice_id = (select i.id from public.invoices i join public.organizations o on o.id = i.org_id where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target');

select is(
  (select count(*) from public.invoice_payments ip
     join public.invoices i on i.id = ip.invoice_id
     join public.organizations o on o.id = i.org_id
     where o.legal_name = 'Immutability Test Org' and i.description = 'Issued target'),
  1::bigint,
  'P1: a direct DELETE on an invoice_payments row is refused (no DELETE policy) -- the payment still exists'
);

select * from finish();
rollback;
