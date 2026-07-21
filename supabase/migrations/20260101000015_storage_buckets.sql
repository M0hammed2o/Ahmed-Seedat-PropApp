-- Private bucket for all customer-uploaded documents. `public = false` — no object is ever
-- served via a public URL (SECURITY.md). Property photos also live here under a distinct
-- path prefix rather than a separate public bucket, so the same ownership policy covers both.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400, -- 25MB, matches packages/config default maxFileSizeMb placeholder
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic']
)
on conflict (id) do nothing;

-- Path convention enforced here: {user_id}/{property_id}/{year}/{month}/{uuid}.{ext} or
-- {user_id}/property-photos/{property_id}/{uuid}.{ext}. Policy only checks the leading
-- {user_id} folder segment — the rest is organisational, not a security boundary (the boundary
-- is this policy, not path obscurity — see SECURITY.md).
create policy "documents_bucket_select_own"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "documents_bucket_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "documents_bucket_update_own"
  on storage.objects for update
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "documents_bucket_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
