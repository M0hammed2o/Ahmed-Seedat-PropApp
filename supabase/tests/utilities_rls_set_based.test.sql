-- Migration 20260101000183: utilities RLS evaluated per property (set-based) instead of per row — same visibility.
-- Covers the one access path that is easy to miss in a candidate pre-filter: a platform admin's support session.

begin;
select plan(7);

insert into auth.users (id, email) values
  ('fc000000-0000-0000-0000-00000000000a', 'rls-member@test.propertyvault.example'),
  ('fc000000-0000-0000-0000-00000000000b', 'rls-support@test.propertyvault.example');
insert into public.organizations (id, legal_name, org_type) values
  ('fc111111-0000-0000-0000-000000000001', 'RLS Org A', 'agency'),
  ('fc111111-0000-0000-0000-000000000002', 'RLS Org B', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode) values
  ('fc111111-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-00000000000a', 'principal', 'active', now(), 'all');
insert into public.properties (id, org_id, nickname, address_line1, city, province, postal_code) values
  ('fc222222-0000-0000-0000-000000000001', 'fc111111-0000-0000-0000-000000000001', 'RLS A', '1', 'Durban', 'KwaZulu-Natal', '4001'),
  ('fc222222-0000-0000-0000-000000000002', 'fc111111-0000-0000-0000-000000000002', 'RLS B', '2', 'Durban', 'KwaZulu-Natal', '4001');
insert into public.utility_meters (org_id, property_id, utility_type, responsibility_mode, meter_role) values
  ('fc111111-0000-0000-0000-000000000001', 'fc222222-0000-0000-0000-000000000001', 'water', 'owner_paid', 'main'),
  ('fc111111-0000-0000-0000-000000000002', 'fc222222-0000-0000-0000-000000000002', 'water', 'owner_paid', 'main');
insert into public.platform_admin_users (id, auth_user_id, role, display_name, is_active) values
  ('fc888888-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-00000000000b', 'support_admin', 'RLS Support', true);
insert into public.support_access_sessions (id, platform_admin_id, org_id, reason) values
  ('fc777777-0000-0000-0000-000000000001', 'fc888888-0000-0000-0000-000000000001', 'fc111111-0000-0000-0000-000000000001', 'RLS test: investigating a meter');

select is((select count(*)::int from pg_policies where schemaname = 'public'
            and (qual ~ 'can_(read|write)_property_utilities\(' or with_check ~ 'can_(read|write)_property_utilities\(')),
  0, 'no utilities policy evaluates the access helper per row any more');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fc000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::int from public.utility_meters), 1, 'a member sees their own organisation''s meter only');
select is((select count(*)::int from public.utility_write_property_ids() where property_id = 'fc222222-0000-0000-0000-000000000002'), 0,
  'and can write nothing in another organisation');

select set_config('request.jwt.claims', '{"sub":"fc000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.utility_meters where org_id = 'fc111111-0000-0000-0000-000000000001'), 1,
  'a platform admin with an active support session can read the supported organisation''s meters');
select is((select count(*)::int from public.utility_meters where org_id = 'fc111111-0000-0000-0000-000000000002'), 0,
  'but nothing of an organisation without a session');
select is((select count(*)::int from public.utility_write_property_ids()), 0, 'and a support session never grants write access');
reset role;

update public.support_access_sessions set ended_at = now() where id = 'fc777777-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fc000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.utility_meters), 0, 'once the support session ends, nothing is visible');
reset role;

select * from finish();
rollback;
