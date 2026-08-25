-- First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 1-2: applicant document OCR.
-- New document_type values so applicant-uploaded ID/proof-of-address/payslip/bank-statement
-- documents are classified correctly (previously always inserted as 'other', which the extract
-- route's own SUPPORTED_TYPES check would have refused field extraction for).
alter type public.document_type add value if not exists 'id_document';
alter type public.document_type add value if not exists 'proof_of_address';
alter type public.document_type add value if not exists 'payslip';
alter type public.document_type add value if not exists 'bank_statement';

-- Correction tracking (Phase 2/3): raw = documents.storage_path's own extraction_results row
-- (unchanged, already exists); suggested = raw_provider_output's per-field ExtractedField;
-- corrected = this new column, written only when a human actually changes a value during review;
-- authoritative = the real applications/tenants/leases column, which is NEVER written by OCR
-- directly -- only ever by the applicant's own submit_application_by_token() call (or staff typing
-- into a normal form), after they've reviewed/corrected the suggestion. This column exists purely
-- for traceability/QA ("how often does OCR need correcting"), not as a write path to anything.
alter table public.extraction_results add column corrected_fields jsonb;

comment on column public.extraction_results.corrected_fields is
  'Human corrections recorded during review (Phase 3, first-tenant-workflow predeploy pass) -- a
   map of field name to corrected value, written by POST .../corrections. Never a write path to
   applications/tenants/leases itself; those are only ever written by the applicant''s own
   submit action (or staff typing into a form) after reviewing this alongside the raw suggestion.';

-- record_application_document_upload() (originally 20260101000132, unchanged behaviour otherwise)
-- now classifies the created documents row by requirement_key instead of always inserting 'other'
-- -- necessary for the extract route's SUPPORTED_TYPES check to ever allow OCR on an applicant
-- document at all.
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
    v_app.org_id, 'system', 'application.document_uploaded', 'application_document_requirements', v_requirement.id,
    jsonb_build_object('requirementKey', p_requirement_key, 'documentId', v_document_id, 'tokenId', v_token_row.id)
  );

  return query select true, null::text, v_document_id;
end;
$$;
