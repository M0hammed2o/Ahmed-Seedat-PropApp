-- Tests for 20260101000108_subscription_invoices.sql: create_subscription_invoice_for_payment(),
-- invoice-number generation, and RLS (cross-org isolation, no client write path). V1 billing
-- invoice pass (WORKLOG.md this date).

begin;
select plan(22);

insert into auth.users (id, email) values
  ('1c000000-0000-0000-0000-000000000001', 'invoice-test-a-principal@test.propertyvault.example'),
  ('1c000000-0000-0000-0000-000000000002', 'invoice-test-b-principal@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type, status) values
  ('1c1c0000-0000-0000-0000-000000000001', 'Invoice Test Org A', 'agency', 'active'),
  ('1c1c0000-0000-0000-0000-000000000002', 'Invoice Test Org B', 'agency', 'active');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('1c1c0000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('1c1c0000-0000-0000-0000-000000000002', '1c000000-0000-0000-0000-000000000002', 'principal', 'active', now());

select set_config('pgtap.iv.starter_id', (select id::text from public.plans where code = 'starter'), false);
select set_config('pgtap.iv.professional_id', (select id::text from public.plans where code = 'professional'), false);

insert into public.organization_subscriptions (id, org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  '1c1c0000-0000-0000-0000-000000000101', '1c1c0000-0000-0000-0000-000000000001',
  current_setting('pgtap.iv.starter_id')::uuid, 'monthly', current_date, current_date + 30, 'trial'
);

-- === Scenario A: a first-time subscription payment -> invoice_type = new_subscription ===
insert into public.subscription_payments (id, org_id, subscription_id, amount, currency, status, paid_at)
values (
  '1c1c0000-0000-0000-0000-000000000201', '1c1c0000-0000-0000-0000-000000000001',
  '1c1c0000-0000-0000-0000-000000000101', 299.00, 'ZAR', 'paid', now()
);

select set_config(
  'pgtap.iv.invoice1_id',
  (select id::text from public.create_subscription_invoice_for_payment('1c1c0000-0000-0000-0000-000000000201'::uuid)),
  false
);

select is(
  (select invoice_type::text from public.subscription_invoices where id = current_setting('pgtap.iv.invoice1_id')::uuid),
  'new_subscription',
  'the first invoice for an org (no prior subscription_invoices row) is classified new_subscription'
);
select is(
  (select total from public.subscription_invoices where id = current_setting('pgtap.iv.invoice1_id')::uuid),
  299.00,
  'the invoice total equals the actual payment amount, not the plan base_price recomputed separately'
);
select is(
  (select plan_id from public.subscription_invoices where id = current_setting('pgtap.iv.invoice1_id')::uuid),
  current_setting('pgtap.iv.starter_id')::uuid,
  'plan_id on a new_subscription invoice is the subscription''s own current plan'
);
select isnt(
  (select invoice_number from public.subscription_invoices where id = current_setting('pgtap.iv.invoice1_id')::uuid),
  null,
  'a real, server-generated invoice_number was assigned'
);
select ok(
  (select invoice_number from public.subscription_invoices where id = current_setting('pgtap.iv.invoice1_id')::uuid) ~ '^PLY-\d{4}-\d{6}$',
  'invoice_number matches the expected PLY-YYYY-NNNNNN format'
);

-- === Scenario B: a second, later payment for the SAME org with no linked plan change -> renewal ===
insert into public.subscription_payments (id, org_id, subscription_id, amount, currency, status, paid_at)
values (
  '1c1c0000-0000-0000-0000-000000000202', '1c1c0000-0000-0000-0000-000000000001',
  '1c1c0000-0000-0000-0000-000000000101', 299.00, 'ZAR', 'paid', now()
);
select public.create_subscription_invoice_for_payment('1c1c0000-0000-0000-0000-000000000202'::uuid);
select is(
  (select invoice_type::text from public.subscription_invoices where subscription_payment_id = '1c1c0000-0000-0000-0000-000000000202'),
  'renewal',
  'a second payment for an org that already has an invoice is classified renewal, not new_subscription'
);

-- === Scenario C: an upgrade payment (billing_plan_change_id set) -> invoice_type = upgrade,
-- plan_id = the TARGET plan, total = the prorated amount actually charged (never the full new
-- plan price) ===
insert into public.billing_plan_changes (id, org_id, change_type, old_plan_id, new_plan_id, charge_due, currency, status, effective_at)
values (
  '1c1c0000-0000-0000-0000-000000000301', '1c1c0000-0000-0000-0000-000000000001',
  'upgrade', current_setting('pgtap.iv.starter_id')::uuid, current_setting('pgtap.iv.professional_id')::uuid,
  200.00, 'ZAR', 'awaiting_payment', now()
);
insert into public.subscription_payments (id, org_id, subscription_id, amount, currency, status, paid_at, billing_plan_change_id)
values (
  '1c1c0000-0000-0000-0000-000000000203', '1c1c0000-0000-0000-0000-000000000001',
  '1c1c0000-0000-0000-0000-000000000101', 200.00, 'ZAR', 'paid', now(), '1c1c0000-0000-0000-0000-000000000301'
);
select public.create_subscription_invoice_for_payment('1c1c0000-0000-0000-0000-000000000203'::uuid);

select is(
  (select invoice_type::text from public.subscription_invoices where subscription_payment_id = '1c1c0000-0000-0000-0000-000000000203'),
  'upgrade',
  'a payment linked to an upgrade billing_plan_changes row is classified upgrade'
);
select is(
  (select total from public.subscription_invoices where subscription_payment_id = '1c1c0000-0000-0000-0000-000000000203'),
  200.00,
  'the upgrade invoice total is the R200 prorated charge actually collected, NEVER the R699 full new-plan price'
);
select is(
  (select plan_id from public.subscription_invoices where subscription_payment_id = '1c1c0000-0000-0000-0000-000000000203'),
  current_setting('pgtap.iv.professional_id')::uuid,
  'the upgrade invoice''s plan_id is the TARGET plan (Professional), not the plan being upgraded from'
);
select is(
  (select billing_plan_change_id from public.subscription_invoices where subscription_payment_id = '1c1c0000-0000-0000-0000-000000000203'),
  '1c1c0000-0000-0000-0000-000000000301'::uuid,
  'the upgrade invoice links back to the billing_plan_changes row it is invoicing'
);

-- === Scenario D: refusing to invoice an unpaid/pending payment ===
insert into public.subscription_payments (id, org_id, subscription_id, amount, currency, status)
values (
  '1c1c0000-0000-0000-0000-000000000204', '1c1c0000-0000-0000-0000-000000000001',
  '1c1c0000-0000-0000-0000-000000000101', 299.00, 'ZAR', 'pending'
);
select throws_ok(
  $$ select public.create_subscription_invoice_for_payment('1c1c0000-0000-0000-0000-000000000204'::uuid) $$,
  'P0001',
  'Payment 1c1c0000-0000-0000-0000-000000000204 is not paid (status: pending) -- refusing to invoice an unpaid charge',
  'refuses to create an invoice for a payment that is not actually paid'
);
select is(
  (select count(*)::int from public.subscription_invoices where subscription_payment_id = '1c1c0000-0000-0000-0000-000000000204'),
  0,
  'no invoice row was created for the refused pending payment'
);

-- === Scenario E: idempotency -- calling this twice for the SAME payment must not create a
-- second invoice (structural, via unique(subscription_payment_id)) ===
select throws_ok(
  $$ select public.create_subscription_invoice_for_payment('1c1c0000-0000-0000-0000-000000000201'::uuid) $$,
  '23505',
  null,
  'calling create_subscription_invoice_for_payment() a second time for the same payment throws a unique violation, never a second invoice'
);
select is(
  (select count(*)::int from public.subscription_invoices where subscription_payment_id = '1c1c0000-0000-0000-0000-000000000201'),
  1,
  'still exactly one invoice for the original new_subscription payment after the rejected duplicate call'
);

-- === Scenario F: a downgrade never produces an invoice (no payment exists to invoice at all --
-- structural, not a special-cased skip) ===
select is(
  (select count(*)::int from public.subscription_invoices si
     join public.billing_plan_changes bpc on bpc.id = si.billing_plan_change_id
     where bpc.change_type = 'downgrade'),
  0,
  'no subscription_invoices row is ever linked to a downgrade billing_plan_changes row'
);

-- === RLS: cross-org isolation ===
set local role authenticated;
set local "request.jwt.claim.sub" = '1c000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.subscription_invoices where org_id = '1c1c0000-0000-0000-0000-000000000001'),
  0,
  'Org B principal cannot see Org A''s subscription_invoices'
);

set local "request.jwt.claim.sub" = '1c000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.subscription_invoices where org_id = '1c1c0000-0000-0000-0000-000000000001'),
  3,
  'Org A principal CAN see all 3 of their own subscription_invoices (new_subscription + renewal + upgrade)'
);

-- === RLS: no authenticated-role client can write directly. No UPDATE/DELETE policy exists at
-- all, so (matching this codebase's own established "lives_ok, filtered to zero rows" shape,
-- e.g. billing_events_isolation.test.sql/billing_cross_org_isolation.test.sql) these run without
-- error but affect zero rows -- verified unchanged below via reset role, which is the real proof.
select lives_ok(
  $$ update public.subscription_invoices set total = 0.01 where id = current_setting('pgtap.iv.invoice1_id')::uuid $$,
  'authenticated-role UPDATE against subscription_invoices runs without error (no UPDATE policy, filtered to zero rows)'
);
select throws_ok(
  $$ insert into public.subscription_invoices (org_id, subscription_payment_id, plan_id, invoice_type, billing_period_start, billing_period_end, subtotal, total)
     values ('1c1c0000-0000-0000-0000-000000000001', '1c1c0000-0000-0000-0000-000000000204', current_setting('pgtap.iv.starter_id')::uuid, 'new_subscription', current_date, current_date + 30, 0.01, 0.01) $$,
  '42501',
  null,
  'no authenticated-role client can INSERT a fabricated subscription_invoices row'
);
select lives_ok(
  $$ delete from public.subscription_invoices where id = current_setting('pgtap.iv.invoice1_id')::uuid $$,
  'authenticated-role DELETE against subscription_invoices runs without error (no DELETE policy, filtered to zero rows)'
);

reset role;
select is(
  (select total from public.subscription_invoices where id = current_setting('pgtap.iv.invoice1_id')::uuid),
  299.00,
  'the invoice total is genuinely unchanged after the rejected forge attempt'
);
select isnt(
  (select id from public.subscription_invoices where id = current_setting('pgtap.iv.invoice1_id')::uuid),
  null,
  'the invoice row still exists -- the DELETE attempt really did affect zero rows, financial history was not erased'
);

select * from finish();
rollback;
