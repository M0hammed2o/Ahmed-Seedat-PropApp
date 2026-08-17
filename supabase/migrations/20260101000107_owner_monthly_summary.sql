-- WhatsApp V1 final pre-production pass, Phases 3-6 (WORKLOG.md this date). Additive only --
-- new enum value, one new nullable column, one new table. Nothing existing is altered or dropped.
-- NOT deployed to production by this migration file existing locally; deployment is a separate,
-- explicitly-approved step (see TECHNICAL_DEBT_REGISTER.md / the final report for this pass).

-- === Phase 3: a dedicated notification_preferences category for the monthly owner summary,
--     independent of 'rent' (an owner may want rent/payment alerts but not a monthly digest, or
--     vice versa). Postgres requires ADD VALUE to commit before the new label can be used in a
--     DML statement -- this migration only adds the label; every INSERT/UPDATE referencing it
--     happens in later, separate transactions (application code, or a later migration/test file),
--     never in this same file. ===
alter type public.notification_category add value if not exists 'owner_summary';

-- Per-user preferred day-of-month for any category that is scheduled rather than event-triggered
-- (today: only owner_summary). Nullable -- no row/no value means "use the platform default day"
-- (day 1 of the month), resolved in application code (lib/ownerSummary.ts), not defaulted here,
-- so the default can change without a migration.
alter table public.notification_preferences
  add column preferred_summary_day smallint
    check (preferred_summary_day is null or preferred_summary_day between 1 and 28);

-- === Phase 4/5/6: owner_property_summaries -- one durable, immutable-once-generated snapshot per
--     (owner_user_id, period_start). Immutable by convention (application code never updates the
--     financial snapshot columns after insert) so the numbers an owner sees on the detail page
--     (Phase 6) always match what was true when the summary was generated, even if rent_schedules/
--     payment_reports change later in the month. sent_at/whatsapp_message_id are the only columns
--     ever updated after insert -- delivery status catching up to an already-computed snapshot,
--     never a recompute. This is also the row dispatchWhatsApp()'s own idempotency check keys off
--     (relatedEntityType='owner_property_summary', relatedEntityId=this row's id), so a redelivered
--     daily-jobs run can never double-send the same month's summary to the same owner.
create table public.owner_property_summaries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  property_count integer not null default 0,
  expected_rent numeric(12, 2) not null default 0,
  confirmed_paid numeric(12, 2) not null default 0,
  outstanding numeric(12, 2) not null default 0,
  awaiting_confirmation numeric(12, 2) not null default 0,
  open_maintenance_count integer not null default 0,
  upcoming_lease_expiry_count integer not null default 0,
  generated_at timestamptz not null default now(),
  sent_at timestamptz,
  whatsapp_message_id uuid references public.whatsapp_messages(id),
  created_at timestamptz not null default now(),
  unique (owner_user_id, period_start)
);

create index owner_property_summaries_org_idx on public.owner_property_summaries (org_id);
create index owner_property_summaries_owner_user_idx
  on public.owner_property_summaries (owner_user_id, period_start desc);

alter table public.owner_property_summaries enable row level security;

-- Owner reads their own summaries (the detail page, Phase 6).
create policy "owner_property_summaries_select_owner_self"
  on public.owner_property_summaries for select
  using (owner_user_id = auth.uid());

-- Org staff (manager+, same floor as viewing organization-level accounting/statements) can review
-- what was sent to owners in their own org.
create policy "owner_property_summaries_select_staff"
  on public.owner_property_summaries for select
  using (public.has_org_role(org_id, 'manager'));

-- No client insert/update/delete policy -- generated and updated only by the daily-jobs sweep via
-- the service-role client, matching audit_events/usage_events' own "privileged, system-written"
-- convention. Nothing here is client-writable by design.
