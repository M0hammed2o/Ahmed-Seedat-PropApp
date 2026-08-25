-- Applicant->tenant->lease V1 continuation (WORKLOG.md 2026-08-25), Phase H: affirmative WhatsApp
-- consent for applicants -- explicitly NOT the existing default-on notification_preferences model
-- (that model requires a real auth.users identity to check against at all, which an applicant
-- structurally never has, and is opt-OUT rather than opt-IN). A real, timestamped, revocable
-- opt-in record, captured on the same form as POPIA consent (submit_application_by_token()).

create table public.applicant_whatsapp_consents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null,
  opted_in_at timestamptz not null default now(),
  source text not null default 'application_portal',
  scope text not null default 'application_and_lease_updates',
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  unique (application_id)
);

create index applicant_whatsapp_consents_org_idx on public.applicant_whatsapp_consents (org_id);

create or replace function public.check_applicant_whatsapp_consent_org_match()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.applications a where a.id = new.application_id and a.org_id = new.org_id) then
    raise exception 'applicant_whatsapp_consents.org_id must match applicant_whatsapp_consents.application_id''s own org_id';
  end if;
  return new;
end;
$$;

create trigger applicant_whatsapp_consents_org_match_check
  before insert or update on public.applicant_whatsapp_consents
  for each row execute function public.check_applicant_whatsapp_consent_org_match();

alter table public.applicant_whatsapp_consents enable row level security;

-- Staff-read only (agent+, property-scoped via the application) -- no direct write grant for
-- anyone; the applicant records their own consent exclusively via submit_application_by_token()
-- below (SECURITY DEFINER), never a direct table write.
create policy "applicant_whatsapp_consents_select_staff"
  on public.applicant_whatsapp_consents for select
  using (exists (
    select 1 from public.applications a
    where a.id = applicant_whatsapp_consents.application_id
      and public.has_org_role(a.org_id, 'agent')
      and (public.has_property_access(a.property_id, 'property_manager') or public.has_property_access(a.property_id, 'owner'))
  ));

-- submit_application_by_token() rewritten to additionally accept + record WhatsApp consent
-- (same whitelisted-columns-only shape as before, plus this one new side effect). Everything else
-- about this function is unchanged from 20260101000132. Drops the old 12-parameter signature first
-- -- CREATE OR REPLACE with new trailing parameters would otherwise create a second overload
-- alongside it (PostgREST/RPC callers would then risk "could not choose the best candidate
-- function" ambiguity), not actually replace it.
drop function if exists public.submit_application_by_token(text, text, citext, text, date, text, text, text, numeric, integer, text, boolean);

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
  p_popia_consent boolean default false,
  p_whatsapp_consent boolean default false,
  p_whatsapp_phone text default null
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

  if p_whatsapp_consent is true and p_whatsapp_phone is not null and trim(p_whatsapp_phone) <> '' then
    insert into public.applicant_whatsapp_consents (application_id, org_id, phone, source)
    values (v_app.id, v_app.org_id, p_whatsapp_phone, 'application_portal')
    on conflict (application_id) do update
      set phone = excluded.phone, opted_in_at = now(), opted_out_at = null;
  end if;

  update public.application_access_tokens set last_accessed_at = now() where id = v_token_row.id;

  insert into public.audit_events (org_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_app.org_id, 'system', 'application.submitted_by_applicant', 'applications', v_app.id,
    jsonb_build_object('tokenId', v_token_row.id, 'whatsappConsent', p_whatsapp_consent is true)
  );

  return query select true, null::text, v_app.id;
end;
$$;

comment on function public.submit_application_by_token(text, text, citext, text, date, text, text, text, numeric, integer, text, boolean, boolean, text) is
  'Token-authenticated applicant self-service submission (Phase 4-7/H, migrations
   20260101000132/135). Idempotent while the application is still invited/submitted/reviewing.
   Records an affirmative, timestamped WhatsApp opt-in only when p_whatsapp_consent is explicitly
   true -- never inferred, never defaulted on.';
