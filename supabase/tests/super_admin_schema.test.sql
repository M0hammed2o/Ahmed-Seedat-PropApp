-- Schema-layer regression tests for TASKS.md M19 (Super Admin): the platform_admin_users rename,
-- admin_organization_counts()'s EXECUTE-grant guard (applying the resolve_whatsapp_sender()
-- lesson proactively, DECISIONS.md 2026-07-31), and two real bugs found and fixed while building
-- this milestone (plans' contradictory UNIQUE constraint, organizations.status missing
-- 'archived'). API-route-level logic (the actual admin endpoints) is covered by the real
-- `next build`/typecheck/lint pass per this session's established pattern -- this file only
-- exercises what's genuinely a database-layer concern.

begin;
select plan(9);

-- === platform_admin_users rename (migration 20260101000044) ===
select is(
  (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name = 'platform_admin_users'),
  1,
  'platform_admin_users exists (renamed from admin_users)'
);
select is(
  (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name = 'admin_users'),
  0,
  'admin_users no longer exists'
);
select is(
  (select count(*)::int from pg_proc where proname = 'is_platform_admin'),
  1,
  'is_platform_admin() exists (renamed from is_admin())'
);
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'support_access_sessions' and column_name = 'platform_admin_id'),
  1,
  'support_access_sessions.platform_admin_id exists (renamed from admin_user_id)'
);

-- === admin_organization_counts(): EXECUTE must be revoked from anon/authenticated, matching the
--     resolve_whatsapp_sender() lesson -- this function returns cross-org aggregate counts for
--     any org id array the caller supplies, unscoped by caller identity. ===
set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000000';
select throws_ok(
  $$ select * from public.admin_organization_counts(array['00000000-0000-0000-0000-000000000000'::uuid]) $$,
  '42501',
  'permission denied for function admin_organization_counts',
  'an ordinary authenticated user cannot call admin_organization_counts() -- only service_role can'
);
reset role;

-- === plans versioning bug fix (migration 20260101000046) ===
insert into public.plans (id, code, name, billing_cycle, base_price, version)
values ('af000000-1111-0000-0000-000000000001', 'sa_test_plan', 'Test Plan v1', 'monthly', 499, 1);

select lives_ok(
  $$ insert into public.plans (code, name, billing_cycle, base_price, version)
     values ('sa_test_plan', 'Test Plan v2', 'monthly', 599, 2) $$,
  'a second version of the same plan code can now be inserted (plans_code_key was the bug)'
);

select throws_ok(
  $$ insert into public.plans (code, name, billing_cycle, base_price, version)
     values ('sa_test_plan', 'Duplicate v1', 'monthly', 499, 1) $$,
  '23505'
);

-- === organizations.status 'archived' value (migration 20260101000025, verified here since M19
--     is the first real writer of this value via POST .../organizations/:orgId/archive) ===
insert into public.organizations (id, legal_name, org_type, status)
values ('af000000-1111-0000-0000-000000000002', 'SA Archive Test Org', 'agency', 'active');

select lives_ok(
  $$ update public.organizations set status = 'archived' where id = 'af000000-1111-0000-0000-000000000002' $$,
  'organizations.status accepts ''archived'' (the TS/DB drift this milestone found and fixed)'
);

select is(
  (select status::text from public.organizations where id = 'af000000-1111-0000-0000-000000000002'),
  'archived',
  'the archived status was actually persisted'
);

select * from finish();
rollback;
