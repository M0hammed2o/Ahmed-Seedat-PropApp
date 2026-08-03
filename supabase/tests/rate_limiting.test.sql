-- Tests for check_rate_limit() (migration 20260101000058, PWA_V1_COMPLETION_PLAN.md #19,
-- TECHNICAL_DEBT_REGISTER.md TD-10). Plain function tests, not RLS isolation -- the function is
-- SECURITY DEFINER and meant to be called by anon/authenticated/service_role alike, so there is
-- no per-role isolation boundary to probe here; the interesting behavior is the counting/window
-- logic itself.

begin;
select plan(7);

-- === Basic counting: allowed while under the limit, blocked the instant it's exceeded ===
select is(public.check_rate_limit('test:basic', 3, 60), true, 'request 1 of 3 allowed');
select is(public.check_rate_limit('test:basic', 3, 60), true, 'request 2 of 3 allowed');
select is(public.check_rate_limit('test:basic', 3, 60), true, 'request 3 of 3 allowed');
select is(public.check_rate_limit('test:basic', 3, 60), false, 'request 4 (over the limit of 3) is rejected');
select is(public.check_rate_limit('test:basic', 3, 60), false, 'request 5 stays rejected (does not silently reset)');

-- === Independent keys never share a bucket ===
select is(public.check_rate_limit('test:other-key', 3, 60), true, 'a different bucket_key starts its own independent count, unaffected by test:basic being exhausted');

-- === Window expiry resets the counter ===
-- Backdate the bucket's window_start so it reads as already elapsed for a 1-second window,
-- rather than sleeping in the test -- exercises the same "window_start <= now() - interval"
-- branch a real elapsed window would hit, without making the suite slow.
update public.rate_limit_buckets set window_start = now() - interval '2 seconds' where bucket_key = 'test:basic';
select is(public.check_rate_limit('test:basic', 3, 1), true, 'once the window has elapsed, the counter resets and the next request is allowed again');

select * from finish();
rollback;
