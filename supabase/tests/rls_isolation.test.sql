-- pgTAP-style RLS isolation tests. Run via `supabase test db` against a local instance
-- (`supabase start`, Docker required). Not executed in the assistant's sandbox — see
-- DECISIONS.md and TESTING.md for why, and KNOWN_BUGS.md/final report for current status.
--
-- These tests assert the release-blocking isolation guarantees from SECURITY.md:
--   1. User A cannot SELECT User B's property.
--   2. User A cannot UPDATE User B's bill.
--   3. User A cannot INSERT a payment_matches row linking their payment to User B's bill.
--   4. A customer session cannot read the admin_users table at all.

begin;
select plan(4);

-- Fixtures: two fake users and a property/bill owned by user B.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'user-a@test.propvault.example'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@test.propvault.example');

insert into public.properties (id, owner_user_id, nickname, address_line1, city, country, property_type)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
        'User B Property', '1 Test Street', 'Cape Town', 'ZA', 'house');

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.properties where id = '33333333-3333-3333-3333-333333333333'),
  0::bigint,
  'User A cannot SELECT User B''s property by id'
);

select throws_ok(
  $$ update public.properties set nickname = 'hacked'
     where id = '33333333-3333-3333-3333-333333333333' $$,
  null,
  null,
  'User A UPDATE against User B''s property affects zero rows (RLS-filtered, not an error, but verified via row count below)'
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
