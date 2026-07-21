-- Admin identity lives in its own table, deliberately separate from `profiles` (customer
-- accounts), so a customer row can never accidentally carry admin authority. See SECURITY.md:
-- admin authority is resolved server-side via this table + is_admin(), never from RLS bypass.

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  role public.admin_role not null,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_admin_users_updated_at
  before update on public.admin_users
  for each row execute function public.set_updated_at();

alter table public.admin_users enable row level security;

-- No client (customer or otherwise) gets a policy granting them rows here. Only the
-- service-role key (which bypasses RLS entirely) reads/writes this table. A deliberately
-- empty policy set means RLS default-denies all access from anon/authenticated roles.

-- Role-rank helper: 'security definer' so it can read admin_users without the caller needing
-- their own SELECT policy on it, while still requiring the caller to *be* an authenticated
-- admin (checked via auth.uid()) for the check to return true at all.
create or replace function public.is_admin(min_role public.admin_role default 'read_only_admin')
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and (
        case min_role
          when 'read_only_admin' then true
          when 'support_admin' then au.role in ('support_admin', 'operations_admin', 'super_admin')
          when 'operations_admin' then au.role in ('operations_admin', 'super_admin')
          when 'super_admin' then au.role = 'super_admin'
        end
      )
  );
$$;

comment on function public.is_admin(public.admin_role) is
  'True if the calling authenticated user is an active admin at or above min_role. Used by
   Next.js server route handlers (via an RPC call using the caller''s session) as a defense-in-depth
   check in addition to application-level role checks — never used to grant customer-table RLS
   access, per SECURITY.md.';
