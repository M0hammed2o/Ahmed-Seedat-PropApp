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
-- in this project) -- if this file is ever applied against a different Supabase project, the
-- auth_user_id foreign key simply fails to resolve and the migration errors out safely, rather
-- than silently inserting a dangling or wrong-account row.
insert into public.platform_admin_users (auth_user_id, role, display_name, is_active)
values ('db0bc61b-d8f9-45c7-b14f-f05156f739ec', 'super_admin', 'Mohammed Moosa', true)
on conflict (auth_user_id) do nothing;
