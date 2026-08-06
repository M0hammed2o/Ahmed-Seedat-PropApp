-- TASKS.md M8: tenants (DATABASE.md §4). Occupant record, deliberately decoupled from auth.users
-- the same way owners is (public.owners, 20260101000022) -- a tenant can exist purely as a
-- bookkeeping/lease record with no login at all, matching the evidenced "add a tenant" flow that
-- doesn't require sending an invite.

create type public.tenant_status as enum ('active', 'expired', 'pending');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  full_name text not null check (char_length(full_name) between 1 and 200),
  email citext,
  phone text,
  id_number_ref uuid references public.encrypted_secrets(id),
  status public.tenant_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- (org_id, status) composite per DATABASE.md §13's stated shape for every module's primary
-- list-view table; user_id partial index mirrors owners_user_idx for the same "does this signed-in
-- user have a portal identity" lookup shape resolvePortalSession()-equivalents will need once a
-- tenant portal exists (MOBILE_ARCHITECTURE_DECISION.md).
create index tenants_org_idx on public.tenants (org_id, status);
create index tenants_user_idx on public.tenants (user_id) where user_id is not null;

create trigger set_tenants_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

alter table public.tenants enable row level security;

-- Mirrors owners_select_org_or_self exactly (20260101000022): org staff (viewer+) see every
-- tenant in their org; a tenant with portal access (user_id set) can additionally see their own
-- record even outside any org-membership context.
create policy "tenants_select_org_or_self"
  on public.tenants for select
  using (public.has_org_role(org_id, 'viewer') or user_id = auth.uid());

-- No self-write policy, deliberately -- same reasoning as owners: there is no tenant-facing web
-- portal in V1 (confirmed product decision, ROADMAP.md), and self-service profile edits are real
-- UX/validation work (what fields can a tenant change unsupervised? does an email change need
-- re-verification?) for whichever native-app milestone builds the tenant portal, not a mechanical
-- RLS policy to bolt on now.
create policy "tenants_write_agent_plus"
  on public.tenants for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));
