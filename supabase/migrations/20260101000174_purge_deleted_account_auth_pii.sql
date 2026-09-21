-- Account deletion: finish erasing the personal data the deletion route already promises to erase.
--
-- /delete-account and the privacy policy both tell a person that deleting their account erases
-- their name, email address and phone number. POST /api/v1/account/delete rewrites
-- auth.users.email and bans the account, which is most of that -- but two stores of the same
-- personal data were being left behind, and an audit of production on 2026-09-21 confirmed both
-- hold real data today:
--
--   * auth.identities.identity_data -- EVERY identity (30 of 30: 25 email, 4 google, 1 apple)
--     carries an `email` key, and the OAuth ones additionally carry `full_name`, `name`, `picture`
--     and `avatar_url`. The route never touched this table, so a "deleted" person's email address
--     and display name survived deletion in full.
--   * auth.users.raw_user_meta_data -- the route passes `user_metadata: {}` to the Auth admin API,
--     but GoTrue MERGES that object rather than replacing it, so an empty object removes nothing.
--     In production 9 users carry an `email` key there and 5 carry `full_name`.
--
-- Neither is reachable from the client (the auth schema is not exposed through PostgREST), so this
-- was a data-retention and truthfulness problem rather than an exposure one -- but the pages make a
-- promise, so the system has to keep it.
--
-- Additive and non-destructive: this migration only creates a function. It changes no existing
-- table, drops nothing, and rewrites no existing row. The function it installs only ever acts on an
-- account that has ALREADY been anonymised and banned by the deletion route (see the guard below),
-- so it cannot be aimed at a live account even by a caller holding the service-role key.
create or replace function public.purge_deleted_account_auth_pii(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_anonymised boolean;
  v_identities_removed integer;
begin
  -- The guard. This function is only ever a SECOND step: it refuses to run unless the deletion
  -- route has already rewritten the address to the reserved .invalid form AND banned sign-in.
  -- That is what stops it from being used as an arbitrary "wipe this person's identity" tool.
  select (u.email like 'deleted-%@deleted.proplyst.invalid' and u.banned_until is not null)
    into v_anonymised
    from auth.users u
   where u.id = p_user_id;

  if v_anonymised is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  if not v_anonymised then
    raise exception 'account_not_anonymised' using errcode = 'P0001';
  end if;

  -- The provider records. Deleting them removes the copies of the email address, name and avatar
  -- URL that Google/Apple/email sign-in each store in identity_data. The account itself is banned
  -- and its address is unroutable, so there is no sign-in path left to preserve: should the same
  -- person ever return, they sign up afresh rather than landing back on a deleted account.
  delete from auth.identities where user_id = p_user_id;
  get diagnostics v_identities_removed = row_count;

  -- The metadata GoTrue's merge semantics would not clear, and the phone number the Auth admin
  -- call silently skipped (`phone: undefined` is dropped by JSON.stringify, so it was never sent).
  update auth.users
     set raw_user_meta_data = '{}'::jsonb,
         phone = null
   where id = p_user_id;

  return jsonb_build_object('identities_removed', v_identities_removed);
end;
$$;

comment on function public.purge_deleted_account_auth_pii(uuid) is
  'Second step of account deletion: removes auth.identities rows and clears raw_user_meta_data and '
  'phone for an account the deletion route has already anonymised and banned. Refuses to act on any '
  'other account. Service-role only.';

revoke all on function public.purge_deleted_account_auth_pii(uuid) from public, anon, authenticated;
grant execute on function public.purge_deleted_account_auth_pii(uuid) to service_role;
