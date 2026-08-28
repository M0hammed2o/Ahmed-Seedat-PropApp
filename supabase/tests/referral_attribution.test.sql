-- Tests for 20260101000147_referral_attribution.sql (V1 launch-completion pass): referral_partners
-- + organization_referral_attributions. The full "invalid/unknown code doesn't block signup"
-- behaviour is proven at the TS/route level (apps/admin/app/api/v1/organizations/
-- __tests__/referral.test.ts) since the resolve-or-fallback-or-skip logic lives there, not in the
-- database -- this file covers what's genuinely a database-layer concern: case-normalized
-- resolution, the disabled-partner exclusion, duplicate-attribution prevention, and RLS isolation
-- (both tables have zero policies for anon/authenticated, mirroring public.admin_users).

begin;
select plan(13);

insert into auth.users (id, email, encrypted_password) values
  ('b1000000-0000-0000-0000-000000000001', 'referral-partner-creator@test.propertyvault.example', 'x'),
  ('b1000000-0000-0000-0000-000000000002', 'referral-org-member@test.propertyvault.example', 'x');

insert into public.organizations (id, legal_name, org_type)
values ('b2000000-0000-0000-0000-000000000001', 'Referral Test Org A', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'principal', 'active', now());

-- ============================================================================================
-- Schema sanity.
-- ============================================================================================
select is(
  (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name = 'referral_partners'),
  1,
  'referral_partners exists'
);
select is(
  (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name = 'organization_referral_attributions'),
  1,
  'organization_referral_attributions exists'
);

-- ============================================================================================
-- Case-normalized resolution: mixed-case input matches the stored lowercase code.
-- ============================================================================================
insert into public.referral_partners (id, name, referral_code, active, created_by)
values ('b3000000-0000-0000-0000-000000000001', 'Jane Partner', 'janesmith2024', true, 'b1000000-0000-0000-0000-000000000001');

select is(
  (select id from public.referral_partners where referral_code = lower(trim('JaneSmith2024')) and active = true),
  'b3000000-0000-0000-0000-000000000001'::uuid,
  'mixed-case input normalizes (trim+lower) to match the stored lowercase code and resolves to the right partner'
);

-- ============================================================================================
-- A disabled (active=false) partner's code is unresolvable via the active=true lookup the
-- signup route uses -- it must fall back to fallback_referrer_name behaviour, not attribute to
-- the disabled partner.
-- ============================================================================================
insert into public.referral_partners (id, name, referral_code, active, created_by)
values ('b3000000-0000-0000-0000-000000000002', 'Inactive Partner', 'inactivecode', false, 'b1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.referral_partners where referral_code = 'inactivecode' and active = true),
  0,
  'a disabled partner''s code does not resolve via the active=true lookup -- treated as unresolvable'
);

-- ============================================================================================
-- referral_code must already be normalized (defense-in-depth check constraint) and unique.
-- ============================================================================================
select throws_ok(
  $$ insert into public.referral_partners (name, referral_code) values ('Bad Code Partner', 'NotLower') $$,
  '23514',
  null,
  'referral_partners rejects a non-normalized referral_code at the check-constraint level'
);

select throws_ok(
  $$ insert into public.referral_partners (name, referral_code) values ('Duplicate Code Partner', 'janesmith2024') $$,
  '23505',
  null,
  'referral_partners.referral_code is unique'
);

-- ============================================================================================
-- Duplicate attribution is prevented: a second attempt for the same org_id is a no-op (matches
-- the ON CONFLICT (org_id) DO NOTHING the /api/v1/organizations route uses), never an error and
-- never a silent overwrite of the already-set attribution.
-- ============================================================================================
insert into public.organization_referral_attributions (org_id, referral_partner_id, referral_code_used)
values ('b2000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'janesmith2024');

select lives_ok(
  $$ insert into public.organization_referral_attributions (org_id, referral_partner_id, referral_code_used, fallback_referrer_name)
     values ('b2000000-0000-0000-0000-000000000001', null, null, 'Someone Else')
     on conflict (org_id) do nothing $$,
  'a second attribution attempt for the same org_id is a no-op, not an error'
);

select is(
  (select referral_partner_id from public.organization_referral_attributions where org_id = 'b2000000-0000-0000-0000-000000000001'),
  'b3000000-0000-0000-0000-000000000001'::uuid,
  'the original attribution was NOT overwritten by the duplicate attempt'
);
select is(
  (select count(*)::int from public.organization_referral_attributions where org_id = 'b2000000-0000-0000-0000-000000000001'),
  1,
  'exactly one attribution row exists for the org -- no duplicate row was created'
);

-- ============================================================================================
-- Cross-org security: both tables have zero policies for anon/authenticated (service-role-only
-- access via gated Platform Admin routes) -- an ordinary authenticated org member gets nothing on
-- read and a hard RLS denial on write, never a leak or a silent partial write.
-- ============================================================================================
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.referral_partners),
  0,
  'an ordinary authenticated org member reads zero rows from referral_partners (RLS denies, no policy exists)'
);
select is(
  (select count(*)::int from public.organization_referral_attributions),
  0,
  'an ordinary authenticated org member reads zero rows from organization_referral_attributions (RLS denies, no policy exists)'
);

select throws_ok(
  $$ insert into public.referral_partners (name, referral_code) values ('Client Insert Attempt', 'clientcode') $$,
  '42501',
  'new row violates row-level security policy for table "referral_partners"',
  'an ordinary authenticated user cannot insert into referral_partners -- RLS blocks it entirely'
);
select throws_ok(
  $$ insert into public.organization_referral_attributions (org_id, fallback_referrer_name)
     values ('b2000000-0000-0000-0000-000000000001', 'Sneaky Insert') $$,
  '42501',
  'new row violates row-level security policy for table "organization_referral_attributions"',
  'an ordinary authenticated user cannot insert into organization_referral_attributions -- RLS blocks it entirely'
);

reset role;

select * from finish();
rollback;
