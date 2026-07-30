-- Staff of an org. A user's role is *always* resolved from this table server-side — never from
-- a client-supplied role claim (SECURITY.md). A user can belong to multiple orgs (the evidenced
-- "Workspaces" pattern — see PROPVIEW_SCREENSHOT_AUDIT.md IMG_8053), so this is a many-to-many
-- join, not a column on auth.users/profiles.

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_member_role not null,
  status public.organization_member_status not null default 'invited',
  invited_by uuid references auth.users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index organization_members_org_idx on public.organization_members (org_id, status);
create index organization_members_user_idx on public.organization_members (user_id, status);

create trigger set_organization_members_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

alter table public.organization_members enable row level security;

-- A member can see the roster of any org they themselves belong to (needed for the Team Seats
-- screen). Written as a self-referencing subquery rather than "org_id = my own org_id" because
-- a user can belong to more than one org.
create policy "organization_members_select_same_org"
  on public.organization_members for select
  using (
    org_id in (
      select om.org_id from public.organization_members om
      where om.user_id = auth.uid() and om.status = 'active'
    )
  );

-- No direct insert/update/delete policy here: membership changes (invite, role change, revoke)
-- go through the has_org_role()-gated RPCs added in 20260101000021, so "can manager X actually
-- promote to principal" logic lives in one place instead of being reconstructed per-policy.

create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email citext not null,
  role public.organization_member_role not null default 'agent',
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index organization_invites_org_idx on public.organization_invites (org_id);
create unique index organization_invites_pending_email_idx
  on public.organization_invites (org_id, email)
  where accepted_at is null;

alter table public.organization_invites enable row level security;

create policy "organization_invites_select_same_org"
  on public.organization_invites for select
  using (
    org_id in (
      select om.org_id from public.organization_members om
      where om.user_id = auth.uid() and om.status = 'active'
    )
  );

-- Invite creation/acceptance also goes through RPCs (20260101000021) — acceptance in particular
-- must be security-definer since the accepting user isn't an org member yet at the moment they
-- accept, so a plain RLS insert policy on organization_members couldn't authorize their own
-- membership row being created.
