-- First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 10: closes the remaining
-- gaps in the application/tenant/lease lifecycle audit trail that can only be observed from
-- inside the relevant Postgres function (the calling TS route has no way to know, after the
-- fact, whether approve_application() created a brand-new tenant vs linked an existing one, or
-- whether record_application_document_upload() was a first upload vs a replace of an already-
-- uploaded document for the same requirement). Every other lifecycle action from the master
-- action list either already exists under its exact name, or is added at the TS route layer in
-- this same pass (application.created, application.withdrawn, template.uploaded/replaced/
-- default_changed, lease.sent/resent, lease.generated/regenerated/manual_document_uploaded --
-- see apps/admin's applications/route.ts, applications/[id]/withdraw/route.ts, lease-templates
-- routes, leases/[id]/send/route.ts, lib/leaseDocuments.ts).
--
-- None of these functions gain new columns/behaviour -- purely additive audit_events inserts
-- alongside their existing logic. auth.uid() resolves correctly regardless of SECURITY DEFINER
-- (it reads the caller's JWT claims, not the executing role), matching this codebase's
-- established SQL audit-write pattern (record_application_document_upload,
-- submit_application_by_token) of a plain insert with no actor_role/actor_display_name
-- resolution (that enrichment is a TS-only convenience in lib/audit.ts's writeAuditEvent()).
--
-- approve_application() and end_lease() are NOT security definer (both run with the caller's own
-- session privileges, relying on the invoker's own RLS-granted row visibility plus their own
-- explicit has_org_role()/has_property_access() checks). audit_events has zero client insert
-- policy at all (by original design, lib/audit.ts's own comment: "server-side subsystems only"),
-- so a raw `insert into audit_events` from inside a non-definer function fails RLS -- and because
-- that failure is an unhandled exception, it silently rolls back the ENTIRE function, not just
-- the audit row (caught locally via `supabase test db --local` before this ever reached
-- production: approve_application_tenant_dedup.test.sql and lease_workflow_activation.test.sql
-- both failed with "new row violates row-level security policy for table audit_events", tenant/
-- lease creation and lease termination completely broken). Fixed with a narrow, single-purpose
-- SECURITY DEFINER helper whose only privilege is writing an audit_events row -- it performs no
-- other read/write, so it can't be used to bypass any table's real RLS, matching the same
-- "explicit checks in the body, not blanket bypass" posture as this codebase's other definer
-- functions.
create or replace function public.write_lifecycle_audit_event(
  p_org_id uuid,
  p_actor_type public.audit_actor_type,
  p_actor_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_after jsonb default null,
  p_before jsonb default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_events (org_id, actor_type, actor_user_id, action, entity_type, entity_id, before, after)
  values (p_org_id, p_actor_type, p_actor_user_id, p_action, p_entity_type, p_entity_id, p_before, p_after);
$$;

-- === record_application_document_upload(): first upload vs replace ===
create or replace function public.record_application_document_upload(
  p_token text,
  p_requirement_key text,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_checksum_sha256 text
)
returns table (success boolean, error_code text, document_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_row public.application_access_tokens%rowtype;
  v_app public.applications%rowtype;
  v_requirement public.application_document_requirements%rowtype;
  v_category_id uuid;
  v_document_id uuid;
  v_document_type public.document_type;
  v_is_replacement boolean;
begin
  select * into v_token_row from public.application_access_tokens
    where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  if v_token_row.revoked_at is not null then
    return query select false, 'revoked'::text, null::uuid;
    return;
  end if;
  if v_token_row.expires_at <= now() then
    return query select false, 'expired'::text, null::uuid;
    return;
  end if;

  select * into v_app from public.applications where id = v_token_row.application_id;
  if not found or v_app.status not in ('invited', 'submitted', 'reviewing') then
    return query select false, 'not_editable'::text, null::uuid;
    return;
  end if;

  select * into v_requirement from public.application_document_requirements
    where application_id = v_app.id and requirement_key = p_requirement_key
    for update;
  if not found then
    return query select false, 'requirement_not_found'::text, null::uuid;
    return;
  end if;

  v_is_replacement := v_requirement.document_id is not null;

  select id into v_category_id from public.document_categories where slug = 'tenant_documents';

  v_document_type := case p_requirement_key
    when 'id_document' then 'id_document'::public.document_type
    when 'proof_of_income' then 'payslip'::public.document_type
    when 'proof_of_address' then 'proof_of_address'::public.document_type
    when 'bank_statement' then 'bank_statement'::public.document_type
    else 'other'::public.document_type
  end;

  insert into public.documents (
    property_id, category_id, document_type, storage_path, original_file_name, mime_type,
    file_size_bytes, checksum_sha256, org_id, application_id
  ) values (
    v_app.property_id, v_category_id, v_document_type, p_storage_path, p_original_file_name, p_mime_type,
    p_file_size_bytes, p_checksum_sha256, v_app.org_id, v_app.id
  ) returning id into v_document_id;

  update public.application_document_requirements
    set status = 'uploaded', document_id = v_document_id, reviewed_by = null, reviewed_at = null, rejection_reason = null, updated_at = now()
    where id = v_requirement.id;

  update public.application_access_tokens set last_accessed_at = now() where id = v_token_row.id;

  insert into public.audit_events (org_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_app.org_id, 'system',
    case when v_is_replacement then 'application.document_replaced' else 'application.document_uploaded' end,
    'application_document_requirements', v_requirement.id,
    jsonb_build_object('requirementKey', p_requirement_key, 'documentId', v_document_id, 'tokenId', v_token_row.id)
  );

  return query select true, null::text, v_document_id;
end;
$$;

-- === approve_application(): tenant created/linked + draft lease created ===
create or replace function public.approve_application(
  p_application_id uuid,
  p_tenant_id uuid default null
)
returns uuid
language plpgsql
as $function$
declare
  v_app public.applications%rowtype;
  v_tenant_id uuid;
  v_tenant_org_id uuid;
  v_tenant_was_created boolean := false;
  v_lease_id uuid;
begin
  select * into v_app from public.applications where id = p_application_id for update;

  if not found then
    raise exception 'Application not found (or not visible to the caller)';
  end if;

  if v_app.status = 'decided' then
    raise exception 'Application % has already been decided', p_application_id;
  end if;

  if v_app.status = 'invited' then
    raise exception 'This application has not been completed by the applicant yet';
  end if;

  if p_tenant_id is not null then
    select org_id into v_tenant_org_id from public.tenants where id = p_tenant_id;
    if v_tenant_org_id is null then
      raise exception 'Tenant not found (or not visible to the caller)';
    end if;
    if v_tenant_org_id <> v_app.org_id then
      raise exception 'Tenant does not belong to the same organization as this application';
    end if;
    v_tenant_id := p_tenant_id;
  elsif v_app.applicant_email is not null then
    select id into v_tenant_id from public.tenants
    where org_id = v_app.org_id and email = v_app.applicant_email
    order by created_at asc
    limit 1;
  end if;

  if v_tenant_id is null then
    insert into public.tenants (org_id, full_name, email, phone, status)
    values (v_app.org_id, v_app.applicant_name, v_app.applicant_email, v_app.applicant_phone, 'active')
    returning id into v_tenant_id;
    v_tenant_was_created := true;
  end if;

  perform public.write_lifecycle_audit_event(
    v_app.org_id, 'user'::public.audit_actor_type, auth.uid(),
    case when v_tenant_was_created then 'tenant.created_from_application' else 'tenant.linked_from_application' end,
    'tenants', v_tenant_id, jsonb_build_object('applicationId', p_application_id)
  );

  insert into public.leases (
    org_id, unit_id, start_date, rent_amount, deposit_amount, status, source, source_application_id
  )
  values (
    v_app.org_id, v_app.unit_id, current_date, 0, 0, 'draft', 'application_approved', v_app.id
  )
  returning id into v_lease_id;

  insert into public.lease_tenants (lease_id, tenant_id, is_primary)
  values (v_lease_id, v_tenant_id, true);

  perform public.write_lifecycle_audit_event(
    v_app.org_id, 'user'::public.audit_actor_type, auth.uid(), 'lease.draft_created', 'leases', v_lease_id,
    jsonb_build_object('applicationId', p_application_id, 'unitId', v_app.unit_id, 'tenantId', v_tenant_id)
  );

  update public.applications
  set status = 'decided', decision = 'approved', decided_by = auth.uid(), decided_at = now()
  where id = p_application_id;

  return v_lease_id;
end;
$function$;

-- === activate_lease(): lease.activated (skipped on the idempotent already-active no-op path) ===
create or replace function public.activate_lease(p_lease_id uuid)
returns leases
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_lease public.leases%rowtype;
  v_property_id uuid;
  v_tenant_count integer;
  v_prep public.lease_preparations%rowtype;
begin
  select * into v_lease from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Lease not found (or not visible to the caller)';
  end if;

  select property_id into v_property_id from public.units where id = v_lease.unit_id;

  if not public.has_org_role(v_lease.org_id, 'agent') then
    raise exception 'Caller does not have permission to activate this lease';
  end if;
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'Caller does not have property-level permission to activate this lease';
  end if;

  if v_lease.status = 'active' then
    return v_lease;
  end if;

  if v_lease.status <> 'draft' then
    raise exception 'Only a draft lease can be activated (current status: %)', v_lease.status;
  end if;

  select count(*) into v_tenant_count from public.lease_tenants where lease_id = p_lease_id;
  if v_tenant_count = 0 then
    raise exception 'Assign a tenant to this lease before activating it';
  end if;

  if v_lease.rent_amount <= 0 then
    raise exception 'Lease must have a rent amount greater than zero to activate';
  end if;

  if v_lease.start_date is null then
    raise exception 'Lease must have a start date to activate';
  end if;

  if v_lease.source = 'application_approved' then
    select * into v_prep from public.lease_preparations where lease_id = p_lease_id;
    if not found or v_prep.status <> 'sent' then
      raise exception 'The lease must be sent to the tenant before it can be activated';
    end if;
    if v_prep.tenant_acknowledged_at is null and v_prep.staff_confirmed_signed_at is null then
      raise exception 'The tenant must acknowledge the lease (or staff must record a signed copy) before activation';
    end if;
  end if;

  if exists (
    select 1 from public.leases
    where unit_id = v_lease.unit_id and status = 'active' and id <> p_lease_id
  ) then
    raise exception 'This unit already has another active lease';
  end if;

  update public.leases set status = 'active' where id = p_lease_id
  returning * into v_lease;

  perform public.generate_rent_schedules_for_lease(p_lease_id);

  insert into public.audit_events (org_id, actor_type, actor_user_id, action, entity_type, entity_id, after)
  values (v_lease.org_id, 'user', auth.uid(), 'lease.activated', 'leases', v_lease.id,
          jsonb_build_object('unitId', v_lease.unit_id, 'startDate', v_lease.start_date));

  return v_lease;
end;
$$;

-- === end_lease(): lease.expired / lease.terminated ===
create or replace function public.end_lease(p_lease_id uuid, p_status public.lease_status)
returns public.leases
language plpgsql
as $$
declare
  v_lease public.leases%rowtype;
  v_property_id uuid;
begin
  if p_status not in ('expired', 'terminated') then
    raise exception 'end_lease can only set status to expired or terminated (got %)', p_status;
  end if;

  select * into v_lease from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Lease not found (or not visible to the caller)';
  end if;

  select property_id into v_property_id from public.units where id = v_lease.unit_id;

  if not public.has_org_role(v_lease.org_id, 'agent') then
    raise exception 'Caller does not have permission to end this lease';
  end if;
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'Caller does not have property-level permission to end this lease';
  end if;

  if v_lease.status <> 'active' then
    raise exception 'Only an active lease can be ended (current status: %)', v_lease.status;
  end if;

  update public.leases set status = p_status where id = p_lease_id
  returning * into v_lease;

  perform public.write_lifecycle_audit_event(
    v_lease.org_id, 'user'::public.audit_actor_type, auth.uid(),
    case when p_status = 'expired' then 'lease.expired' else 'lease.terminated' end,
    'leases', v_lease.id, jsonb_build_object('unitId', v_lease.unit_id));

  return v_lease;
end;
$$;

comment on function public.end_lease(uuid, public.lease_status) is
  'Validated draft-free transition from active to expired/terminated, gated on both org role and
   property-level role. Not security definer for the update itself -- the caller''s own agent+ RLS
   rights on leases already cover the write; the explicit checks above exist because end_lease()
   is still the trusted decision point regardless. Writes its own lease.expired/lease.terminated
   audit_events row (WORKLOG.md 2026-08-25) -- the caller has no other way to know which branch ran.';
