-- TASKS.md M15: notifications, notification_preferences, device_push_tokens, announcements,
-- announcement_reads (DATABASE.md §7). whatsapp_messages/email_messages/verified_phone_numbers/
-- usage_events/usage_snapshots/email_suppressions are M16/M17/M18/M19's own schema work, not
-- built here even though they're documented in the same DATABASE.md section -- each has a real
-- owning milestone and a real caller to build it against.

create type public.notification_category as enum (
  'rent', 'maintenance', 'lease', 'inspections', 'announcements', 'security', 'promotional'
);
create type public.device_platform as enum ('ios', 'android');

-- === notifications: user-scoped (not org-scoped) -- a user can receive notifications tied to any
--     org they belong to, or personal/platform ones with no org context at all. Written only by
--     server-side subsystems (matches usage_events/audit_events' "no client insert policy"
--     pattern) -- a notification a user could self-insert would be meaningless. ===
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (char_length(type) between 1 and 100),
  title text not null check (char_length(title) between 1 and 200),
  body text,
  related_entity_type text,
  related_entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, read_at);
create index notifications_related_idx on public.notifications (related_entity_type, related_entity_id)
  where related_entity_type is not null;

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  using (user_id = auth.uid());

-- Marking a notification read is the one legitimate client write -- scoped to the owner's own
-- rows; no insert/delete policy (server-side/service-role creates and, eventually, archives them).
create policy "notifications_update_own"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- === notification_preferences ===
create table public.notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  category public.notification_category not null,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  whatsapp_enabled boolean not null default true,
  primary key (user_id, category)
);

alter table public.notification_preferences enable row level security;

create policy "notification_preferences_all_own"
  on public.notification_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- === device_push_tokens ===
create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform public.device_platform not null,
  token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, token)
);

create index device_push_tokens_user_idx on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

-- The one table in this migration where a client DELETE is legitimate (removing a stale/
-- uninstalled-app token) -- unlike every business-data table elsewhere, which archives via
-- status rather than deleting (API_SPEC.md §3), a push token has no "archived" meaning once the
-- device stops using it.
create policy "device_push_tokens_all_own"
  on public.device_push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- === announcements ===
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text not null,
  requires_acknowledgement boolean not null default false,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > published_at)
);

create index announcements_org_idx on public.announcements (org_id, published_at);
create index announcements_property_idx on public.announcements (property_id) where property_id is not null;

alter table public.announcements enable row level security;

-- Org staff (viewer+) always see everything; a tenant sees an announcement if it's portfolio-wide
-- or scoped to a property they actually lease (via an active lease on one of the property's
-- units). No tenant portal exists in V1 (confirmed decision) so nothing calls this path yet --
-- built correct now rather than retrofitted later, matching owners_select_org_or_self's precedent
-- of designing the self-access shape ahead of the portal that will use it.
-- security definer, matching has_org_role()'s exact reasoning: leases/lease_tenants (built in
-- M10, before any tenant-facing read need existed) only have org-staff RLS policies, no
-- tenant-self branch -- a caller with a tenant identity but no org membership cannot read through
-- that chain under their own RLS, so a plain USING-clause subquery here would silently return
-- zero rows for every tenant (found live: the first version of this policy used a raw subquery
-- and every tenant-visibility test failed, not because the logic was wrong but because the
-- intermediate tables' RLS blocked it before the logic ever ran). This function reads
-- tenants/lease_tenants/leases/units as its owner, bypassing their RLS, while still checking
-- auth.uid() itself -- the same "needs cross-table read the caller has no direct policy for"
-- shape has_org_role() solves for organization_members.
create or replace function public.tenant_can_view_property_announcement(p_org_id uuid, p_property_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.tenants t
    join public.lease_tenants lt on lt.tenant_id = t.id
    join public.leases l on l.id = lt.lease_id
    join public.units u on u.id = l.unit_id
    where t.user_id = auth.uid()
      and l.org_id = p_org_id
      and (p_property_id is null or u.property_id = p_property_id)
  );
$$;

create policy "announcements_select_org_or_tenant"
  on public.announcements for select
  using (
    public.has_org_role(org_id, 'viewer')
    or public.tenant_can_view_property_announcement(org_id, property_id)
  );

create policy "announcements_write_agent_plus"
  on public.announcements for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- === announcement_reads ===
create table public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  read_at timestamptz,
  acknowledged_at timestamptz,
  primary key (announcement_id, tenant_id)
);

alter table public.announcement_reads enable row level security;

-- Org staff can see read/acknowledgement status (e.g. "who hasn't acknowledged this yet");
-- a tenant can see and write their own receipt -- the acknowledgement action itself.
create policy "announcement_reads_select_org_or_self"
  on public.announcement_reads for select
  using (
    exists (
      select 1 from public.announcements a
      where a.id = announcement_reads.announcement_id and public.has_org_role(a.org_id, 'viewer')
    )
    or exists (
      select 1 from public.tenants t where t.id = announcement_reads.tenant_id and t.user_id = auth.uid()
    )
  );

create policy "announcement_reads_write_self"
  on public.announcement_reads for all
  using (exists (select 1 from public.tenants t where t.id = announcement_reads.tenant_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.tenants t where t.id = announcement_reads.tenant_id and t.user_id = auth.uid()));
