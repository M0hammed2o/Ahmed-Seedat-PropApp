-- RLS isolation tests for support-mode read access (migration 20260101000057,
-- PWA_V1_COMPLETION_PLAN.md #12, SUPER_ADMIN.md §6). Adversarial: proves the grant is exactly
-- "viewer-level read, only for the specific org with an active session, never a write, revoked
-- the instant the session ends" -- every clause SUPER_ADMIN.md §6 promises, checked independently.

begin;
select plan(11);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'support-admin@test.propertyvault.example'),
  ('d2000000-0000-0000-0000-000000000001', 'ss-org-a-principal@test.propertyvault.example');

insert into public.platform_admin_users (id, auth_user_id, role, display_name, is_active)
values ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'support_admin', 'Support Admin', true);

insert into public.organizations (id, legal_name, org_type, status)
values
  ('d4000000-0000-0000-0000-000000000001', 'Support Session Test Org A', 'agency', 'active'),
  ('d4000000-0000-0000-0000-000000000002', 'Support Session Test Org B', 'agency', 'active'),
  ('d4000000-0000-0000-0000-000000000003', 'Support Session Test Org C (archived)', 'agency', 'archived');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('d4000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'principal', 'active', now());

insert into public.properties (id, org_id, nickname, address_line1, city, property_type)
values
  ('d5000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'Org A Property', '1 Test St', 'Cape Town', 'apartment'),
  ('d5000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000002', 'Org B Property', '2 Test St', 'Cape Town', 'apartment');

insert into public.portfolio_insights (id, org_id, insight_type, message, data_source, severity)
values ('d6000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'rent_overdue', 'Test insight', '{}'::jsonb, 'warning');

set local role authenticated;

-- === Before any session exists: zero access ===
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.properties where org_id = 'd4000000-0000-0000-0000-000000000001'),
  0::bigint,
  'platform admin with NO support session sees zero rows in Org A (is_platform_admin() alone never grants customer-table access)'
);

-- === Open a support session against Org A (service-role write, matching the real API route) ===
reset role;
insert into public.support_access_sessions (id, platform_admin_id, org_id, reason)
values ('d7000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'Investigating a billing discrepancy ticket');
set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.properties where org_id = 'd4000000-0000-0000-0000-000000000001'),
  1::bigint,
  'platform admin WITH an active support session sees Org A''s property (viewer-level read granted)'
);

select is(
  (select count(*) from public.properties where org_id = 'd4000000-0000-0000-0000-000000000002'),
  0::bigint,
  'the same session grants ZERO access to Org B (scoped to the exact org_id, not every org)'
);

select is(
  (select count(*) from public.support_access_sessions where platform_admin_id = 'd3000000-0000-0000-0000-000000000001'),
  1::bigint,
  'the admin can read their own support_access_sessions row (support_access_sessions_select_own)'
);

-- === Writes stay blocked (viewer-only, never elevated) ===
select lives_ok(
  $$ update public.properties set nickname = 'support-mode-write-attempt'
     where id = 'd5000000-0000-0000-0000-000000000001' $$,
  'platform admin UPDATE against Org A''s property runs without error (RLS silently filters to zero rows, verified next)'
);

select is(
  (select count(*) from public.properties where id = 'd5000000-0000-0000-0000-000000000001' and nickname = 'support-mode-write-attempt'),
  0::bigint,
  'the write did not actually apply -- support mode grants read only, never write, even for an active session'
);

-- portfolio_insights_dismiss_org: the one write policy in the whole schema previously gated at
-- the 'viewer' floor -- proves the targeted fix holds, not just the general case above.
select lives_ok(
  $$ update public.portfolio_insights set dismissed_at = now()
     where id = 'd6000000-0000-0000-0000-000000000001' $$,
  'platform admin UPDATE against Org A''s portfolio insight runs without error (verified next)'
);

select is(
  (select count(*) from public.portfolio_insights where id = 'd6000000-0000-0000-0000-000000000001' and dismissed_at is not null),
  0::bigint,
  'the dismiss did not apply -- portfolio_insights_dismiss_org requires real organization_members, support-session read access does not extend to it'
);

-- === Archived org: support session still grants read (compliance access), unlike a real member ===
reset role;
insert into public.support_access_sessions (id, platform_admin_id, org_id, reason)
values ('d7000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000003', 'Compliance audit of an archived account');
set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.organizations where id = 'd4000000-0000-0000-0000-000000000003'),
  1::bigint,
  'an active support session grants read access to an ARCHIVED org (compliance/audit case, unlike the real-membership branch which excludes archived)'
);

-- === Session end revokes access immediately ===
reset role;
update public.support_access_sessions set ended_at = now() where id = 'd7000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.properties where org_id = 'd4000000-0000-0000-0000-000000000001'),
  0::bigint,
  'ending the session immediately revokes read access to Org A (ended_at is null is checked live, not cached)'
);

select is(
  (select count(*) from public.organizations where id = 'd4000000-0000-0000-0000-000000000003'),
  1::bigint,
  'the still-open Org C session is unaffected by ending the unrelated Org A session'
);

select * from finish();
rollback;
