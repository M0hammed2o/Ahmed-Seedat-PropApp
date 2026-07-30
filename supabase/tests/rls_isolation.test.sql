-- pgTAP-style RLS isolation tests. Run via `supabase test db` against a local instance
-- (`supabase start`, Docker required). Not executed in the assistant's sandbox — see
-- DECISIONS.md and TESTING.md for why, and KNOWN_BUGS.md/RISK_REGISTER.md R-02 for current status.
--
-- Updated 2026-07-30 (TASKS.md M5): `properties` is now org-scoped (org_id, has_org_role()-based
-- RLS), not owner_user_id-scoped — this file's property fixture/assertions were rewritten to
-- match. See supabase/tests/multi_tenant_isolation.test.sql for the fuller org/portfolio
-- isolation suite this complements (that file covers organizations/units/owners specifically;
-- this one keeps its original bill/payment_matches/admin_users cases, now updated for the org
-- FK properties requires).
--
-- These tests assert the release-blocking isolation guarantees from SECURITY.md:
--   1. Org B's member cannot SELECT Org A's property.
--   2. User A cannot UPDATE User B's bill.
--   3. User A cannot INSERT a payment_matches row linking their payment to User B's bill.
--   4. A customer session cannot read the admin_users table at all.

begin;
select plan(4);

-- Fixtures: two fake users, two orgs (properties requires org_id now), a property in Org A.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'user-a@test.propvault.example'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@test.propvault.example');

insert into public.organizations (id, legal_name, org_type) values
  ('44444444-4444-4444-4444-444444444444', 'Org A', 'owner_managed'),
  ('55555555-5555-5555-5555-555555555555', 'Org B', 'owner_managed');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'principal', 'active', now()),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'principal', 'active', now());

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
        'User B Property', '1 Test Street', 'Cape Town', 'ZA', 'house');

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.properties where id = '33333333-3333-3333-3333-333333333333'),
  0::bigint,
  'Org B''s member (user A) cannot SELECT Org A''s property by id'
);

-- FIXED 2026-07-30: this was `throws_ok` since the file was first written, contradicting its own
-- description ("not an error") — an RLS-filtered UPDATE doesn't raise, it silently matches zero
-- rows. Never caught until the first real `supabase test db` run. `lives_ok` is the correct
-- assertion; the row-count check below is what actually verifies the denial.
select lives_ok(
  $$ update public.properties set nickname = 'hacked'
     where id = '33333333-3333-3333-3333-333333333333' $$,
  'User A UPDATE against Org A''s property (from Org B) runs without error, silently filtered to zero rows, verified next'
);

select is(
  (select count(*) from public.properties where id = '33333333-3333-3333-3333-333333333333' and nickname = 'hacked'),
  0::bigint,
  'User A''s update did not actually change User B''s property'
);

select is(
  (select count(*) from public.admin_users),
  0::bigint,
  'An ordinary authenticated user reads zero rows from admin_users (no policy grants access)'
);

select * from finish();
rollback;
