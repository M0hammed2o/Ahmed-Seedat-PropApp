-- Commercial plan restructure (WORKLOG.md this date): owner-limit enforcement, purchased add-on
-- capacity, trial-eligibility matching, and downgrade resource locking (reconcile_plan_limits()).

begin;
select plan(14);

insert into auth.users (id, email) values
  ('cc000000-0000-0000-0000-000000000001', 'cpr-principal@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type, status)
values ('cccc0000-0000-0000-0000-000000000001', 'Commercial Restructure Test Org', 'agency', 'active');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('cccc0000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'principal', 'active', now());

select set_config('cpr.org_id', 'cccc0000-0000-0000-0000-000000000001', false);
select set_config('cpr.professional_id', (select id::text from public.plans where code = 'professional_monthly'), false);
select set_config('cpr.starter_id', (select id::text from public.plans where code = 'starter_monthly'), false);

-- === Professional: 2 included owners, R199/extra ===
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  current_setting('cpr.org_id')::uuid, current_setting('cpr.professional_id')::uuid, 'monthly',
  current_date, current_date + 30, 'active'
);

select is(
  (select public.org_owner_limit(current_setting('cpr.org_id')::uuid)), 2,
  'Professional org_owner_limit() = included 2, no add-ons purchased yet'
);
select is(
  (select public.available_owner_slots(current_setting('cpr.org_id')::uuid)), 2,
  'available_owner_slots() = 2 with zero owners created'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'cc000000-0000-0000-0000-000000000001';

insert into public.owners (id, org_id, owner_type, name) values
  ('cccc0000-0000-0000-0000-000000000101', current_setting('cpr.org_id')::uuid, 'individual', 'Owner One'),
  ('cccc0000-0000-0000-0000-000000000102', current_setting('cpr.org_id')::uuid, 'individual', 'Owner Two');

select is(
  (select public.available_owner_slots(current_setting('cpr.org_id')::uuid)), 0,
  'available_owner_slots() = 0 after using both included owner slots'
);

select throws_ok(
  $$insert into public.owners (org_id, owner_type, name) values ('cccc0000-0000-0000-0000-000000000001'::uuid, 'individual', 'Owner Three')$$,
  'new row violates row-level security policy for table "owners"',
  'a 3rd owner is refused by RLS once Professional''s 2-owner allowance is exhausted'
);

reset role;

-- Purchase 1 extra owner slot -- the add-on must be a real, persisted number, not a UI-only fake.
update public.organization_subscriptions
  set purchased_extra_owner_slots = 1
  where org_id = current_setting('cpr.org_id')::uuid;

select is(
  (select public.available_owner_slots(current_setting('cpr.org_id')::uuid)), 1,
  'purchasing 1 extra owner slot genuinely raises available_owner_slots() to 1'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'cc000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into public.owners (org_id, owner_type, name) values ('cccc0000-0000-0000-0000-000000000001'::uuid, 'individual', 'Owner Three')$$,
  'the 3rd owner succeeds once the extra slot is purchased'
);
reset role;

-- === Starter never gets an external owner, ever (includedOwners = 0, not null) ===
insert into public.organizations (id, legal_name, org_type, status)
values ('cccc0000-0000-0000-0000-000000000002', 'Starter Owner Block Test', 'agency', 'active');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('cccc0000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'cccc0000-0000-0000-0000-000000000002', current_setting('cpr.starter_id')::uuid, 'monthly',
  current_date, current_date + 30, 'active'
);
select is(
  (select public.available_owner_slots('cccc0000-0000-0000-0000-000000000002'::uuid)), 0,
  'Starter available_owner_slots() = 0 (includedOwners is explicitly 0, never unlimited/null)'
);

-- === Trial eligibility matching ===
insert into public.trial_usage_records (org_id, principal_user_id, payment_provider_reference, verified_phone_e164)
values (
  'cccc0000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001',
  'pf-token-abc123', '+27821234567'
);
select ok(
  (select public.has_used_trial_before('cc000000-0000-0000-0000-000000000001'::uuid)),
  'has_used_trial_before() true for the exact same principal_user_id'
);
select ok(
  (select public.has_used_trial_before('cc000000-0000-0000-0000-000000000099'::uuid, 'pf-token-abc123')),
  'has_used_trial_before() true for a DIFFERENT principal reusing the same payment_provider_reference'
);
select ok(
  (select public.has_used_trial_before('cc000000-0000-0000-0000-000000000099'::uuid, null, '+27821234567')),
  'has_used_trial_before() true for a DIFFERENT principal reusing the same verified phone number'
);
select ok(
  not (select public.has_used_trial_before('cc000000-0000-0000-0000-000000000099'::uuid, 'pf-totally-different', '+27000000000', 'REG999')),
  'has_used_trial_before() false when no signal matches at all -- a genuinely new principal/instrument'
);

-- === Downgrade resource locking: reconcile_plan_limits() restricts excess, never deletes ===
-- Org 1 now has 3 owners (Starter allows 0) -- downgrade it and reconcile.
update public.organization_subscriptions
  set plan_id = current_setting('cpr.starter_id')::uuid, purchased_extra_owner_slots = 0
  where org_id = current_setting('cpr.org_id')::uuid;
select public.reconcile_plan_limits(current_setting('cpr.org_id')::uuid);

select is(
  (select count(*)::int from public.owners where org_id = current_setting('cpr.org_id')::uuid),
  3,
  'reconcile_plan_limits() never deletes a row -- all 3 owners still exist in the table'
);
select is(
  (select count(*)::int from public.owners where org_id = current_setting('cpr.org_id')::uuid and restricted_by_plan = true),
  3,
  'all 3 owners are flagged restricted_by_plan after downgrading to Starter (0 included)'
);

-- Upgrade back to Professional (2 included + purchase 1 more = 3) and reconcile -- capacity
-- restored, restriction lifted automatically.
update public.organization_subscriptions
  set plan_id = current_setting('cpr.professional_id')::uuid, purchased_extra_owner_slots = 1
  where org_id = current_setting('cpr.org_id')::uuid;
select public.reconcile_plan_limits(current_setting('cpr.org_id')::uuid);
select is(
  (select count(*)::int from public.owners where org_id = current_setting('cpr.org_id')::uuid and restricted_by_plan = true),
  0,
  'restoring capacity (upgrade) automatically lifts restricted_by_plan on reconcile -- access returns without re-creating anything'
);

select * from finish();
rollback;
