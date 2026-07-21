create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  category_id uuid not null references public.document_categories(id),
  document_type public.document_type not null,
  storage_path text not null unique,
  original_file_name text not null check (char_length(original_file_name) between 1 and 255),
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  checksum_sha256 text not null,
  billing_year integer check (billing_year between 2000 and 2100),
  billing_month integer check (billing_month between 1 and 12),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_owner_property_idx on public.documents (owner_user_id, property_id);
create index documents_owner_category_period_idx
  on public.documents (owner_user_id, category_id, billing_year, billing_month);
create index documents_owner_active_idx
  on public.documents (owner_user_id) where deleted_at is null;
-- Duplicate-upload detection (brief: "using checksums where practical").
create index documents_owner_checksum_idx on public.documents (owner_user_id, checksum_sha256);

create trigger set_documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;

create policy "documents_select_own"
  on public.documents for select
  using (owner_user_id = auth.uid());

create policy "documents_insert_own"
  on public.documents for insert
  with check (
    owner_user_id = auth.uid()
    and exists (select 1 from public.properties p where p.id = property_id and p.owner_user_id = auth.uid())
  );

create policy "documents_update_own"
  on public.documents for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- No delete policy: documents are soft-deleted via the update policy (deleted_at) per
-- SECURITY.md's retention/permanent-deletion workflow; hard delete happens only through a
-- separate, explicit, service-role-executed process (Phase 2), never a direct client DELETE.
