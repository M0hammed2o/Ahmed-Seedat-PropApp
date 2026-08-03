-- PWA_V1_COMPLETION_PLAN.md #19, TECHNICAL_DEBT_REGISTER.md TD-10: `packages/config`'s
-- `RATE_LIMITS` has been a scaffolded constant set with no backing store since SECURITY.md was
-- first written. Postgres-backed (not a real external KV store, which the plan itself flags as
-- out of scope for this environment) -- a single-row-per-key fixed-window counter, reset
-- atomically the moment the window elapses via one UPSERT statement, so concurrent requests can
-- never race past the limit.

create table public.rate_limit_buckets (
  bucket_key text primary key,
  window_start timestamptz not null default now(),
  request_count integer not null default 0
);

-- No client policy at all -- deny-by-default, same pattern as admin_users/encrypted_secrets.
-- Only ever touched via check_rate_limit() below (SECURITY DEFINER, bypasses RLS on its own
-- internal query regardless).
alter table public.rate_limit_buckets enable row level security;

-- Atomically increments the counter for p_bucket_key, resetting it to 1 if the current window has
-- already elapsed, and returns whether the request is still within p_limit. security definer so
-- it works identically for an anonymous caller (the billing webhook has no session at all) and an
-- authenticated one (e.g. invite-accept) -- default privileges already grant EXECUTE to
-- anon/authenticated/service_role (migration 20260101000024), no extra grant needed.
create or replace function public.check_rate_limit(p_bucket_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count integer;
begin
  insert into public.rate_limit_buckets (bucket_key, window_start, request_count)
  values (p_bucket_key, v_now, 1)
  on conflict (bucket_key) do update
    set request_count = case
          when public.rate_limit_buckets.window_start <= v_now - make_interval(secs => p_window_seconds)
            then 1
          else public.rate_limit_buckets.request_count + 1
        end,
        window_start = case
          when public.rate_limit_buckets.window_start <= v_now - make_interval(secs => p_window_seconds)
            then v_now
          else public.rate_limit_buckets.window_start
        end
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

comment on function public.check_rate_limit(text, integer, integer) is
  'Increments the fixed-window request counter for p_bucket_key (creating it if absent), resetting
   to 1 if the window (p_window_seconds) has elapsed since it was last reset. Returns true if the
   request is within p_limit, false if the caller should be rejected with 429. One UPSERT, so
   concurrent callers for the same key are serialized by Postgres''s own row lock -- no separate
   read-then-write race window.';
