-- Security + maintenance workflow pass (WORKLOG.md this date): closes the storage-scoping gap
-- flagged as an open risk in the previous architecture report. storage.objects RLS on the
-- 'documents' bucket has been org-scoped only since migration 20260101000048 -- harmless while
-- every staff member implicitly had access to every property in their org, but
-- 20260101000084 (property_access_mode = 'selected') made per-property staff restriction a real,
-- shippable feature, so an org member correctly excluded from a `documents` table row for
-- Property B could still fetch that file's raw bytes from Storage directly, since the bucket
-- policy never checked property_access at all.
--
-- SELECT: every object in this bucket that anyone should ever read already has a corresponding
-- `public.documents` row (property docs, lease docs, tenant docs, maintenance docs, inspection
-- docs, and property/maintenance/inspection photos all go through `documents` -- confirmed by
-- reading property_photos/maintenance_photos/inspection_photos, which are all thin link tables
-- over a documents.id FK, not separate storage paths). That row is authoritative metadata, not
-- the path text (CRITICAL constraint in the task brief) -- join storage.objects.name to
-- documents.storage_path and require the exact same predicate
-- documents_select_org_member_and_property_access (20260101000067) already enforces on the table
-- itself, so the two can never drift apart. Same join shape
-- documents_bucket_select_tenant_self (20260101000056) already uses successfully in production;
-- not recursive (documents' own RLS depends on has_org_role/has_property_access over
-- organization_members/property_access, never on storage.objects).
drop policy if exists "documents_bucket_select_org_member" on storage.objects;

create policy "documents_bucket_select_org_member_and_property_access"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and public.has_org_role(d.org_id, 'viewer')
        and public.has_property_access(d.property_id, 'read_only')
    )
  );

-- INSERT: unlike SELECT, no `documents` row exists yet at upload time -- both
-- apps/admin/app/api/v1/documents/route.ts and .../properties/[id]/photos/route.ts upload the
-- file to Storage first and only insert the `documents` row afterwards (chicken-and-egg: the row
-- that would give us authoritative metadata is a result of this exact write, not an input to it).
-- Authorization therefore has to come from the path the uploader chose, same convention org_id
-- already used for this since 20260101000048. Path convention (both routes, confirmed by reading
-- them): {org_id}/{property_id}/{uuid}{ext} -- this doesn't newly make the path the "sole"
-- authorization source overall (SELECT above is metadata-driven and is what actually gates every
-- read of the file thereafter); it's the same path-derived write gate the org segment already
-- was, extended to also cover the property segment.
drop policy if exists "documents_bucket_write_agent_plus" on storage.objects;

create policy "documents_bucket_insert_agent_plus_and_property_access"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and public.has_org_role((storage.foldername(name))[1]::uuid, 'agent')
    and (
      public.has_property_access((storage.foldername(name))[2]::uuid, 'property_manager')
      or public.has_property_access((storage.foldername(name))[2]::uuid, 'owner')
    )
  );

drop policy if exists "documents_bucket_update_agent_plus" on storage.objects;

create policy "documents_bucket_update_agent_plus_and_property_access"
  on storage.objects for update
  using (
    bucket_id = 'documents'
    and public.has_org_role((storage.foldername(name))[1]::uuid, 'agent')
    and (
      public.has_property_access((storage.foldername(name))[2]::uuid, 'property_manager')
      or public.has_property_access((storage.foldername(name))[2]::uuid, 'owner')
    )
  );

-- DELETE: same property-scoped gate as insert/update, plus a narrow `owner = auth.uid()` escape
-- hatch (storage.objects.owner is set by Storage itself at upload time, not path text) so both
-- routes' existing orphan-cleanup-on-row-insert-failure calls
-- (`supabase.storage.from('documents').remove([storagePath])`) keep working for the one case that
-- now legitimately fails the row insert: an org member who passed the org check but not the new
-- property check. Without this, that upload attempt would leave a permanently orphaned object
-- that even its own uploader couldn't remove -- harmless (unreadable per the SELECT policy above,
-- since no documents row exists to join against) but unbounded storage waste over time.
drop policy if exists "documents_bucket_delete_agent_plus" on storage.objects;

create policy "documents_bucket_delete_agent_plus_and_property_access_or_own_upload"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and (
      owner = auth.uid()
      or (
        public.has_org_role((storage.foldername(name))[1]::uuid, 'agent')
        and (
          public.has_property_access((storage.foldername(name))[2]::uuid, 'property_manager')
          or public.has_property_access((storage.foldername(name))[2]::uuid, 'owner')
        )
      )
    )
  );

-- documents_bucket_select_tenant_self (20260101000056) is untouched -- a tenant is never an org
-- member so it was never covered by (and never needs) the policy above; its own lease-based check
-- already implements exactly the "tenant-visible documents keep their existing separate rule"
-- requirement.
