-- Account deletion, second step (2026-09-21). /delete-account and the privacy policy tell a person
-- that deleting their account erases their name, email address and phone number. An audit of
-- production found two stores of exactly that data which POST /api/v1/account/delete never reached:
-- auth.identities.identity_data (every identity carries an `email`; OAuth ones also carry
-- `full_name`, `name`, `picture`, `avatar_url`) and auth.users.raw_user_meta_data (GoTrue MERGES
-- `user_metadata: {}`, so it cleared nothing).
--
-- Proves: the function erases both, refuses to touch an account that has not already been
-- anonymised and banned by the route, cannot be called by a signed-in user or an anonymous one,
-- and leaves every other account alone.

begin;
select plan(18);

-- A live account, exactly as a signed-up person looks: real address, not banned, provider identity
-- carrying their email and name.
insert into auth.users (id, email, phone, raw_user_meta_data)
values (
  'de100000-0000-0000-0000-000000000001',
  'live-person@test.propertyvault.example',
  '+27820000001',
  '{"full_name": "Live Person", "email": "live-person@test.propertyvault.example"}'::jsonb
);
insert into auth.identities (id, user_id, provider, provider_id, identity_data)
values (
  'de100000-0000-0000-0000-00000000000a',
  'de100000-0000-0000-0000-000000000001',
  'email',
  'de100000-0000-0000-0000-000000000001',
  '{"sub": "de100000-0000-0000-0000-000000000001", "email": "live-person@test.propertyvault.example"}'::jsonb
);

-- A second live account, used only to prove the function never reaches past its argument.
insert into auth.users (id, email, raw_user_meta_data)
values (
  'de100000-0000-0000-0000-000000000002',
  'bystander@test.propertyvault.example',
  '{"full_name": "Bystander"}'::jsonb
);
insert into auth.identities (id, user_id, provider, provider_id, identity_data)
values (
  'de100000-0000-0000-0000-00000000000b',
  'de100000-0000-0000-0000-000000000002',
  'google',
  'google-bystander-sub',
  '{"sub": "google-bystander-sub", "email": "bystander@test.propertyvault.example", "full_name": "Bystander", "picture": "https://example.invalid/b.jpg"}'::jsonb
);

-- ---------------------------------------------------------------- shape and permissions
select has_function('public', 'purge_deleted_account_auth_pii', array['uuid'],
  'the purge function exists');
select is(prosecdef, true, 'it runs as SECURITY DEFINER, since the auth schema is not client-writable')
  from pg_proc where proname = 'purge_deleted_account_auth_pii';
select is(
  has_function_privilege('anon', 'public.purge_deleted_account_auth_pii(uuid)', 'execute'),
  false,
  'an anonymous caller cannot execute it'
);
select is(
  has_function_privilege('authenticated', 'public.purge_deleted_account_auth_pii(uuid)', 'execute'),
  false,
  'a signed-in user cannot execute it, so nobody can purge anyone from the client'
);
select is(
  has_function_privilege('service_role', 'public.purge_deleted_account_auth_pii(uuid)', 'execute'),
  true,
  'the service role, which the deletion route uses, can execute it'
);

-- ---------------------------------------------------------------- the guard
select throws_ok(
  $$select public.purge_deleted_account_auth_pii('de100000-0000-0000-0000-000000000001')$$,
  'account_not_anonymised',
  'it refuses a live account -- it can only ever finish a deletion the route already started'
);

select throws_ok(
  $$select public.purge_deleted_account_auth_pii('de100000-0000-0000-0000-0000000000ff')$$,
  'user_not_found',
  'it refuses an id that does not exist'
);

select is(
  (select count(*)::int from auth.identities where user_id = 'de100000-0000-0000-0000-000000000001'),
  1,
  'the refused live account keeps its identity untouched'
);

-- ---------------------------------------------------------------- the real path
-- Step 3 of the route: address rewritten to the reserved .invalid form, sign-in banned.
update auth.users
   set email = 'deleted-de100000-0000-0000-0000-000000000001@deleted.proplyst.invalid',
       banned_until = now() + interval '100 years'
 where id = 'de100000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.purge_deleted_account_auth_pii('de100000-0000-0000-0000-000000000001')$$,
  'it runs once the account has been anonymised and banned'
);

select is(
  (select count(*)::int from auth.identities where user_id = 'de100000-0000-0000-0000-000000000001'),
  0,
  'the provider identity, which held a copy of the email address, is gone'
);

select is(
  (select raw_user_meta_data from auth.users where id = 'de100000-0000-0000-0000-000000000001'),
  '{}'::jsonb,
  'the metadata copy of the name and email is cleared -- what user_metadata:{} never did'
);

select is(
  (select phone from auth.users where id = 'de100000-0000-0000-0000-000000000001'),
  null,
  'the phone number is cleared -- what phone:undefined never sent'
);

-- ---------------------------------------------------------------- blast radius
select is(
  (select count(*)::int from auth.identities where user_id = 'de100000-0000-0000-0000-000000000002'),
  1,
  'the other account keeps its identity'
);

select is(
  (select raw_user_meta_data->>'full_name' from auth.users where id = 'de100000-0000-0000-0000-000000000002'),
  'Bystander',
  'the other account keeps its metadata'
);

-- ---------------------------------------------------------------- every provider, and re-running
-- A person who signed in with more than one method has one identity row per provider, and each one
-- carries its own copy of their email address. All of them have to go, not just the first.
insert into auth.users (id, email, banned_until, raw_user_meta_data)
values (
  'de100000-0000-0000-0000-000000000003',
  'deleted-de100000-0000-0000-0000-000000000003@deleted.proplyst.invalid',
  now() + interval '100 years',
  '{"full_name": "Multi Provider", "email": "multi@test.propertyvault.example"}'::jsonb
);
insert into auth.identities (id, user_id, provider, provider_id, identity_data) values
  ('de100000-0000-0000-0000-00000000000c', 'de100000-0000-0000-0000-000000000003', 'email',
   'de100000-0000-0000-0000-000000000003',
   '{"sub": "de100000-0000-0000-0000-000000000003", "email": "multi@test.propertyvault.example"}'::jsonb),
  ('de100000-0000-0000-0000-00000000000d', 'de100000-0000-0000-0000-000000000003', 'google',
   'google-multi-sub',
   '{"sub": "google-multi-sub", "email": "multi@test.propertyvault.example", "full_name": "Multi Provider"}'::jsonb),
  ('de100000-0000-0000-0000-00000000000e', 'de100000-0000-0000-0000-000000000003', 'apple',
   'apple-multi-sub',
   '{"sub": "apple-multi-sub", "email": "multi@test.propertyvault.example"}'::jsonb);

select is(
  (select count(*)::int from auth.identities where user_id = 'de100000-0000-0000-0000-000000000003'),
  3,
  'the multi-provider account starts with an email, a google and an apple identity'
);

select lives_ok(
  $$select public.purge_deleted_account_auth_pii('de100000-0000-0000-0000-000000000003')$$,
  'it runs for an account that signed in several ways'
);

select is(
  (select count(*)::int from auth.identities where user_id = 'de100000-0000-0000-0000-000000000003'),
  0,
  'every provider identity is removed, not just one -- no copy of the address is left behind'
);

-- Re-running matters: the route retries on failure, and a person can tap Delete twice.
select lives_ok(
  $$select public.purge_deleted_account_auth_pii('de100000-0000-0000-0000-000000000003')$$,
  'running it again on an already-purged account is harmless'
);

select * from finish();
rollback;
