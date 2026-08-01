-- pgTAP-style multi-tenant RLS isolation tests for the PropertyVault org/membership/portfolio
-- layer (supabase/migrations/20260101000016-22). Extends the model established in
-- rls_isolation.test.sql (PropVault-era, single-owner) to the org-scoped schema.
--
-- NOT EXECUTED in this sandbox — no local Docker/Supabase instance available (KNOWN_BUGS.md,
-- TESTING.md §9, RISK_REGISTER.md R-02). Written per TASKS.md instruction #18: "still write the
-- test... document the exact environment requirement... do not falsely mark it executed."
-- Run via `supabase test db` against a local instance (`supabase start`, Docker required) once
-- that environment exists — this is the single highest-priority test-infra gap tracked in this
-- project (RISK_REGISTER.md R-02, Critical).
--
-- These tests assert the non-negotiable cases from TESTING.md §2 items 1-3 and 8, restricted to
-- the tables that actually exist as of M1/M2 (organizations, organization_members, units,
-- owners, property_owners, support_access_sessions). Leasing/accounting/maintenance tables get
-- their own isolation tests in the milestone that creates them (TASKS.md M8-M14), following this
-- same fixture pattern rather than retrofitting everything into one file.

begin;
select plan(13);

-- Fixtures: two organizations, one principal member each, a unit and owner in Org A only.
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'principal-a@test.propertyvault.example'),
  ('b1000000-0000-0000-0000-000000000001', 'principal-b@test.propertyvault.example'),
  ('c1000000-0000-0000-0000-000000000001', 'viewer-a@test.propertyvault.example'),
  ('d1000000-0000-0000-0000-000000000001', 'no-org@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A (Pty) Ltd', 'agency'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B (Pty) Ltd', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'viewer', 'active', now());

-- properties.org_id is nullable during the expand phase (DATABASE.md §14) — insert directly
-- against org_id for this fixture rather than routing through owner_user_id, since these tests
-- exercise the new org-scoped tables, not the not-yet-cut-over properties table.
insert into public.properties (id, owner_user_id, org_id, nickname, address_line1, city, country, property_type)
values ('eeeeeeee-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Org A Property', '1 Test Street', 'Cape Town', 'ZA', 'house');

insert into public.units (id, property_id, org_id, unit_label, status)
values ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Unit 1', 'vacant');

insert into public.owners (id, org_id, name, owner_type, status)
values ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Org A Owner', 'individual', 'active');

-- Fixtures for the support_access_sessions test below: a platform_admin_users row (distinct role
-- system from organization_members, see PERMISSIONS.md intro) and one support session against
-- Org A.
insert into auth.users (id, email) values
  ('99990000-0000-0000-0000-000000000001', 'support-admin@test.propertyvault.example');
insert into public.platform_admin_users (id, auth_user_id, role, display_name, is_active)
values ('88880000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001',
        'support_admin', 'Test Support Admin', true);
insert into public.support_access_sessions (id, platform_admin_id, org_id, reason)
values ('77770000-0000-0000-0000-000000000001', '88880000-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Investigating a customer-reported billing issue');

-- === Cross-org isolation: Org B's principal cannot see Org A's data ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.organizations where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B principal cannot SELECT Org A''s organizations row'
);

select is(
  (select count(*) from public.organization_members where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B principal cannot SELECT Org A''s organization_members rows'
);

select is(
  (select count(*) from public.units where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B principal cannot SELECT Org A''s units'
);

select is(
  (select count(*) from public.owners where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B principal cannot SELECT Org A''s owners'
);

-- FIXED 2026-07-30 (first real `supabase test db` run caught this): an RLS-filtered UPDATE does
-- NOT raise an exception — it silently matches and updates zero rows, which is correct Postgres
-- behavior, not a bug. `throws_ok` was the wrong assertion here (it requires an exception);
-- `lives_ok` correctly asserts the statement completes without error, and the row-count check
-- immediately below is what actually verifies the RLS denial took effect.
select lives_ok(
  $$ update public.units set unit_label = 'hacked'
     where id = 'ffffffff-0000-0000-0000-000000000001' $$,
  'Org B principal UPDATE against Org A''s unit runs without error (RLS silently filters it to zero rows, verified next)'
);

select is(
  (select count(*) from public.units where id = 'ffffffff-0000-0000-0000-000000000001' and unit_label = 'hacked'),
  0::bigint,
  'Org B principal''s update did not actually change Org A''s unit'
);

-- === Role-scoped write denial: Org A's viewer cannot write to units, even within their own org ===
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.units where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1::bigint,
  'Org A viewer CAN SELECT their own org''s unit (viewer has read access)'
);

select lives_ok(
  $$ update public.units set unit_label = 'viewer-write-attempt'
     where id = 'ffffffff-0000-0000-0000-000000000001' $$,
  'Org A viewer UPDATE against their own org''s unit runs without error (has_org_role requires agent+, silently filters to zero rows, verified next)'
);

select is(
  (select count(*) from public.units where id = 'ffffffff-0000-0000-0000-000000000001' and unit_label = 'viewer-write-attempt'),
  0::bigint,
  'Org A viewer''s write attempt did not change the unit (role-gated, not just org-gated)'
);

-- === has_org_role() correctness: a user with no membership anywhere gets false for every check ===
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.organizations),
  0::bigint,
  'A user with zero org memberships reads zero organizations rows, anywhere'
);

-- === Platform-admin table isolation (retained from rls_isolation.test.sql, renamed target) ===
select is(
  (select count(*) from public.platform_admin_users),
  0::bigint,
  'An ordinary authenticated user reads zero rows from platform_admin_users (renamed from admin_users, TASKS.md M19, migration 20260101000044)'
);

-- === Support access: even Org A's own principal cannot see a support session opened against
--     their own org (support_access_sessions has RLS enabled with zero policies — deny-by-default
--     to anon/authenticated; verified separately via `select rolbypassrls from pg_roles` that
--     service_role, which the real support-session route handlers use, has BYPASSRLS=true and so
--     is unaffected by the absence of a policy here) ===
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.support_access_sessions where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'Org A''s own principal cannot see a support_access_sessions row opened against their own org — by design, not a bug (SECURITY.md/support-session model: this is PropertyVault auditing itself, not org-visible data)'
);

-- === organizations.status is NOT currently enforced by any RLS policy — documented as real,
--     current behavior (evidenced 2026-07-31), not asserted as a security guarantee. has_org_role()
--     only checks organization_members.status; nothing anywhere checks organizations.status.
--     Archiving/suspending/cancelling an org today has zero effect on its own members' data
--     access. Tracked as an open product decision in RISK_REGISTER.md/TECHNICAL_DEBT_REGISTER.md
--     (what SHOULD an archived/suspended org's member access look like?) rather than guessed at
--     here. If that decision is ever implemented, this assertion must flip to `false` and this
--     comment must be corrected in the same change — a silently-stale comment here would be
--     exactly the kind of documentation drift this verification pass exists to catch. ===
update public.organizations set status = 'archived' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select is(
  (select public.has_org_role('aaaaaaaa-0000-0000-0000-000000000001', 'viewer')),
  true,
  'CURRENT BEHAVIOR (not a guarantee): an archived org''s own active principal still passes has_org_role() — organizations.status is not yet wired into any access-control check'
);

select * from finish();
rollback;
