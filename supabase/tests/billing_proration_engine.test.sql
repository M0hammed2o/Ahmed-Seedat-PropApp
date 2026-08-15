-- Tests for 20260101000104_billing_proration_engine.sql: compute_plan_change_quote()/
-- create_plan_change_quote()/confirm_plan_change()/cancel_pending_plan_change()/
-- apply_due_scheduled_plan_changes(). Decimal-safe proration math, upgrade/downgrade/reactivation/
-- no_change classification, idempotent confirmation, and scheduled-downgrade application.

begin;
select plan(34);

insert into auth.users (id, email) values
  ('fd000000-0000-0000-0000-000000000001', 'prorate-principal@test.propertyvault.example');

select set_config('pgtap.pr.starter_id', (select id::text from public.plans where code = 'starter'), false);
select set_config('pgtap.pr.professional_id', (select id::text from public.plans where code = 'professional'), false);
select set_config('pgtap.pr.business_id', (select id::text from public.plans where code = 'business'), false);

-- === Scenario A: no organization_subscriptions row at all -- new_subscription, full price ===
insert into public.organizations (id, legal_name, org_type, status)
values ('fe000000-0000-0000-0000-000000000001', 'Proration Test Org A (no subscription)', 'agency', 'trial');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('fe000000-0000-0000-0000-000000000001', 'fd000000-0000-0000-0000-000000000001', 'principal', 'active', now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';

select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000001'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).change_type)::text,
  'new_subscription',
  'no subscription row -> change_type = new_subscription'
);
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000001'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).amount_due_now),
  699.00,
  'new_subscription charges the full target plan price -- no proration input to compute against'
);

-- === Scenario B: mid-cycle UPGRADE, Starter -> Professional, exactly halfway through a 30-day period ===
reset role;
insert into public.organizations (id, legal_name, org_type, status)
values ('fe000000-0000-0000-0000-000000000002', 'Proration Test Org B (mid-cycle upgrade)', 'agency', 'active');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('fe000000-0000-0000-0000-000000000002', 'fd000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'fe000000-0000-0000-0000-000000000002', current_setting('pgtap.pr.starter_id')::uuid, 'monthly',
  current_date - 15, current_date + 15, 'active'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';

select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).change_type)::text,
  'upgrade',
  'mid-cycle Starter -> Professional is classified as upgrade'
);
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).proration_fraction),
  0.50000,
  'exactly halfway through a 30-day period -> proration_fraction = 0.5'
);
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).amount_due_now),
  200.00,
  'amount_due_now = (699 - 299) * 0.5 = 200.00 (the DIFFERENCE only, never full new-plan price)'
);
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).next_renewal_amount),
  699.00,
  'next_renewal_amount is the full new-plan price (charged in full starting next renewal)'
);
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).current_period_end),
  (current_date + 15),
  'current_period_end is PRESERVED by an upgrade quote, not extended or reset'
);

-- === Scenario C: upgrade immediately after renewal (fraction ~= 1) ===
reset role;
update public.organization_subscriptions
  set current_period_start = current_date, current_period_end = current_date + 30
  where org_id = 'fe000000-0000-0000-0000-000000000002';
set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).proration_fraction),
  1.00000,
  'upgrading on the first day of a period -> fraction = 1 (nearly full difference charged)'
);
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).amount_due_now),
  400.00,
  'fraction 1 -> amount_due_now = full (699 - 299) difference = 400.00'
);

-- === Scenario D: upgrade shortly before renewal (small fraction) ===
reset role;
update public.organization_subscriptions
  set current_period_start = current_date - 29, current_period_end = current_date + 1
  where org_id = 'fe000000-0000-0000-0000-000000000002';
set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';
select cmp_ok(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).amount_due_now),
  '<',
  20.00::numeric,
  'upgrading 1 day before renewal charges only a small fraction of the difference (< R20 of a R400 max difference)'
);

-- === Scenario E: upgrade AT exact period_end (fraction = 0) -- zero charge, but still applies ===
reset role;
update public.organization_subscriptions
  set current_period_start = current_date - 30, current_period_end = current_date
  where org_id = 'fe000000-0000-0000-0000-000000000002';
set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).amount_due_now),
  0.00,
  'upgrading exactly at period_end (fraction 0) charges 0.00 -- does not error or go negative'
);

-- === Scenario F: DOWNGRADE, Professional -> Starter, mid-cycle -- no charge, scheduled at renewal ===
reset role;
update public.organization_subscriptions
  set plan_id = current_setting('pgtap.pr.professional_id')::uuid,
      current_period_start = current_date - 10, current_period_end = current_date + 20
  where org_id = 'fe000000-0000-0000-0000-000000000002';
set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';

select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.starter_id')::uuid)).change_type)::text,
  'downgrade',
  'Professional -> Starter mid-cycle is classified as downgrade'
);
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.starter_id')::uuid)).amount_due_now),
  0.00,
  'downgrade charges 0.00 -- no mid-cycle refund, no immediate charge either'
);
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.starter_id')::uuid)).effective_at)::date,
  (current_date + 20),
  'downgrade effective_at is current_period_end -- NOT immediate'
);

-- === Scenario G: same-plan request -- no_change ===
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.professional_id')::uuid)).change_type)::text,
  'no_change',
  'requesting the SAME plan already active is classified as no_change'
);

-- === Scenario H: price override + discount + promotional credit all feed current_effective_price ===
reset role;
update public.organization_subscriptions
  set price_override = 999.00, discount_pct = 10, promotional_credit = 50.00
  where org_id = 'fe000000-0000-0000-0000-000000000002';
-- current_effective = greatest(0, 999 * 0.9 - 50) = greatest(0, 899.10 - 50) = 849.10
set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.business_id')::uuid)).current_effective_price),
  849.10,
  'current_effective_price folds in price_override (999) * (1 - discount_pct 10%) - promotional_credit (50) = 849.10'
);
-- Business is null (unlimited) maxProperties but its own base_price (1499.00) is still what''s
-- compared against -- confirms target_effective_price never inherits the CURRENT row''s override.
select is(
  ((select public.compute_plan_change_quote('fe000000-0000-0000-0000-000000000002'::uuid, current_setting('pgtap.pr.business_id')::uuid)).target_effective_price),
  1499.00,
  'target_effective_price is always the target plan''s plain base_price -- override/discount does not carry forward to a new plan'
);

-- === Confirmation, idempotency, and downgrade-scheduling mechanics (fresh org) ===
reset role;
insert into public.organizations (id, legal_name, org_type, status)
values ('fe000000-0000-0000-0000-000000000003', 'Proration Test Org C (confirm mechanics)', 'agency', 'active');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('fe000000-0000-0000-0000-000000000003', 'fd000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'fe000000-0000-0000-0000-000000000003', current_setting('pgtap.pr.starter_id')::uuid, 'monthly',
  current_date - 15, current_date + 15, 'active'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';

-- A downgrade quote (Starter is already the lowest paid plan, so first move it to Professional so
-- we have somewhere to downgrade FROM -- reuse the RPC path itself to do that realistically).
select set_config(
  'pgtap.pr.quote1_id',
  (select id::text from public.create_plan_change_quote('fe000000-0000-0000-0000-000000000003'::uuid, current_setting('pgtap.pr.professional_id')::uuid)),
  false
);
select is(
  (select change_type::text from public.billing_change_quotes where id = current_setting('pgtap.pr.quote1_id')::uuid),
  'upgrade',
  'create_plan_change_quote() persists a real quote row with the computed change_type'
);
select isnt(
  (select expires_at from public.billing_change_quotes where id = current_setting('pgtap.pr.quote1_id')::uuid),
  null,
  'the persisted quote has a real expiry'
);

select set_config(
  'pgtap.pr.confirm1_status',
  (select status::text from public.confirm_plan_change(current_setting('pgtap.pr.quote1_id')::uuid)),
  false
);
select is(
  current_setting('pgtap.pr.confirm1_status'),
  'awaiting_payment',
  'confirming a real-money upgrade (amount_due_now > 0) marks it awaiting_payment, NOT completed -- entitlement does not flip before payment'
);
select is(
  (select plan_id from public.organization_subscriptions where org_id = 'fe000000-0000-0000-0000-000000000003' order by current_period_start desc limit 1),
  current_setting('pgtap.pr.starter_id')::uuid,
  'the org''s actual plan_id is UNCHANGED while the upgrade is awaiting_payment'
);

-- === Duplicate confirmation (double-click) is idempotent -- same quote_id, same outcome, no second row ===
select is(
  (select count(*)::int from public.billing_plan_changes where quote_id = current_setting('pgtap.pr.quote1_id')::uuid),
  1,
  'exactly one billing_plan_changes row exists after the first confirm'
);
select ok(
  (select already_processed from public.confirm_plan_change(current_setting('pgtap.pr.quote1_id')::uuid)),
  'confirming the SAME quote_id a second time reports already_processed = true'
);
select is(
  (select count(*)::int from public.billing_plan_changes where quote_id = current_setting('pgtap.pr.quote1_id')::uuid),
  1,
  'still exactly one billing_plan_changes row after the duplicate confirm -- no double charge/change'
);

-- === Stale (expired) quote is rejected ===
reset role;
update public.billing_change_quotes
  set expires_at = now() - interval '1 minute', consumed_at = null, consumed_by_change_id = null
  where org_id = 'fe000000-0000-0000-0000-000000000003' and id <> current_setting('pgtap.pr.quote1_id')::uuid;
select set_config(
  'pgtap.pr.quote2_id',
  (select id::text from public.create_plan_change_quote('fe000000-0000-0000-0000-000000000003'::uuid, current_setting('pgtap.pr.business_id')::uuid)),
  false
);
update public.billing_change_quotes set expires_at = now() - interval '1 minute' where id = current_setting('pgtap.pr.quote2_id')::uuid;
set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select public.confirm_plan_change(current_setting('pgtap.pr.quote2_id')::uuid) $$,
  'P0001', 'This quote has expired -- request a new one',
  'an expired, never-confirmed quote is rejected, not silently honoured'
);

-- === Downgrade scheduling: schedules, does not touch entitlement immediately, applies exactly once ===
reset role;
-- Move the org onto Professional (simulating the earlier upgrade having actually completed via a
-- real payment webhook) so there is a real "higher plan" to downgrade FROM.
update public.organization_subscriptions
  set plan_id = current_setting('pgtap.pr.professional_id')::uuid
  where org_id = 'fe000000-0000-0000-0000-000000000003';
set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';

select set_config(
  'pgtap.pr.downgrade_quote_id',
  (select id::text from public.create_plan_change_quote('fe000000-0000-0000-0000-000000000003'::uuid, current_setting('pgtap.pr.starter_id')::uuid)),
  false
);
select public.confirm_plan_change(current_setting('pgtap.pr.downgrade_quote_id')::uuid);

select is(
  (select status::text from public.billing_plan_changes where org_id = 'fe000000-0000-0000-0000-000000000003' and change_type = 'downgrade'),
  'scheduled',
  'confirming a downgrade creates a SCHEDULED row, not an immediately-completed one'
);
select is(
  (select plan_id from public.organization_subscriptions where org_id = 'fe000000-0000-0000-0000-000000000003' order by current_period_start desc limit 1),
  current_setting('pgtap.pr.professional_id')::uuid,
  'the org KEEPS Professional-level entitlement immediately after scheduling a downgrade to Starter (no immediate entitlement loss)'
);

-- Pending downgrade can be cancelled.
select ok(
  (select public.cancel_pending_plan_change('fe000000-0000-0000-0000-000000000003'::uuid)),
  'cancel_pending_plan_change() returns true when a scheduled downgrade existed'
);
select is(
  (select status::text from public.billing_plan_changes where org_id = 'fe000000-0000-0000-0000-000000000003' and change_type = 'downgrade'),
  'cancelled',
  'the scheduled downgrade row is now cancelled'
);
select ok(
  not (select public.cancel_pending_plan_change('fe000000-0000-0000-0000-000000000003'::uuid)),
  'cancel_pending_plan_change() returns false (idempotent no-op) when nothing is scheduled'
);

-- Re-schedule it, then let the scheduler apply it (simulate the renewal date having arrived).
set local role authenticated;
set local "request.jwt.claim.sub" = 'fd000000-0000-0000-0000-000000000001';
select set_config(
  'pgtap.pr.downgrade_quote2_id',
  (select id::text from public.create_plan_change_quote('fe000000-0000-0000-0000-000000000003'::uuid, current_setting('pgtap.pr.starter_id')::uuid)),
  false
);
select public.confirm_plan_change(current_setting('pgtap.pr.downgrade_quote2_id')::uuid);

reset role;
update public.billing_plan_changes
  set effective_at = now() - interval '1 minute'
  where org_id = 'fe000000-0000-0000-0000-000000000003' and status = 'scheduled';

select is(
  (select public.apply_due_scheduled_plan_changes()),
  1,
  'apply_due_scheduled_plan_changes() applies exactly the 1 due scheduled change'
);
select is(
  (select plan_id from public.organization_subscriptions where org_id = 'fe000000-0000-0000-0000-000000000003' order by current_period_start desc limit 1),
  current_setting('pgtap.pr.starter_id')::uuid,
  'after applying, the org''s actual plan_id is now Starter (the scheduled downgrade took effect)'
);
select is(
  (select status::text from public.billing_plan_changes where org_id = 'fe000000-0000-0000-0000-000000000003' and change_type = 'downgrade' and cancelled_at is null),
  'completed',
  'the applied downgrade row is marked completed'
);
select is(
  (select public.apply_due_scheduled_plan_changes()),
  0,
  'running the scheduler again applies 0 changes -- already-applied rows are not re-processed (executes exactly once)'
);

select * from finish();
rollback;
