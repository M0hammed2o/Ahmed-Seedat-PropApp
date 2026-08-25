-- First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 1/3: the applicant OCR
-- review UI needs to know WHICH documents row a given requirement's upload created, to call
-- POST .../documents/:documentId/extract for it. get_application_document_requirements_by_token()
-- (originally 20260101000133) is extended to return document_id alongside everything it already did.

drop function if exists public.get_application_document_requirements_by_token(text);

create or replace function public.get_application_document_requirements_by_token(p_token text)
returns table (
  requirement_key text,
  label text,
  is_required boolean,
  status public.application_document_status,
  rejection_reason text,
  document_id uuid
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_row public.application_access_tokens%rowtype;
begin
  select * into v_token_row from public.application_access_tokens
    where token_hash = encode(digest(p_token, 'sha256'), 'hex');

  if not found or v_token_row.revoked_at is not null or v_token_row.expires_at <= now() then
    return;
  end if;

  return query
    select r.requirement_key, r.label, r.is_required, r.status, r.rejection_reason, r.document_id
    from public.application_document_requirements r
    where r.application_id = v_token_row.application_id
    order by r.created_at asc;
end;
$$;

comment on function public.get_application_document_requirements_by_token(text) is
  'Token-authenticated read of an application''s document-requirement checklist, including the
   linked documents.id so the applicant portal can trigger OCR on a specific uploaded document
   (Phase 1/3, first-tenant-workflow predeploy pass). Returns zero rows for an invalid/expired/
   revoked token rather than raising.';
