-- Schema-layer regression tests for migration 20260101000077 (production signup/onboarding).
-- API-route-level logic (profile completion, legal consent, welcome email) is covered by the real
-- Vitest/Playwright suites per this session's established pattern -- this file only exercises
-- what's genuinely a database-layer concern: new columns/constraints exist and behave correctly,
-- the new uniqueness constraint actually prevents duplicates, and user_lifecycle_events fails
-- closed (no client-facing RLS policy at all) for an anon/authenticated caller.

begin;
select plan(11);

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'pc-user-a@test.propertyvault.example'),
  ('c2000000-0000-0000-0000-000000000001', 'pc-user-b@test.propertyvault.example');

-- === profiles: new columns exist ===
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'first_name'),
  1, 'profiles.first_name exists'
);
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'last_name'),
  1, 'profiles.last_name exists'
);
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone_e164'),
  1, 'profiles.phone_e164 exists'
);
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'profile_completed_at'),
  1, 'profiles.profile_completed_at exists'
);

-- === profiles.phone_e164 format constraint ===
-- Both test users already have an auto-created profiles row (on_auth_user_created trigger).
select lives_ok(
  $$ update public.profiles set phone_e164 = '+27821234567' where id = 'c1000000-0000-0000-0000-000000000001' $$,
  'a well-formed E.164 phone number is accepted'
);
select throws_ok(
  $$ update public.profiles set phone_e164 = '0821234567' where id = 'c1000000-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a bare local-format (non-E.164) phone number is rejected at the database layer'
);
select lives_ok(
  $$ update public.profiles set phone_e164 = null where id = 'c1000000-0000-0000-0000-000000000001' $$,
  'phone_e164 is nullable -- an incomplete profile is a valid row, not a constraint violation'
);

-- === user_terms_acceptances: uniqueness constraint (migration 20260101000077) ===
insert into public.user_terms_acceptances (user_id, document_type, version)
values ('c1000000-0000-0000-0000-000000000001', 'terms_of_service', 'v1-placeholder-2026-08-03');

select throws_ok(
  $$ insert into public.user_terms_acceptances (user_id, document_type, version)
     values ('c1000000-0000-0000-0000-000000000001', 'terms_of_service', 'v1-placeholder-2026-08-03') $$,
  '23505',
  null,
  'a duplicate (user_id, document_type, version) acceptance is rejected, not silently duplicated'
);
select lives_ok(
  $$ insert into public.user_terms_acceptances (user_id, document_type, version)
     values ('c1000000-0000-0000-0000-000000000001', 'privacy_policy', 'v1-placeholder-2026-08-03') $$,
  'a different document_type for the same user is a distinct, allowed row'
);

-- === user_lifecycle_events: RLS fails closed (no client-facing policy at all) ===
insert into public.user_lifecycle_events (user_id, event_type, template_version, status)
values ('c1000000-0000-0000-0000-000000000001', 'welcome_email', 'v1', 'pending');

set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.user_lifecycle_events),
  0,
  'an authenticated user cannot read their own user_lifecycle_events row -- no client-facing policy exists, service-role only'
);
select throws_ok(
  $$ insert into public.user_lifecycle_events (user_id, event_type, template_version, status)
     values ('c1000000-0000-0000-0000-000000000001', 'welcome_email', 'v2', 'pending') $$,
  '42501',
  null,
  'an authenticated user cannot insert into user_lifecycle_events either'
);
reset role;

select * from finish();
rollback;
