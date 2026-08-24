-- Applicant->tenant->lease V1 (WORKLOG.md 2026-08-25), Phase 6/7 follow-up: the applicant intake
-- page needs to show its own document-requirement checklist (which documents are still needed,
-- which have been uploaded/accepted/rejected) -- application_document_requirements has zero
-- applicant-facing RLS grant by design (staff-only table), so this is read exclusively through a
-- token-authenticated RPC, same posture as get_application_by_token().

create or replace function public.get_application_document_requirements_by_token(p_token text)
returns table (
  requirement_key text,
  label text,
  is_required boolean,
  status public.application_document_status,
  rejection_reason text
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
    select r.requirement_key, r.label, r.is_required, r.status, r.rejection_reason
    from public.application_document_requirements r
    where r.application_id = v_token_row.application_id
    order by r.created_at asc;
end;
$$;

comment on function public.get_application_document_requirements_by_token(text) is
  'Token-authenticated read of an application''s document-requirement checklist (Phase 6/7,
   migration 20260101000132). Returns zero rows for an invalid/expired/revoked token rather than
   raising -- same "fail closed, quiet" posture as get_application_by_token().';
