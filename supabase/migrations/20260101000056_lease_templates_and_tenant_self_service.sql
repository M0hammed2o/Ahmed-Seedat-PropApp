-- PWA_V1_COMPLETION_PLAN.md #9, #10, #11 -- three independent, small schema/RLS additions bundled
-- into one migration since they all serve the same phase of work:
--
-- 1) lease_templates (#9): upload, default, replace/archive, version history. Reuses the existing
--    'documents' storage bucket and its org_id-first path/RLS convention (migration
--    20260101000048) rather than provisioning a new bucket -- the lease_templates *table* is new,
--    the storage layer underneath it is not.
--
-- 2) tenants_update_self (#11): tenants.sql (20260101000028) deliberately left this out ("no
--    tenant-facing web portal in V1... for whichever native-app milestone builds the tenant
--    portal, not a mechanical RLS policy to bolt on now"). That milestone is now real
--    (20260101000049_tenant_portal_rls.sql), so this closes the gap it explicitly flagged.
--
-- 3) documents_bucket_select_tenant_self (#10): documents_select_tenant_self (20260101000049)
--    grants tenant read on the `documents` table row, but the storage.objects bucket policy was
--    never extended to match -- only documents_bucket_select_org_member exists, which checks
--    has_org_role() and is always false for a tenant (a tenant is not an org member). Without
--    this, a tenant-visible document's *table row* would be readable but createSignedUrl() for
--    the underlying file would 403 -- caught while building #10, not assumed away.

create type public.lease_template_status as enum ('active', 'archived');

create table public.lease_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  is_default boolean not null default false,
  status public.lease_template_status not null default 'active',
  -- Version history: a replacement points back at the row it replaced. The old row is archived,
  -- never mutated/deleted, so a lease already created against it is unaffected by a later replace.
  supersedes_id uuid references public.lease_templates(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lease_templates_org_idx on public.lease_templates (org_id, status);

-- At most one active default per org -- enforced at the DB level (not just the API's
-- clear-then-set sequence) so a race can never produce two simultaneous defaults.
create unique index lease_templates_one_default_per_org
  on public.lease_templates (org_id)
  where is_default and status = 'active';

create trigger set_lease_templates_updated_at
  before update on public.lease_templates
  for each row execute function public.set_updated_at();

alter table public.lease_templates enable row level security;

-- Read: any org member (viewer+) -- matches PERMISSIONS.md's "Organisation settings: View only"
-- floor for agent/accountant/viewer, and lets any role creating a lease use the picker.
create policy "lease_templates_select_org_member"
  on public.lease_templates for select
  using (public.has_org_role(org_id, 'viewer'));

-- Write (upload/rename/archive/set-default): manager+ only, matching PERMISSIONS.md's
-- "Organisation settings" column (principal/manager Full, everyone else view-only) -- lease
-- templates are an org-configuration asset, not a day-to-day operational record like a lease
-- itself.
create policy "lease_templates_insert_manager_plus"
  on public.lease_templates for insert
  with check (public.has_org_role(org_id, 'manager'));

create policy "lease_templates_update_manager_plus"
  on public.lease_templates for update
  using (public.has_org_role(org_id, 'manager'))
  with check (public.has_org_role(org_id, 'manager'));

-- No delete policy: archive via status, same "no hard-delete on business records" rule as every
-- other table (PERMISSIONS.md).

-- Atomically clears the org's previous default and sets a new one in a single statement -- a
-- plain two-step "clear then set" from the API layer has a narrow race window under concurrent
-- requests; this closes it. security invoker (not definer): RLS still applies, the caller must
-- already pass lease_templates_update_manager_plus to update either row, so no elevated privilege
-- is needed, just transactional grouping.
create or replace function public.set_default_lease_template(p_template_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.lease_templates where id = p_template_id and status = 'active';
  if v_org_id is null then
    raise exception 'Lease template not found or not active';
  end if;

  update public.lease_templates set is_default = false
  where org_id = v_org_id and status = 'active' and is_default = true and id <> p_template_id;

  update public.lease_templates set is_default = true where id = p_template_id;
end;
$$;

-- === tenants_update_self (#11) ===
create policy "tenants_update_self"
  on public.tenants for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- === documents_bucket_select_tenant_self (#10) ===
create policy "documents_bucket_select_tenant_self"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and d.lease_id is not null
        and public.caller_is_tenant_of_lease(d.lease_id)
    )
  );
