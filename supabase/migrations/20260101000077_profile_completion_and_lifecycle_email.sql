-- Production signup/onboarding hardening (WORKLOG.md this date).
--
-- Three independent additions, each addressing a real gap found by tracing the current
-- signup/login flow before writing any app code:
--
-- 1. `profiles` gains real name/phone/completion columns. Today it only has `display_name` --
--    there is no server-owned way to know a customer's first/last name, phone number, or whether
--    they've ever completed the "Complete Your Account" step. `onboarding_step` already exists
--    but has never been read or written by any app code (confirmed by repo-wide grep) -- left
--    alone rather than repurposed, to avoid silently changing the meaning of an unused column.
--
-- 2. `user_terms_acceptances` gains a uniqueness constraint. The table itself already existed,
--    correctly designed (append-only, RLS'd) -- but had zero writers anywhere in the app, and no
--    constraint to make a write idempotent. Without this, a retried consent submission would
--    insert duplicate acceptance rows for the same (user, document, version).
--
-- 3. New `user_lifecycle_events` table for the welcome email. `email_messages.org_id` is NOT NULL
--    (every existing template is an org-scoped business event), but a welcome email must fire
--    before any organization exists. Rather than weakening that constraint (touching 9 existing
--    templates' RLS/query assumptions) or inventing a fake organization membership, this is a
--    separate, deliberately minimal outbox table scoped to user-lifecycle events. The unique
--    constraint on (user_id, event_type, template_version) is the exactly-once mechanism itself:
--    concurrent callers race to INSERT, exactly one wins, the other gets a unique-violation and
--    treats it as "already handled" -- a real claim-then-send, not a check-then-send race.

alter table public.profiles
  add column first_name text,
  add column last_name text,
  add column phone_e164 text,
  add column profile_completed_at timestamptz;

alter table public.profiles
  add constraint profiles_phone_e164_format
  check (phone_e164 is null or phone_e164 ~ '^\+[1-9]\d{1,14}$');

comment on column public.profiles.profile_completed_at is
  'Set once, server-side, when the Complete Your Account form is successfully submitted. The '
  'authoritative completion marker -- never inferred client-side, never re-derived from whether '
  'the other fields happen to be non-null (a user who later clears an optional field should not '
  'silently become "incomplete" again).';

create unique index user_terms_acceptances_unique_idx
  on public.user_terms_acceptances (user_id, document_type, version);

create table public.user_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('welcome_email')),
  template_version text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, event_type, template_version)
);

create index user_lifecycle_events_user_idx on public.user_lifecycle_events (user_id);

-- No client-facing RLS policies: this table is written and read exclusively by server routes via
-- the service-role client (the same posture as `email_messages`' own service-role-only writes),
-- never exposed to a client bundle. RLS is still enabled so a future accidental anon/authenticated
-- grant fails closed rather than open.
alter table public.user_lifecycle_events enable row level security;
