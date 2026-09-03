-- Platform Admin bootstrap (post pre-UAT deployment pass, WORKLOG.md this date). Provisioning is
-- deliberately manual-only (lib/auth.ts's own comment: "no signup/seed path anywhere creates a
-- row") -- this migration performs that one-time manual step for the platform's first real
-- super_admin, rather than leaving it as an undocumented out-of-band SQL command.
--
-- Target identity resolved precisely before writing this (not guessed): the single existing
-- auth.users row for mohammed98moosa98@gmail.com, confirmed via the GoTrue admin API to be the
-- only account with that email in this project, with zero existing platform_admin_users row for
-- it. This migration inserts a platform_admin_users row referencing that EXISTING auth.users id --
-- it creates no new auth identity of any kind.
--
-- This is a one-time, environment-specific bootstrap (the literal auth_user_id below only exists
-- in this project). Originally an unconditional insert -- if this file was ever applied against a
-- different Supabase project, the auth_user_id foreign key would simply fail to resolve and the
-- migration would error out safely, rather than silently inserting a dangling or wrong-account row.
--
-- Guarded 2026-09-03 (web financials V1 pass, part 2): a genuinely fresh `supabase db reset` in a
-- brand-new local instance has no auth.users row at all yet (that row only ever came from a real
-- signup through the running app in a long-lived local session, never from a migration or seed
-- file) -- the unconditional insert above made a from-scratch local reset impossible, always
-- failing here regardless of anything past this point. Wrapped in an existence check so a missing
-- auth user now skips this one-time bootstrap instead of aborting the entire migration run -- same
-- "never a dangling or wrong-account row" guarantee, just failing open (skip) instead of failing
-- the whole reset. No behavioural change wherever the referenced row already exists (every
-- environment this has already run against, including production).
do $$
begin
  if exists (select 1 from auth.users where id = 'db0bc61b-d8f9-45c7-b14f-f05156f739ec') then
    insert into public.platform_admin_users (auth_user_id, role, display_name, is_active)
    values ('db0bc61b-d8f9-45c7-b14f-f05156f739ec', 'super_admin', 'Mohammed Moosa', true)
    on conflict (auth_user_id) do nothing;
  end if;
end $$;
