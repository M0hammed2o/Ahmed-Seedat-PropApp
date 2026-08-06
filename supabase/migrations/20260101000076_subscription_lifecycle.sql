-- Commercial-launch execution plan, Stage 4 (Phase 2 — Commercial SaaS, WORKLOG.md this date):
-- closes the subscription lifecycle loop. Access-control enforcement for every status
-- (trial/active/overdue/suspended/cancelled) already existed (has_org_role(), 20260101000055) --
-- what was missing was anything that ever MOVED an org between those statuses on its own. Trial
-- expiry specifically had no anchor at all: organizations.status defaulted to 'trial' with no
-- record of when the trial started or should end (20260101000075 added trial_ends_at to fix
-- that); this migration adds the anchor for the overdue-grace-period side of the same problem and
-- the actual function that performs both transitions.

alter table public.organizations
  add column overdue_since timestamptz,
  add column trial_reminder_sent_at timestamptz;

comment on column public.organizations.overdue_since is
  'Set when a payment_failed webhook first moves this org to ''overdue'' (lib/billing.ts); cleared
   when a subsequent payment succeeds. The anchor expire_trials_and_suspend_overdue() uses to
   decide when an overdue org''s grace period has run out.';

-- expire_trials_and_suspend_overdue(): the callable surface for both lifecycle transitions, same
-- "real function, no production scheduler wired to it yet" posture as
-- generate_rent_schedules_for_active_leases() (TD-20) -- a hosting-platform cron job calls this
-- once a deployment target is chosen (TASKS.md M24), not before.
--   1. trial expired (trial_ends_at < now()), no payment received: LOCK access -- moves straight
--      to 'suspended' (has_org_role() already treats this as read-only, matching the directive's
--      own "lock access to the application while preserving data" wording exactly), not through
--      an intermediate 'overdue' -- 'overdue' specifically means "was paying, a charge failed,"
--      a materially different situation from a trial that was never paid for at all.
--   2. an already-overdue org (a real subscriber whose recurring charge failed) gets a 7-day
--      grace period from overdue_since before also moving to 'suspended' -- PayFast/any gateway
--      may itself retry a failed recurring charge during this window; a payment_succeeded webhook
--      arriving in that time clears overdue_since (lib/billing.ts) and this function never touches
--      that org.
create or replace function public.expire_trials_and_suspend_overdue()
returns table(org_id uuid, previous_status public.organization_status, new_status public.organization_status, reason text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.organizations o
  set status = 'suspended'
  where o.status = 'trial' and o.trial_ends_at is not null and o.trial_ends_at < now()
  returning o.id, 'trial'::public.organization_status, o.status, 'trial_expired'::text;

  return query
  update public.organizations o
  set status = 'suspended'
  where o.status = 'overdue' and o.overdue_since is not null and o.overdue_since < now() - interval '7 days'
  returning o.id, 'overdue'::public.organization_status, o.status, 'overdue_grace_period_expired'::text;
end;
$$;

comment on function public.expire_trials_and_suspend_overdue() is
  'Returns one row per organization actually transitioned this run (empty table if none were due)
   -- the caller (POST /api/v1/system/check-subscriptions) uses this to report exactly what
   happened, same shape as generate_rent_schedules_for_active_leases()''s own return table.';

-- trials_expiring_soon(): the "automated reminders before expiry" half of the directive, split
-- into its own read-only function (not folded into the function above, which only ever
-- transitions status) so the reminder email dispatch -- itself outside this function, staying in
-- application code alongside every other dispatchEmail() call site in this codebase -- can be
-- retried/logged independently of the suspend logic.
create or replace function public.trials_expiring_soon(p_within_days integer default 3)
returns table(org_id uuid, legal_name text, trial_ends_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select o.id, o.legal_name, o.trial_ends_at
  from public.organizations o
  where o.status = 'trial'
    and o.trial_ends_at is not null
    and o.trial_ends_at between now() and now() + make_interval(days => p_within_days)
    and o.trial_reminder_sent_at is null;
$$;
