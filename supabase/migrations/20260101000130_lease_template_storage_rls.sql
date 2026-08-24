-- Lease-template storage RLS audit (WORKLOG.md 2026-08-25): discovered while writing integration
-- tests for the DOCX bucket-MIME fix (migration 20260101000129). Every write/read policy on the
-- shared 'documents' Storage bucket assumes the path shape `{org_id}/{property_id}/{uuid}.ext` and
-- either parses `(storage.foldername(name))[2]` as a property UUID (INSERT/UPDATE) or joins through
-- the `documents` table's own `storage_path` column (SELECT). Lease templates use a deliberately
-- different, org-only path shape -- `{org_id}/lease-templates/{uuid}.ext` (route.ts, migration
-- 20260101000056) -- with no `documents` row and no property at all. Two concrete breakages result:
--
--   1. INSERT/UPDATE: `((storage.foldername(name))[2])::uuid` throws (not just denies) on the
--      literal string "lease-templates", so every lease-template upload has failed with
--      `invalid input syntax for type uuid: "lease-templates"` since migration 20260101000086
--      first introduced this cast -- regardless of file type, and regardless of the DOCX-MIME fix.
--   2. SELECT: the policy only recognizes objects backed by a `documents` row or a `property_photos`
--      derivative (20260101000128); a lease-template object matches neither branch, so
--      `createSignedUrl` on GET /api/v1/lease-templates/:id silently returns no URL for every org
--      member, even though `lease_templates_select_org_member` (viewer+) already grants them read
--      access to the row itself.
--
-- Fixed the same way as the earlier property-photo-derivative gap: an additional OR branch per
-- policy, authorized against the real owning table (`lease_templates`) rather than trusting path
-- text alone wherever a metadata row already exists (SELECT), and against the exact same
-- manager-plus org-role check `lease_templates_insert_manager_plus` / `_update_manager_plus`
-- already enforce at the table level, for the two operations (INSERT/UPDATE) where no row exists
-- yet at write time and path-text parsing is unavoidable. DELETE is untouched: the only exercised
-- delete path is the route's own same-request rollback-after-failed-insert, already covered by the
-- existing `owner = auth.uid()` branch (storage sets `owner` from the caller's JWT since these
-- routes use the anon-key + user-session client, never service role).

drop policy if exists documents_bucket_select_org_member_and_property_access on storage.objects;
create policy documents_bucket_select_org_member_and_property_access on storage.objects
for select
using (
  bucket_id = 'documents'
  and (
    exists (
      select 1 from documents d
      where d.storage_path = objects.name
        and has_org_role(d.org_id, 'viewer')
        and has_property_access(d.property_id, 'read_only')
    )
    or exists (
      select 1 from property_photos pp
      join properties p on p.id = pp.property_id
      where (pp.hero_storage_path = objects.name or pp.card_storage_path = objects.name)
        and (
          (has_org_role(p.org_id, 'viewer') and has_property_access(p.id, 'read_only'))
          or has_property_access(p.id, 'owner')
        )
    )
    or exists (
      select 1 from lease_templates lt
      where lt.storage_path = objects.name
        and has_org_role(lt.org_id, 'viewer')
    )
  )
);

drop policy if exists documents_bucket_insert_agent_plus_and_property_access on storage.objects;
create policy documents_bucket_insert_agent_plus_and_property_access on storage.objects
for insert
with check (
  bucket_id = 'documents'
  and (
    (
      (storage.foldername(name))[2] <> 'lease-templates'
      and has_org_role(((storage.foldername(name))[1])::uuid, 'agent')
      and (
        has_property_access(((storage.foldername(name))[2])::uuid, 'property_manager')
        or has_property_access(((storage.foldername(name))[2])::uuid, 'owner')
      )
    )
    or (
      (storage.foldername(name))[2] = 'lease-templates'
      and has_org_role(((storage.foldername(name))[1])::uuid, 'manager')
    )
  )
);

drop policy if exists documents_bucket_update_agent_plus_and_property_access on storage.objects;
create policy documents_bucket_update_agent_plus_and_property_access on storage.objects
for update
using (
  bucket_id = 'documents'
  and (
    (
      (storage.foldername(name))[2] <> 'lease-templates'
      and has_org_role(((storage.foldername(name))[1])::uuid, 'agent')
      and (
        has_property_access(((storage.foldername(name))[2])::uuid, 'property_manager')
        or has_property_access(((storage.foldername(name))[2])::uuid, 'owner')
      )
    )
    or (
      (storage.foldername(name))[2] = 'lease-templates'
      and has_org_role(((storage.foldername(name))[1])::uuid, 'manager')
    )
  )
);
