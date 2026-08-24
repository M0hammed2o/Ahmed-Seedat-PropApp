-- Subscription integrity fix (this date): a read-only production audit found Mo's Properties with
-- 2 simultaneous organization_subscriptions rows (both 'trial', identical current_period_start),
-- caused by (1) no constraint ever prevented more than one commercially-current row per org, and
-- (2) every "current subscription" reader resolved ties via order-by alone, no tiebreaker. This
-- file proves the new unique index (organization_subscriptions_one_current_per_org, migration
-- 20260101000126) and the new created_at tiebreaker on the entitlement RPCs.

begin;
select plan(16);

insert into auth.users (id, email) values
  ('5c000000-0000-0000-0000-000000000001', 'sci-principal@test.propertyvault.example');

select set_config('sci.professional_id', (select id::text from public.plans where code = 'professional_monthly'), false);
select set_config('sci.starter_id', (select id::text from public.plans where code = 'starter_monthly'), false);

insert into public.organizations (id, legal_name, org_type, status)
values ('5c5c0000-0000-0000-0000-000000000001', 'Subscription Integrity Test Org', 'agency', 'trial');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('5c5c0000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000001', 'principal', 'active', now());

-- ============================================================
-- Part 1: the unique index actually blocks a second simultaneous current row, in every
-- trial/active combination -- never blocks a 'cancelled' row, and never limits how much history
-- ('cancelled' rows) an org can accumulate.
-- ============================================================
insert into public.organization_subscriptions (id, org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values ('5c5c0000-0000-0000-0000-000000000101', '5c5c0000-0000-0000-0000-000000000001', current_setting('sci.professional_id')::uuid, 'monthly', current_date, current_date + 30, 'trial');

select throws_ok(
  $$insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
    values ('5c5c0000-0000-0000-0000-000000000001', (select id from public.plans where code = 'professional_monthly'), 'monthly', current_date, current_date + 30, 'trial')$$,
  'duplicate key value violates unique constraint "organization_subscriptions_one_current_per_org"',
  'a second simultaneous trial row for the same org is rejected by the unique index'
);

select throws_ok(
  $$insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
    values ('5c5c0000-0000-0000-0000-000000000001', (select id from public.plans where code = 'professional_monthly'), 'monthly', current_date, current_date + 30, 'active')$$,
  'duplicate key value violates unique constraint "organization_subscriptions_one_current_per_org"',
  'a mixed trial+active pair for the same org is rejected -- at most one CURRENT row of either status'
);

update public.organization_subscriptions set status = 'active' where id = '5c5c0000-0000-0000-0000-000000000101';

select throws_ok(
  $$insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
    values ('5c5c0000-0000-0000-0000-000000000001', (select id from public.plans where code = 'professional_monthly'), 'monthly', current_date, current_date + 30, 'active')$$,
  'duplicate key value violates unique constraint "organization_subscriptions_one_current_per_org"',
  'a second simultaneous active row for the same org is rejected by the unique index'
);

update public.organization_subscriptions set status = 'cancelled' where id = '5c5c0000-0000-0000-0000-000000000101';

select lives_ok(
  $$insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
    values ('5c5c0000-0000-0000-0000-000000000001', (select id from public.plans where code = 'professional_monthly'), 'monthly', current_date, current_date + 30, 'active')$$,
  'a NEW active row is allowed once the old one is cancelled -- the index only restricts trial/active, never cancelled'
);

select lives_ok(
  $$insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
    values ('5c5c0000-0000-0000-0000-000000000001', (select id from public.plans where code = 'professional_monthly'), 'monthly', current_date - 60, current_date - 30, 'cancelled')$$,
  'a second, distinct cancelled (historical) row is never restricted -- unlimited history is preserved'
);

select is(
  (select count(*)::int from public.organization_subscriptions where org_id = '5c5c0000-0000-0000-0000-000000000001'),
  3, 'all 3 rows (2 cancelled + 1 active) still exist and are queryable -- nothing was deleted or blocked from history'
);

select is(
  (select count(*)::int from public.organization_subscriptions where org_id = '5c5c0000-0000-0000-0000-000000000001' and status in ('trial', 'active')),
  1, 'exactly one commercially-current (trial/active) row exists for the org'
);

-- ============================================================
-- Part 2: deterministic tiebreak -- two rows sharing current_period_start resolve to the one with
-- the LATER created_at (matches every reader's new `order by current_period_start desc,
-- created_at desc` -- the later row is the one still "in flight"/most-recently-touched).
-- ============================================================
delete from public.organization_subscriptions where org_id = '5c5c0000-0000-0000-0000-000000000001';

insert into public.organization_subscriptions (id, org_id, plan_id, billing_cycle, current_period_start, current_period_end, status, created_at)
values (
  '5c5c0000-0000-0000-0000-000000000201', '5c5c0000-0000-0000-0000-000000000001',
  current_setting('sci.starter_id')::uuid, 'monthly', current_date, current_date + 30, 'cancelled',
  now() - interval '1 hour'
);
-- Starter's maxProperties/maxStaff/includedOwners are all lower than Professional's -- a clean,
-- observable signal for which row the tiebreaker actually picked.
insert into public.organization_subscriptions (id, org_id, plan_id, billing_cycle, current_period_start, current_period_end, status, created_at)
values (
  '5c5c0000-0000-0000-0000-000000000202', '5c5c0000-0000-0000-0000-000000000001',
  current_setting('sci.professional_id')::uuid, 'monthly', current_date, current_date + 30, 'trial',
  now()
);

select is(
  public.org_property_limit('5c5c0000-0000-0000-0000-000000000001'::uuid),
  (select (feature_limits ->> 'maxProperties')::int from public.plans where code = 'professional_monthly'),
  'org_property_limit() resolves the later-created (Professional) row when current_period_start ties'
);
select is(
  public.org_staff_seat_limit('5c5c0000-0000-0000-0000-000000000001'::uuid),
  (select (feature_limits ->> 'maxStaff')::int from public.plans where code = 'professional_monthly'),
  'org_staff_seat_limit() resolves the later-created row when current_period_start ties'
);
select is(
  public.org_owner_limit('5c5c0000-0000-0000-0000-000000000001'::uuid),
  (select (feature_limits ->> 'includedOwners')::int from public.plans where code = 'professional_monthly'),
  'org_owner_limit() resolves the later-created row when current_period_start ties'
);
select is(
  public.org_feature_enabled('5c5c0000-0000-0000-0000-000000000001'::uuid, 'ownerPortalEnabled'),
  (select (feature_limits ->> 'ownerPortalEnabled')::boolean from public.plans where code = 'professional_monthly'),
  'org_feature_enabled() resolves the later-created row when current_period_start ties'
);

-- ============================================================
-- Part 3: same-day plan change never creates a second current row -- confirm_plan_change()'s
-- upgrade/no_change branches UPDATE the existing row in place, exactly as before this fix (the
-- tiebreaker addition does not change this -- this is a regression check, not new behavior).
-- ============================================================
-- A trial-status org's downgrade is effective immediately (compute_plan_change_quote's own
-- PRODUCT DECISION, unchanged by this fix) -- amount_due_now is always 0 for a downgrade, so this
-- is the same-day change that actually completes synchronously and flips plan_id in place, the
-- cleanest observable proof the fix didn't disturb the existing single-row-per-org update pattern.
delete from public.organization_subscriptions where org_id = '5c5c0000-0000-0000-0000-000000000001';
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values ('5c5c0000-0000-0000-0000-000000000001', current_setting('sci.professional_id')::uuid, 'monthly', current_date, current_date + 30, 'trial');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '5c000000-0000-0000-0000-000000000001')::text, true);

select public.create_plan_change_quote('5c5c0000-0000-0000-0000-000000000001'::uuid, current_setting('sci.starter_id')::uuid);
select public.confirm_plan_change((select id from public.billing_change_quotes where org_id = '5c5c0000-0000-0000-0000-000000000001' order by created_at desc limit 1));

reset role;

select is(
  (select count(*)::int from public.organization_subscriptions where org_id = '5c5c0000-0000-0000-0000-000000000001'),
  1, 'a same-day downgrade (confirm_plan_change) still updates the one existing row in place -- no second row, no ambiguity possible'
);
select is(
  (select plan_id from public.organization_subscriptions where org_id = '5c5c0000-0000-0000-0000-000000000001'),
  current_setting('sci.starter_id')::uuid,
  'the single row was correctly flipped to the new (Starter) plan -- a trial-status downgrade completes immediately'
);
select is(
  (select status from public.billing_plan_changes where org_id = '5c5c0000-0000-0000-0000-000000000001' order by requested_at desc limit 1),
  'completed', 'the downgrade billing_plan_changes row is marked completed, not left awaiting_payment/scheduled'
);

-- ============================================================
-- Part 4: the migration's own dirty-data guard -- proven directly (same query, isolated in a
-- pg_temp function so it can be called from throws_ok without nested dollar-quoting), not just
-- described. Uses a fresh org so it never touches the fixture above.
-- ============================================================
insert into public.organizations (id, legal_name, org_type, status)
values ('5c5c0000-0000-0000-0000-000000000099', 'Subscription Integrity Guard Test Org', 'agency', 'trial');
-- Punch a hole through the index this test file itself just proved exists, purely to exercise the
-- guard query against genuinely dirty data (dropped/recreated inside this one transaction, fully
-- undone by the outer `rollback;` below).
alter table public.organization_subscriptions drop constraint if exists organization_subscriptions_one_current_per_org;
drop index if exists public.organization_subscriptions_one_current_per_org;
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values ('5c5c0000-0000-0000-0000-000000000099', current_setting('sci.professional_id')::uuid, 'monthly', current_date, current_date + 30, 'trial');
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values ('5c5c0000-0000-0000-0000-000000000099', current_setting('sci.professional_id')::uuid, 'monthly', current_date, current_date + 30, 'trial');

create function pg_temp.check_subscription_integrity_guard() returns void as $guard$
declare
  v_dupe_count integer;
begin
  select count(*) into v_dupe_count
  from (
    select org_id
    from public.organization_subscriptions
    where status in ('trial', 'active')
    group by org_id
    having count(*) > 1
  ) dupes;
  if v_dupe_count > 0 then
    raise exception 'subscription_integrity_guard: % organization(s) still have more than one trial/active row', v_dupe_count;
  end if;
end;
$guard$ language plpgsql;

select throws_ok(
  $$select pg_temp.check_subscription_integrity_guard()$$,
  'subscription_integrity_guard: 1 organization(s) still have more than one trial/active row',
  'the migration''s own guard raises and refuses to proceed while a duplicate current-row org exists'
);

-- Clean up the deliberately-dirty guard-test data before recreating the index (mirrors what the
-- real reviewed cleanup step must do in production before migration 20260101000126 can succeed).
delete from public.organization_subscriptions
  where org_id = '5c5c0000-0000-0000-0000-000000000099'
  and id not in (
    select id from public.organization_subscriptions
    where org_id = '5c5c0000-0000-0000-0000-000000000099'
    order by created_at asc limit 1
  );

create unique index organization_subscriptions_one_current_per_org
  on public.organization_subscriptions (org_id)
  where status in ('trial', 'active');

select ok(
  (select count(*)::int from pg_indexes where indexname = 'organization_subscriptions_one_current_per_org') = 1,
  'organization_subscriptions_one_current_per_org index exists'
);

select * from finish();
rollback;
