-- Tests for 20260101000076_subscription_lifecycle.sql: expire_trials_and_suspend_overdue() moves
-- a trial past trial_ends_at, and an org overdue for more than 7 days, to 'suspended' -- and
-- leaves everything not yet due untouched. trials_expiring_soon() surfaces reminder candidates
-- without ever re-surfacing one already reminded.

begin;
select plan(9);

insert into public.organizations (id, legal_name, org_type, status, trial_ends_at) values
  ('b1000000-0000-0000-0000-000000000001', 'Expired Trial Org', 'agency', 'trial', now() - interval '1 day'),
  ('b1000000-0000-0000-0000-000000000002', 'Active Trial Org', 'agency', 'trial', now() + interval '20 days'),
  ('b1000000-0000-0000-0000-000000000003', 'Reminder Window Org', 'agency', 'trial', now() + interval '2 days'),
  ('b1000000-0000-0000-0000-000000000004', 'Already Reminded Org', 'agency', 'trial', now() + interval '2 days');

update public.organizations set trial_reminder_sent_at = now() - interval '1 hour'
  where id = 'b1000000-0000-0000-0000-000000000004';

insert into public.organizations (id, legal_name, org_type, status, overdue_since) values
  ('b1000000-0000-0000-0000-000000000005', 'Long Overdue Org', 'agency', 'overdue', now() - interval '8 days'),
  ('b1000000-0000-0000-0000-000000000006', 'Recently Overdue Org', 'agency', 'overdue', now() - interval '2 days');

select results_eq(
  $$ select org_id, previous_status, new_status, reason
     from public.expire_trials_and_suspend_overdue()
     order by org_id $$,
  $$ values
     ('b1000000-0000-0000-0000-000000000001'::uuid, 'trial'::public.organization_status, 'suspended'::public.organization_status, 'trial_expired'::text),
     ('b1000000-0000-0000-0000-000000000005'::uuid, 'overdue'::public.organization_status, 'suspended'::public.organization_status, 'overdue_grace_period_expired'::text) $$,
  'exactly the expired trial and the long-overdue org are transitioned, nothing else'
);

select is(
  (select status from public.organizations where id = 'b1000000-0000-0000-0000-000000000001'),
  'suspended'::public.organization_status,
  'the expired trial org is now suspended'
);

select is(
  (select status from public.organizations where id = 'b1000000-0000-0000-0000-000000000002'),
  'trial'::public.organization_status,
  'a trial not yet past trial_ends_at is left untouched'
);

select is(
  (select status from public.organizations where id = 'b1000000-0000-0000-0000-000000000005'),
  'suspended'::public.organization_status,
  'an org overdue for more than 7 days is now suspended'
);

select is(
  (select status from public.organizations where id = 'b1000000-0000-0000-0000-000000000006'),
  'overdue'::public.organization_status,
  'an org overdue for only 2 days is left untouched -- still inside the 7-day grace period'
);

select is(
  (select count(*) from public.expire_trials_and_suspend_overdue()),
  0::bigint,
  'running the function again is a no-op -- both orgs already transitioned, nothing left to do'
);

select results_eq(
  $$ select org_id from public.trials_expiring_soon(3) order by org_id $$,
  $$ values ('b1000000-0000-0000-0000-000000000003'::uuid) $$,
  'only the org expiring within the window that has never been reminded is surfaced -- not the one already reminded, not the one 20 days out'
);

select is(
  (select count(*) from public.trials_expiring_soon(3) where org_id = 'b1000000-0000-0000-0000-000000000004'),
  0::bigint,
  'an org already reminded (trial_reminder_sent_at set) is never surfaced again'
);

select is(
  (select count(*) from public.trials_expiring_soon(3) where org_id = 'b1000000-0000-0000-0000-000000000002'),
  0::bigint,
  'an org 20 days from expiry falls outside the 3-day reminder window'
);

select * from finish();
rollback;
