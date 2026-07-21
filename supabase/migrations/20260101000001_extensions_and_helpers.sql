-- Extensions and shared helper functions/triggers used by every subsequent migration.

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";        -- case-insensitive text (email-like fields)

-- Generic updated_at trigger function, attached per-table below.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Sets updated_at = now() on any row update. Attach via a BEFORE UPDATE trigger per table.';
