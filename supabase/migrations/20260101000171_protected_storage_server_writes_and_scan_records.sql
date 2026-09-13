-- Protected Storage: server-only writes, and durable clean-scan records (2026-09-13).
--
-- THE BYPASS THIS CLOSES. Every user-supplied upload route scans the file for malware before it is
-- stored (apps/admin/lib/uploadScan.ts). But storage.objects still carried two client write policies:
--
--   documents_bucket_insert_agent_plus_and_property_access  (INSERT)
--   documents_bucket_update_agent_plus_and_property_access  (UPDATE)
--
-- so an agent or accountant with manager/owner access to a property -- or a manager, under
-- {org_id}/lease-templates/ -- could create or overwrite objects in the `documents` bucket directly
-- through the Storage API with their own session, never touching the scan. A row pointing at such an
-- object could then be sent to Google Document AI or merged as a lease template.
--
-- AFTER THIS MIGRATION no client can create or replace an object in storage.objects. Every write is
-- made by the server with the service-role key (which bypasses RLS), through
-- apps/admin/lib/protectedStorage.ts -- storeScannedUpload() for user-supplied files, only after a
-- clean scan, and storeServerGeneratedObject() for bytes the server made itself. That code ships
-- before or with this migration: applying this migration while an older deployment still uploads
-- with the caller's session would make those uploads fail (fail closed, never open).
--
-- WHAT THIS DOES NOT CHANGE:
--   - No object and no row is deleted. This drops two policies and adds one empty table.
--   - SELECT policies are untouched, so every file stays readable exactly as before. They grant
--     access through documents / lease_documents / lease_templates / property_photos rows, never
--     through who uploaded the object, so server-written objects are readable the same way.
--   - The DELETE policy (documents_bucket_delete_agent_plus_and_property_access_or_own_u) is
--     untouched. Deleting cannot put unscanned bytes into Storage.
--   - The `documents` bucket itself (private, 25 MB, MIME allowlist) is untouched.
--
-- ROLLBACK: re-run the two `create policy` statements for these names from the latest migration that
-- defines them (20260101000160, lines 22-67); upload_malware_scans can stay. Rolling back reopens the
-- bypass, and is only needed if an older deployment that still uploads with the caller's session has
-- to keep working.

-- 1. Durable proof that a stored object was scanned clean ------------------------------------------

create table public.upload_malware_scans (
  bucket_id text not null,
  object_path text not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scanner text not null check (char_length(scanner) between 1 and 64),
  -- 'upload': scanned by the upload route before the object was written.
  -- 'rescan': an older object with no record, scanned clean just before it was first processed.
  source text not null check (source in ('upload', 'rescan')),
  -- Only clean verdicts are ever recorded; a file that is not clean is never stored or processed.
  verdict text not null default 'clean' check (verdict = 'clean'),
  scanned_at timestamptz not null default now(),
  primary key (bucket_id, object_path),
  -- Binds the record to the organisation's own folder, the same prefix the upload routes write under
  -- and the Storage policies scope by.
  constraint upload_malware_scans_path_in_org_folder
    check (starts_with(object_path, org_id::text || '/'))
);

comment on table public.upload_malware_scans is
  'One row per protected Storage object that passed a malware scan with an explicit clean verdict.
   Written only by the server (service role) in apps/admin/lib/protectedStorage.ts; read before any
   stored file is sent to OCR or otherwise processed. No row -> the file is scanned again first.';

create index upload_malware_scans_org_idx on public.upload_malware_scans (org_id);

-- A verdict is a record of what happened; it is never edited. Deleting is allowed so the server can
-- clean up after a failed upload (and org deletion cascades).
create or replace function public.prevent_upload_malware_scans_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'upload_malware_scans rows are immutable once written';
end;
$$;

create trigger upload_malware_scans_immutable
  before update on public.upload_malware_scans
  for each row execute function public.prevent_upload_malware_scans_update();

-- No policies: clients can neither read nor write verdicts, so a client can never mark its own file
-- clean. The service role bypasses RLS.
alter table public.upload_malware_scans enable row level security;
revoke all on table public.upload_malware_scans from anon, authenticated;

-- 2. Remove client write access to Storage objects -------------------------------------------------

drop policy if exists "documents_bucket_insert_agent_plus_and_property_access" on storage.objects;
drop policy if exists "documents_bucket_update_agent_plus_and_property_access" on storage.objects;

-- Refuse to finish if ANY client-applicable policy that can create or change an object remains --
-- including one added outside the migration history. The whole migration then rolls back and
-- nothing changes, rather than claiming a bypass is closed while it is still open.
do $$
declare
  remaining text;
begin
  select string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname)
    into remaining
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'ALL');
  if remaining is not null then
    raise exception 'storage.objects still has client write policies: %', remaining;
  end if;
end;
$$;
