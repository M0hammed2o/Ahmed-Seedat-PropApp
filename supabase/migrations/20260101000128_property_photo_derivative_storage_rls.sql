-- Property cover-photo audit follow-up (WORKLOG.md 2026-08-24/25): storage.objects' own SELECT
-- policy (documents_bucket_select_org_member_and_property_access, migration 20260101000086)
-- authorizes a read by joining storage.objects.name to public.documents.storage_path -- but the
-- hero/card derivative files generated for property photos (migration 20260101000127) are uploaded
-- directly to Storage with NO corresponding documents row at all; they're referenced only via
-- property_photos.hero_storage_path/card_storage_path. createSignedUrl(), called correctly with the
-- caller's own session-bound client (never service-role), therefore fails RLS for any derivative
-- path and silently returns no URL -- confirmed live against a real disposable QA property during
-- the 20260101000127 deployment's own verification pass. Musgrave Flats itself was never affected
-- (its hero/card columns are null, so it falls back to the original path, which does have a real
-- documents row).
--
-- Fix: extend the SAME select policy with a second, OR'd branch authorizing a read when
-- storage.objects.name matches a property_photos row's hero/card derivative path, gated by the
-- EXACT same has_org_role/has_property_access predicate the original documents-row branch already
-- uses -- metadata-driven (via property_photos -> properties), never path-text-driven, matching
-- this policy's own established design principle. Never grants broader access than the original
-- photo itself already has; never makes the bucket public; never uses service-role for ordinary
-- rendering; never creates a documents row for a derivative (that would need a synthetic org_id/
-- property_id/category and complicate cleanup for no real benefit -- property_photos already IS
-- the authoritative metadata row for a derivative, exactly as it already is for the original).

drop policy if exists "documents_bucket_select_org_member_and_property_access" on storage.objects;

create policy "documents_bucket_select_org_member_and_property_access"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and (
      -- Original branch, unchanged: any document row (including a property photo's own original
      -- file) whose storage_path matches this object.
      exists (
        select 1 from public.documents d
        where d.storage_path = storage.objects.name
          and public.has_org_role(d.org_id, 'viewer')
          and public.has_property_access(d.property_id, 'read_only')
      )
      or
      -- New branch: a property photo's hero/card derivative, authorized via the SAME org-role +
      -- property-access predicate as the underlying photo's own documents row already requires
      -- (property_photos_select_staff_or_owner, migration 20260101000080), joined through
      -- property_photos -> properties rather than trusting the path text.
      exists (
        select 1 from public.property_photos pp
        join public.properties p on p.id = pp.property_id
        where (pp.hero_storage_path = storage.objects.name or pp.card_storage_path = storage.objects.name)
          and (
            (public.has_org_role(p.org_id, 'viewer') and public.has_property_access(p.id, 'read_only'))
            or public.has_property_access(p.id, 'owner')
          )
      )
    )
  );

comment on policy "documents_bucket_select_org_member_and_property_access" on storage.objects is
  'Two OR''d branches: (1) any documents row''s own storage_path (the original mechanism), (2) a
   property_photos row''s hero/card derivative path, authorized by the same org-role/property-access
   predicate property_photos itself already requires for SELECT. Fixes the derivative-rendering gap
   found during the 20260101000127 deployment -- derivatives never had a documents row of their own.';
