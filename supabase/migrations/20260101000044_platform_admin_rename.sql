-- TASKS.md M19: admin_users -> platform_admin_users, is_admin() -> is_platform_admin() (deferred
-- from M1/M3 per DECISIONS.md 2026-07-30, executed here because M19 already opens
-- lib/auth.ts/middleware.ts/roleRank.ts, so the rename is no longer a standalone-risk change).
-- Postgres FK/RLS/index/trigger attachments follow a table rename automatically -- this migration
-- only needs to rename the table, the function, and (per SUPER_ADMIN.md §6's own column name,
-- "platform_admin_id FK") the one FK column that was named after the old table.

alter table public.admin_users rename to platform_admin_users;

alter function public.is_admin(public.admin_role) rename to is_platform_admin;

comment on function public.is_platform_admin(public.admin_role) is
  'True if the calling authenticated user is an active platform admin at or above min_role. Used by
   Next.js server route handlers (via an RPC call using the caller''s session) as a defense-in-depth
   check in addition to application-level role checks — never used to grant customer-table RLS
   access, per SECURITY.md.';

alter table public.support_access_sessions rename column admin_user_id to platform_admin_id;
