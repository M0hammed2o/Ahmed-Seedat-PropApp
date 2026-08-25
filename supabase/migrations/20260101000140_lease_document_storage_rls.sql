-- First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25): a real bug caught live by the new
-- browser e2e test (Playwright) for lease generation -- GET /api/v1/leases/:id/documents/:documentId
-- /download returned signedUrl: null for a just-generated lease document. Root cause: the exact
-- same class of gap fixed twice already this engagement (property-photo derivatives, migration
-- 20260101000128; lease-templates, migration 20260101000130) -- documents_bucket_select_org_member_
-- and_property_access has branches for `documents`, `property_photos` derivatives, and
-- `lease_templates`, but lease_documents (new this pass, migration 20260101000134) was never added.
-- A generated/uploaded lease's storage object therefore matched no SELECT branch at all for anyone,
-- staff or tenant, even though its INSERT succeeded fine (that path is a normal property-scoped
-- {org_id}/{property_id}/... path, which the write policies already recognize).
--
-- Adds two branches: staff (agent+ viewer + property read_only, or property owner -- matching
-- leases_select_staff_or_owner's own predicate exactly, joined the same way) and tenant (their own
-- ISSUED document only -- matching lease_documents_select_tenant_self's own predicate, migration
-- 20260101000134).

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
    or exists (
      select 1 from lease_documents ld
      join leases l on l.id = ld.lease_id
      join units u on u.id = l.unit_id
      where ld.storage_path = objects.name
        and (
          (has_org_role(l.org_id, 'viewer') and has_property_access(u.property_id, 'read_only'))
          or has_property_access(u.property_id, 'owner')
        )
    )
    or exists (
      select 1 from lease_documents ld
      where ld.storage_path = objects.name
        and ld.status = 'issued'
        and caller_is_tenant_of_lease(ld.lease_id)
    )
  )
);
