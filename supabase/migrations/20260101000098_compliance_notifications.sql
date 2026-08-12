-- Property compliance workflow, notification lifecycle completion (WORKLOG.md this date --
-- follow-up to migration 20260101000097, which only wired "requirement assigned"). Adds the
-- 'compliance' notification category so the org-level (organization_notification_settings) and
-- per-user (notification_preferences) channel-preference architecture -- already used by
-- 'maintenance' -- can gate the two genuinely opt-out-able notifications this pass adds (staff's
-- "acknowledgement received" FYI, and due-soon/overdue reminders). The tenant-facing "you've been
-- assigned a rule" email stays ungated/transactional (same reasoning tenant_invitation already
-- documents: a recipient can't meaningfully opt out of the one message telling them action is
-- required) -- unchanged from migration 097.

alter type public.notification_category add value if not exists 'compliance';

-- Idempotency markers for the due-soon/overdue reminder sweep (see the two functions below) --
-- without these, a sweep run twice in the same window would re-send the same reminder. Both
-- nullable/additive; existing rows are unaffected.
alter table public.compliance_requirements
  add column due_reminder_sent_at timestamptz,
  add column overdue_reminder_sent_at timestamptz;

-- Candidates for a "due soon" reminder: still outstanding, has a due date, that due date is in
-- the future but within p_within_days, and no reminder has been sent yet for it. SECURITY
-- DEFINER + service-role-only caller (the /api/v1/system/check-compliance-requirements route,
-- mirroring check-subscriptions'/generate-rent-schedules' own dual-auth pattern) -- this is a
-- read used by a trusted server process, not exposed to ordinary client roles.
create or replace function public.compliance_requirements_due_soon(p_within_days integer default 3)
returns setof public.compliance_requirements
language sql
security definer
set search_path = public
stable
as $$
  select *
  from public.compliance_requirements
  where status in ('pending', 'viewed')
    and due_at is not null
    and due_at > now()
    and due_at <= now() + (p_within_days || ' days')::interval
    and due_reminder_sent_at is null;
$$;

-- Candidates for an overdue reminder: still outstanding, past its due date, not yet reminded.
create or replace function public.compliance_requirements_overdue_unreminded()
returns setof public.compliance_requirements
language sql
security definer
set search_path = public
stable
as $$
  select *
  from public.compliance_requirements
  where status in ('pending', 'viewed')
    and due_at is not null
    and due_at <= now()
    and overdue_reminder_sent_at is null;
$$;

revoke all on function public.compliance_requirements_due_soon(integer) from public;
revoke all on function public.compliance_requirements_overdue_unreminded() from public;
grant execute on function public.compliance_requirements_due_soon(integer) to service_role;
grant execute on function public.compliance_requirements_overdue_unreminded() to service_role;

comment on function public.compliance_requirements_due_soon(integer) is
  'Candidates for a due-soon reminder email. No production scheduler calls this yet (same
   disclosed gap as expire_trials_and_suspend_overdue()/generate_rent_schedules() -- blocked on
   the Stage 8 hosting decision, TASKS.md); POST /api/v1/system/check-compliance-requirements
   exercises it on demand (super_admin session or CRON_JOB_SECRET bearer) so the event/data
   support is real and testable ahead of a scheduler being wired up.';
