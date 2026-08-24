-- Applicant->tenant->lease V1 (WORKLOG.md 2026-08-25), Phases 4-7: applicant self-service intake.
-- A staff member creates a lightweight application shell (name + unit, same as today) and issues a
-- secure, hashed, expiring bearer token (application_access_tokens, same posture as
-- tenant_invitations, migration 20260101000059, but deliberately NOT tied to a real auth.users
-- account -- the applicant never signs up, they just hold a link). Every applicant-facing read/write
-- goes exclusively through SECURITY DEFINER RPCs that validate the token server-side and touch only
-- the exact rows that token is scoped to -- the applicant role (anon/no session) gets ZERO direct
-- table grants on applications, application_access_tokens, or application_document_requirements,
-- mirroring accept_tenant_invitation()'s "no personal information disclosure before validation"
-- posture.
--
-- New leading application_status value 'invited' represents "a token has been issued, the
-- applicant has not yet completed/submitted the form" -- purely additive to the existing
-- submitted/reviewing/screening/decided/withdrawn lifecycle (existing rows are never affected;
-- staff-direct application creation is unchanged and still defaults straight to 'submitted').
alter type public.application_status add value if not exists 'invited' before 'submitted';

-- Applicant-fillable fields (Phase 5). Deliberately does NOT add a raw ID-number column: this
-- codebase already has an established "no plaintext ID number storage, no write path yet" stance
-- (see tenants.id_number_ref / packages/validation/src/leasing.ts's own comment on it) -- an ID
-- number captured during self-service stays inside the OCR extraction/document-review pipeline
-- (Phase 8-9) rather than duplicating it here in plaintext.
alter table public.applications
  add column date_of_birth date,
  add column current_address text,
  add column employment_status text,
  add column employer_name text,
  add column monthly_income numeric(12,2) check (monthly_income >= 0),
  add column household_size integer check (household_size >= 1),
  add column applicant_notes text,
  add column submitted_at timestamptz;

comment on column public.applications.applicant_notes is
  'Free text the APPLICANT wrote about themselves during self-service intake -- distinct from
   applications.notes, which is staff-internal review notes.';

-- === application_access_tokens ===================================================================

create table public.application_access_tokens (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- sha256 hex digest of the raw token -- the plaintext is returned exactly once, by
  -- create_application_access_token() below, to the caller's own response; never stored, never
  -- logged. No short-code companion (unlike tenant_invitations): the applicant never has an
  -- authenticated account to combine a code with, so a single high-entropy link token (like a
  -- password-reset link) is the whole mechanism.
  token_hash text not null unique,
  delivery_channel text not null check (delivery_channel in ('email', 'whatsapp', 'manual')),
  -- Masked, not the real address/number -- safe to display in a staff-facing status list.
  destination_hint text,
  expires_at timestamptz not null default (now() + interval '14 days'),
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index application_access_tokens_application_idx on public.application_access_tokens (application_id);
create index application_access_tokens_org_idx on public.application_access_tokens (org_id);

-- One active (non-revoked) token per application -- issuing a new one revokes the prior one first
-- (create_application_access_token() does this explicitly; this index is the DB-level backstop,
-- same belt-and-braces pattern as tenant_invitations_one_active_per_tenant).
create unique index application_access_tokens_one_active_per_application
  on public.application_access_tokens (application_id)
  where revoked_at is null;

create or replace function public.check_application_access_token_org_match()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.applications a where a.id = new.application_id and a.org_id = new.org_id) then
    raise exception 'application_access_tokens.org_id must match application_access_tokens.application_id''s own org_id';
  end if;
  return new;
end;
$$;

create trigger application_access_tokens_org_match_check
  before insert or update on public.application_access_tokens
  for each row execute function public.check_application_access_token_org_match();

alter table public.application_access_tokens enable row level security;

-- Staff (agent+ with property access to the application's property, matching applications' own
-- RLS shape exactly) can see and manage invitation tokens for their own org's applications. The
-- applicant gets zero direct table access, before or after issuance -- token validation goes
-- exclusively through the SECURITY DEFINER RPCs below.
create policy "application_access_tokens_select_staff"
  on public.application_access_tokens for select
  using (exists (
    select 1 from public.applications a
    where a.id = application_access_tokens.application_id
      and public.has_org_role(a.org_id, 'agent')
      and (public.has_property_access(a.property_id, 'property_manager') or public.has_property_access(a.property_id, 'owner'))
  ));

create policy "application_access_tokens_insert_staff"
  on public.application_access_tokens for insert
  with check (exists (
    select 1 from public.applications a
    where a.id = application_access_tokens.application_id
      and public.has_org_role(a.org_id, 'agent')
      and (public.has_property_access(a.property_id, 'property_manager') or public.has_property_access(a.property_id, 'owner'))
  ));

create policy "application_access_tokens_update_staff"
  on public.application_access_tokens for update
  using (exists (
    select 1 from public.applications a
    where a.id = application_access_tokens.application_id
      and public.has_org_role(a.org_id, 'agent')
      and (public.has_property_access(a.property_id, 'property_manager') or public.has_property_access(a.property_id, 'owner'))
  ))
  with check (exists (
    select 1 from public.applications a
    where a.id = application_access_tokens.application_id
      and public.has_org_role(a.org_id, 'agent')
      and (public.has_property_access(a.property_id, 'property_manager') or public.has_property_access(a.property_id, 'owner'))
  ));

-- No delete policy -- revoke via update (revoked_at), matching tenant_invitations' own
-- no-hard-delete-on-business-records rule.

-- === application_document_requirements ============================================================

create type public.application_document_status as enum ('requested', 'uploaded', 'reviewed', 'accepted', 'rejected');

create table public.application_document_requirements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Stable machine key ('id_document', 'proof_of_income', 'proof_of_address', ...), not a free-text
  -- label, so the applicant UI/OCR pipeline can address a requirement without string-matching a
  -- human label that staff might rename later.
  requirement_key text not null,
  label text not null,
  is_required boolean not null default true,
  status public.application_document_status not null default 'requested',
  document_id uuid references public.documents(id) on delete set null,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, requirement_key)
);

create index application_document_requirements_application_idx on public.application_document_requirements (application_id);
create index application_document_requirements_org_idx on public.application_document_requirements (org_id);

create trigger set_application_document_requirements_updated_at
  before update on public.application_document_requirements
  for each row execute function public.set_updated_at();

alter table public.application_document_requirements enable row level security;

-- Same staff shape as application_access_tokens. Staff review (accept/reject/status) goes through
-- ordinary RLS-checked UPDATE, not a dedicated RPC -- it's an in-org staff action with no
-- cross-boundary concern, same as applications' own write policy.
create policy "application_document_requirements_select_staff"
  on public.application_document_requirements for select
  using (exists (
    select 1 from public.applications a
    where a.id = application_document_requirements.application_id
      and public.has_org_role(a.org_id, 'agent')
      and (public.has_property_access(a.property_id, 'property_manager') or public.has_property_access(a.property_id, 'owner'))
  ));

create policy "application_document_requirements_update_staff"
  on public.application_document_requirements for update
  using (exists (
    select 1 from public.applications a
    where a.id = application_document_requirements.application_id
      and public.has_org_role(a.org_id, 'agent')
      and (public.has_property_access(a.property_id, 'property_manager') or public.has_property_access(a.property_id, 'owner'))
  ))
  with check (exists (
    select 1 from public.applications a
    where a.id = application_document_requirements.application_id
      and public.has_org_role(a.org_id, 'agent')
      and (public.has_property_access(a.property_id, 'property_manager') or public.has_property_access(a.property_id, 'owner'))
  ));

-- Insert also staff-only (seeding a bespoke extra requirement); the default 3-requirement set is
-- seeded by seed_default_application_document_requirements() below (SECURITY DEFINER, called by the
-- application-creation route immediately after inserting the application row).
create policy "application_document_requirements_insert_staff"
  on public.application_document_requirements for insert
  with check (exists (
    select 1 from public.applications a
    where a.id = application_document_requirements.application_id
      and public.has_org_role(a.org_id, 'agent')
      and (public.has_property_access(a.property_id, 'property_manager') or public.has_property_access(a.property_id, 'owner'))
  ));

-- === documents.application_id ====================================================================

alter table public.documents add column application_id uuid references public.applications(id) on delete set null;
create index documents_application_idx on public.documents (application_id) where application_id is not null;

-- === RPCs =========================================================================================

-- Built-in V1 default requirement set (id/income/address) -- deliberately not a per-org
-- configurable table yet (a real gap, not hidden: see the final report's deferred-items list).
-- Called by the application-creation route right after inserting a self-service application.
create or replace function public.seed_default_application_document_requirements(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.applications where id = p_application_id;
  if v_org_id is null then
    raise exception 'Application not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Caller does not have permission to configure this application''s document requirements';
  end if;

  insert into public.application_document_requirements (application_id, org_id, requirement_key, label, is_required)
  select p_application_id, v_org_id, d.key, d.label, true
  from (values
    ('id_document', 'Copy of ID or passport'),
    ('proof_of_income', 'Proof of income (latest payslip or 3 months'' bank statements)'),
    ('proof_of_address', 'Proof of residential address (utility bill or bank statement, within 3 months)')
  ) as d(key, label)
  on conflict (application_id, requirement_key) do nothing;
end;
$$;

-- Issues (or re-issues, revoking any prior active one) a token for an application. Agent+ with
-- property access, same shape create_tenant_invitation() enforces for tenants.
create or replace function public.create_application_access_token(
  p_application_id uuid,
  p_delivery_channel text default 'email',
  p_destination_hint text default null
)
returns table (token_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
  v_property_id uuid;
  v_token text;
  v_id uuid;
  v_expires_at timestamptz;
begin
  select org_id, property_id into v_org_id, v_property_id from public.applications where id = p_application_id;
  if v_org_id is null then
    raise exception 'Application not found';
  end if;

  if not (public.has_org_role(v_org_id, 'agent')
      and (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner'))) then
    raise exception 'Caller does not have permission to invite this applicant';
  end if;

  if p_delivery_channel not in ('email', 'whatsapp', 'manual') then
    raise exception 'Invalid delivery channel: %', p_delivery_channel;
  end if;

  update public.application_access_tokens
    set revoked_at = now()
    where application_id = p_application_id and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires_at := now() + interval '14 days';

  insert into public.application_access_tokens (
    application_id, org_id, token_hash, delivery_channel, destination_hint, expires_at, created_by_user_id
  ) values (
    p_application_id, v_org_id, encode(digest(v_token, 'sha256'), 'hex'), p_delivery_channel, p_destination_hint, v_expires_at, auth.uid()
  ) returning id into v_id;

  return query select v_id, v_token, v_expires_at;
end;
$$;

-- Read-only, token-authenticated application lookup for the applicant-facing intake page. Never
-- raises for an invalid/expired/revoked token -- returns valid=false with a generic error_code
-- instead (same "don't disclose which failure mode" posture as accept_tenant_invitation()).
create or replace function public.get_application_by_token(p_token text)
returns table (
  valid boolean,
  error_code text,
  application_id uuid,
  org_id uuid,
  property_id uuid,
  unit_id uuid,
  status public.application_status,
  applicant_name text,
  applicant_email citext,
  applicant_phone text,
  date_of_birth date,
  current_address text,
  employment_status text,
  employer_name text,
  monthly_income numeric,
  household_size integer,
  applicant_notes text,
  popia_consent_at timestamptz,
  property_nickname text,
  unit_label text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_row public.application_access_tokens%rowtype;
  v_app public.applications%rowtype;
begin
  select * into v_token_row from public.application_access_tokens
    where token_hash = encode(digest(p_token, 'sha256'), 'hex');

  if not found or v_token_row.revoked_at is not null or v_token_row.expires_at <= now() then
    return query select
      false, (case
        when not found then 'not_found'
        when v_token_row.revoked_at is not null then 'revoked'
        else 'expired'
      end)::text,
      null::uuid, null::uuid, null::uuid, null::uuid, null::public.application_status,
      null::text, null::citext, null::text, null::date, null::text, null::text, null::text,
      null::numeric, null::integer, null::text, null::timestamptz, null::text, null::text;
    return;
  end if;

  select * into v_app from public.applications where id = v_token_row.application_id;

  update public.application_access_tokens set last_accessed_at = now() where id = v_token_row.id;

  return query
    select true, null::text, v_app.id, v_app.org_id, v_app.property_id, v_app.unit_id, v_app.status,
      v_app.applicant_name, v_app.applicant_email, v_app.applicant_phone, v_app.date_of_birth,
      v_app.current_address, v_app.employment_status, v_app.employer_name, v_app.monthly_income,
      v_app.household_size, v_app.applicant_notes, v_app.popia_consent_at,
      p.nickname, u.unit_label
    from public.properties p, public.units u
    where p.id = v_app.property_id and u.id = v_app.unit_id;
end;
$$;

-- Token-authenticated self-service submission. Whitelists exactly the applicant-fillable columns
-- (never notes/decision/screening_status/etc). Idempotent while the application is still editable
-- (invited/submitted/reviewing); refuses once staff has moved it past that point. Requires POPIA
-- consent to actually complete the submission (screening consent stays a separate, later step, same
-- as the existing staff-facing consent endpoint already treats it).
create or replace function public.submit_application_by_token(
  p_token text,
  p_applicant_name text,
  p_applicant_email citext default null,
  p_applicant_phone text default null,
  p_date_of_birth date default null,
  p_current_address text default null,
  p_employment_status text default null,
  p_employer_name text default null,
  p_monthly_income numeric default null,
  p_household_size integer default null,
  p_applicant_notes text default null,
  p_popia_consent boolean default false
)
returns table (success boolean, error_code text, application_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_row public.application_access_tokens%rowtype;
  v_app public.applications%rowtype;
begin
  select * into v_token_row from public.application_access_tokens
    where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    for update;

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
  if p_applicant_name is null or trim(p_applicant_name) = '' then
    return query select false, 'name_required'::text, null::uuid;
    return;
  end if;
  if p_popia_consent is not true then
    return query select false, 'consent_required'::text, null::uuid;
    return;
  end if;

  select * into v_app from public.applications where id = v_token_row.application_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  if v_app.status not in ('invited', 'submitted', 'reviewing') then
    return query select false, 'not_editable'::text, null::uuid;
    return;
  end if;

  update public.applications set
    applicant_name = trim(p_applicant_name),
    applicant_email = coalesce(p_applicant_email, applicant_email),
    applicant_phone = coalesce(p_applicant_phone, applicant_phone),
    date_of_birth = p_date_of_birth,
    current_address = p_current_address,
    employment_status = p_employment_status,
    employer_name = p_employer_name,
    monthly_income = p_monthly_income,
    household_size = p_household_size,
    applicant_notes = p_applicant_notes,
    popia_consent_at = coalesce(popia_consent_at, now()),
    status = case when status = 'invited' then 'submitted' else status end,
    submitted_at = coalesce(submitted_at, now())
  where id = v_app.id;

  update public.application_access_tokens set last_accessed_at = now() where id = v_token_row.id;

  insert into public.audit_events (org_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_app.org_id, 'system', 'application.submitted_by_applicant', 'applications', v_app.id,
    jsonb_build_object('tokenId', v_token_row.id)
  );

  return query select true, null::text, v_app.id;
end;
$$;

comment on function public.submit_application_by_token(text, text, citext, text, date, text, text, text, numeric, integer, text, boolean) is
  'Token-authenticated applicant self-service submission (Phase 4-7, migration 20260101000132).
   Idempotent while the application is still invited/submitted/reviewing. actor_type=''system'' in
   the audit event since there is no real auth.users identity for an applicant -- the token id in
   the payload is how a reviewer distinguishes this from a genuine cron/system action.';

-- Token-authenticated document-upload recording. The actual file bytes are uploaded to Storage by
-- the API route using the service-role client (never exposed to the browser) ONLY after this
-- function's token validation succeeds -- this function is what makes that narrow, audited, and
-- confined to exactly the one requirement being fulfilled (never an arbitrary write).
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

  insert into public.documents (
    property_id, category_id, document_type, storage_path, original_file_name, mime_type,
    file_size_bytes, checksum_sha256, org_id, application_id
  ) values (
    v_app.property_id, v_category_id, 'other', p_storage_path, p_original_file_name, p_mime_type,
    p_file_size_bytes, p_checksum_sha256, v_app.org_id, v_app.id
  ) returning id into v_document_id;

  update public.application_document_requirements
    set status = 'uploaded', document_id = v_document_id, reviewed_by = null, reviewed_at = null, rejection_reason = null, updated_at = now()
    where id = v_requirement.id;

  update public.application_access_tokens set last_accessed_at = now() where id = v_token_row.id;

  insert into public.audit_events (org_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_app.org_id, 'system', 'application_document.uploaded', 'application_document_requirements', v_requirement.id,
    jsonb_build_object('requirementKey', p_requirement_key, 'documentId', v_document_id, 'tokenId', v_token_row.id)
  );

  return query select true, null::text, v_document_id;
end;
$$;

-- approve_application() must refuse an application the applicant never actually completed --
-- re-created here (same 20260101000131 body) with one added guard.
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
  end if;

  insert into public.leases (
    org_id, unit_id, start_date, rent_amount, deposit_amount, status, source, source_application_id
  )
  values (
    v_app.org_id, v_app.unit_id, current_date, 0, 0, 'draft', 'application_approved', v_app.id
  )
  returning id into v_lease_id;

  insert into public.lease_tenants (lease_id, tenant_id, is_primary)
  values (v_lease_id, v_tenant_id, true);

  update public.applications
  set status = 'decided', decision = 'approved', decided_by = auth.uid(), decided_at = now()
  where id = p_application_id;

  return v_lease_id;
end;
$function$;
