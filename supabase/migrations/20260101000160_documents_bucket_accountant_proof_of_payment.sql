-- Tenant-portal release-gate pass (WORKLOG.md this date), Part A gap 1 follow-up. LOCAL ONLY --
-- production migration head remains 157; this file has NOT been applied to production.
--
-- Real proof-of-payment route testing (app/api/v1/documents POST) surfaced a second, deeper
-- instance of the same accountant/agent sibling-role problem already fixed at the application
-- layer this pass: has_org_role() ranks 'accountant' and 'agent' as siblings, neither a superset
-- of the other. The documents bucket's own storage.objects INSERT/UPDATE/DELETE policies require
-- agent+ unconditionally -- so even after the application-level route correctly admitted an
-- accountant-only caller for a proof-of-payment upload, the actual storage write was rejected by
-- RLS one layer deeper ("new row violates row-level security policy"), a genuine gap the
-- application-layer fix alone could not close.
--
-- Fix: broaden the documents bucket's non-lease-template branch to agent+ OR accountant+. The
-- storage layer cannot distinguish "this specific upload is proof-of-payment" from any other
-- document type by path alone (the path shape is {org_id}/{property_id}/{uuid}{ext} regardless of
-- category) -- the application route already enforces the finer distinction (general documents
-- still require agent+; proof-of-payment specifically requires accountant+), so the storage layer
-- only needs to not be MORE restrictive than that for a legitimate accountant use case. The
-- lease-templates branch (manager+) and every SELECT/tenant-self policy are untouched.

drop policy "documents_bucket_insert_agent_plus_and_property_access" on storage.objects;
create policy "documents_bucket_insert_agent_plus_and_property_access"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (
      (
        (storage.foldername(name))[2] <> 'lease-templates'
        and (
          has_org_role(((storage.foldername(name))[1])::uuid, 'agent'::organization_member_role)
          or has_org_role(((storage.foldername(name))[1])::uuid, 'accountant'::organization_member_role)
        )
        and (
          has_property_access(((storage.foldername(name))[2])::uuid, 'property_manager'::property_role)
          or has_property_access(((storage.foldername(name))[2])::uuid, 'owner'::property_role)
        )
      )
      or (
        (storage.foldername(name))[2] = 'lease-templates'
        and has_org_role(((storage.foldername(name))[1])::uuid, 'manager'::organization_member_role)
      )
    )
  );

drop policy "documents_bucket_update_agent_plus_and_property_access" on storage.objects;
create policy "documents_bucket_update_agent_plus_and_property_access"
  on storage.objects for update
  using (
    bucket_id = 'documents'
    and (
      (
        (storage.foldername(name))[2] <> 'lease-templates'
        and (
          has_org_role(((storage.foldername(name))[1])::uuid, 'agent'::organization_member_role)
          or has_org_role(((storage.foldername(name))[1])::uuid, 'accountant'::organization_member_role)
        )
        and (
          has_property_access(((storage.foldername(name))[2])::uuid, 'property_manager'::property_role)
          or has_property_access(((storage.foldername(name))[2])::uuid, 'owner'::property_role)
        )
      )
      or (
        (storage.foldername(name))[2] = 'lease-templates'
        and has_org_role(((storage.foldername(name))[1])::uuid, 'manager'::organization_member_role)
      )
    )
  );

drop policy "documents_bucket_delete_agent_plus_and_property_access_or_own_u" on storage.objects;
create policy "documents_bucket_delete_agent_plus_and_property_access_or_own_u"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and (
      owner = auth.uid()
      or (
        (
          has_org_role(((storage.foldername(name))[1])::uuid, 'agent'::organization_member_role)
          or has_org_role(((storage.foldername(name))[1])::uuid, 'accountant'::organization_member_role)
        )
        and (
          has_property_access(((storage.foldername(name))[2])::uuid, 'property_manager'::property_role)
          or has_property_access(((storage.foldername(name))[2])::uuid, 'owner'::property_role)
        )
      )
    )
  );

comment on policy "documents_bucket_insert_agent_plus_and_property_access" on storage.objects is
  'agent+ OR accountant+ (sibling roles, neither a superset of the other) plus property access --
   broadened this pass so an accountant-only caller can upload proof-of-payment through the same
   bucket the application-level route (app/api/v1/documents) already gates more precisely by
   upload type. Tenant-portal release-gate pass.';

-- ============================================================
-- The storage.objects fix above was necessary but not sufficient -- public.documents itself has
-- the identical agent-only ALL policy one layer further in (the actual table row insert, after
-- the storage object write succeeds). Same fix, same reasoning.
-- ============================================================
drop policy "documents_write_agent_plus_and_property_access" on public.documents;
create policy "documents_write_agent_plus_and_property_access"
  on public.documents for all
  using (
    (has_org_role(org_id, 'agent'::organization_member_role) or has_org_role(org_id, 'accountant'::organization_member_role))
    and (has_property_access(property_id, 'property_manager'::property_role) or has_property_access(property_id, 'owner'::property_role))
  )
  with check (
    (has_org_role(org_id, 'agent'::organization_member_role) or has_org_role(org_id, 'accountant'::organization_member_role))
    and (has_property_access(property_id, 'property_manager'::property_role) or has_property_access(property_id, 'owner'::property_role))
    and org_commercially_active(org_id)
  );

comment on policy "documents_write_agent_plus_and_property_access" on public.documents is
  'agent+ OR accountant+ (sibling roles) plus property access -- broadened this pass, same
   reasoning as the storage.objects policies above. Tenant-portal release-gate pass.';
