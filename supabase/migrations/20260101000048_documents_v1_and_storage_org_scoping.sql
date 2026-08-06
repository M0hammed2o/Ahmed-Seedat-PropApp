-- TASKS.md M11/M20: Documents V1 vertical slice. Two independent fixes bundled because both are
-- prerequisites for a real (non-demo) upload to be safe and reviewable:

-- 1) TECHNICAL_DEBT_REGISTER.md TD-21: the `documents` storage bucket's RLS policies still
-- path-scope on `(storage.foldername(name))[1] = auth.uid()::text` -- a per-user check, not
-- per-org, even though the `documents` table itself has been org-scoped since migration
-- 20260101000032. TD-21 confirmed zero real uploads exist yet ("build it right the first time,
-- not a live gap"), so this replaces rather than migrates the path convention: the new leading
-- path segment is `{org_id}`, matching `documents_select_org_member`/`documents_write_agent_plus`'s
-- own thresholds exactly (viewer read, agent write) via the same has_org_role() function RLS
-- elsewhere already uses -- no new authorization concept invented.

drop policy if exists "documents_bucket_select_own" on storage.objects;
drop policy if exists "documents_bucket_insert_own" on storage.objects;
drop policy if exists "documents_bucket_update_own" on storage.objects;
drop policy if exists "documents_bucket_delete_own" on storage.objects;

create policy "documents_bucket_select_org_member"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and public.has_org_role((storage.foldername(name))[1]::uuid, 'viewer')
  );

create policy "documents_bucket_write_agent_plus"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and public.has_org_role((storage.foldername(name))[1]::uuid, 'agent')
  );

create policy "documents_bucket_update_agent_plus"
  on storage.objects for update
  using (
    bucket_id = 'documents'
    and public.has_org_role((storage.foldername(name))[1]::uuid, 'agent')
  );

create policy "documents_bucket_delete_agent_plus"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and public.has_org_role((storage.foldername(name))[1]::uuid, 'agent')
  );

-- 2) OCR review workflow: a human confirming (not correcting-and-auto-applying) that an
-- extraction is accurate. No new status value needed -- `reviewed_at`/`reviewed_by` set once,
-- by POST /api/v1/documents/:id/review, service-role (extraction_results has no client
-- write policy, matching extraction_jobs' existing "server-side pipeline only" design).
alter table public.extraction_results add column reviewed_at timestamptz;
alter table public.extraction_results add column reviewed_by uuid references auth.users(id);
