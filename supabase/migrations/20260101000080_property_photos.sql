-- Workflow-integration pass (WORKLOG.md this date), Stage 4: property photo upload. Reuses the
-- existing private `documents` bucket/RLS/malware-scan pipeline (20260101000015/48) exactly as
-- `inspection_photos`/`maintenance_photos` already do (20260101000034) -- a small link table over
-- a `documents` row, not a new bucket, not a new security model. `is_cover` (at most one true per
-- property, enforced by the partial unique index below) is the only new concept.

insert into public.document_categories (slug, label, is_default) values
  ('property_photos', 'Property Photos', true)
on conflict do nothing;

create table public.property_photos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  is_cover boolean not null default false,
  created_at timestamptz not null default now()
);

create index property_photos_property_idx on public.property_photos (property_id);
create unique index property_photos_one_cover_idx on public.property_photos (property_id) where is_cover;

alter table public.property_photos enable row level security;

-- Same staff-or-owner shape as documents itself (20260101000067/72) -- a photo is exactly the kind
-- of evidence a co-owner needs to see, matching the reasoning already established for
-- cash_receipts/documents in the commercial-launch execution plan.
create policy "property_photos_select_staff_or_owner"
  on public.property_photos for select
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_photos.property_id
        and (
          (public.has_org_role(p.org_id, 'viewer') and public.has_property_access(p.id, 'read_only'))
          or public.has_property_access(p.id, 'owner')
        )
    )
  );

create policy "property_photos_write_agent_plus_and_property_access"
  on public.property_photos for all
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_photos.property_id
        and public.has_org_role(p.org_id, 'agent')
        and (public.has_property_access(p.id, 'property_manager') or public.has_property_access(p.id, 'owner'))
    )
  )
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_photos.property_id
        and public.has_org_role(p.org_id, 'agent')
        and (public.has_property_access(p.id, 'property_manager') or public.has_property_access(p.id, 'owner'))
    )
  );

comment on table public.property_photos is
  'Links a properties row to one or more documents rows (the real file lives in the private
   documents bucket, same as every other document type). is_cover marks the single photo shown as
   the property hero image; at most one per property (partial unique index).';
