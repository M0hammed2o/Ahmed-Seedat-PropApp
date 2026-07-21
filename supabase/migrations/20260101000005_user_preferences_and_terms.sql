create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  biometric_enabled boolean not null default false,
  lock_timeout_seconds integer not null default 60 check (lock_timeout_seconds >= 0),
  default_country text not null default 'ZA',
  quiet_hours_start_minute integer check (quiet_hours_start_minute between 0 and 1439),
  quiet_hours_end_minute integer check (quiet_hours_end_minute between 0 and 1439),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

alter table public.user_preferences enable row level security;

create policy "user_preferences_all_own"
  on public.user_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.user_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('terms_of_service', 'privacy_policy')),
  version text not null,
  accepted_at timestamptz not null default now()
);

create index user_terms_acceptances_user_id_idx on public.user_terms_acceptances (user_id);

alter table public.user_terms_acceptances enable row level security;

create policy "user_terms_acceptances_select_own"
  on public.user_terms_acceptances for select
  using (user_id = auth.uid());

create policy "user_terms_acceptances_insert_own"
  on public.user_terms_acceptances for insert
  with check (user_id = auth.uid());

-- Append-only: no update/delete policy exists, so acceptance history can never be edited or
-- deleted by a client — it's the audit trail for what was agreed to and when.
