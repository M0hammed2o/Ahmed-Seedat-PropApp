-- Applicant->tenant->lease V1 continuation (WORKLOG.md 2026-08-25), Phases L/N/R/S/X: lease
-- preparation workflow + generated/uploaded document versioning + the review/send/activation gate.
--
-- Deliberately does NOT touch `leases.status` (draft/active/expired/terminated) or the existing
-- occupancy trigger -- both are already correct (verified this session). Instead, an auxiliary
-- 1:1 table (`lease_preparations`) carries the review/send workflow stage and the commercial
-- "extras" not already columns on `leases` (parking, utilities, special conditions, due day,
-- escalation, approved occupants). This keeps activate_lease()'s own semantics ("draft -> active")
-- completely unchanged for the manual-lease path, which never touches this table at all.

create type public.lease_preparation_status as enum ('drafting', 'reviewed', 'sent');

create table public.lease_preparations (
  lease_id uuid primary key references public.leases(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  status public.lease_preparation_status not null default 'drafting',
  template_id uuid references public.lease_templates(id),
  approved_occupants text,
  parking text,
  utilities text,
  special_conditions text,
  rental_due_day integer check (rental_due_day between 1 and 31),
  annual_escalation_pct numeric(5,2) check (annual_escalation_pct is null or annual_escalation_pct >= 0),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  sent_by uuid references auth.users(id),
  sent_at timestamptz,
  -- Lease acceptance V1 (Phase W) -- explicitly NOT a certified e-signature. Exactly one of these
  -- two paths records "the tenant has this lease and it's considered in force for V1 purposes":
  -- the tenant's own in-portal acknowledgement click, or staff recording that a signed copy was
  -- returned by another channel (email/in person) and uploaded manually.
  tenant_acknowledged_at timestamptz,
  staff_confirmed_signed_at timestamptz,
  staff_confirmed_signed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lease_preparations_org_idx on public.lease_preparations (org_id);

create trigger set_lease_preparations_updated_at
  before update on public.lease_preparations
  for each row execute function public.set_updated_at();

create or replace function public.check_lease_preparation_org_match()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.leases l where l.id = new.lease_id and l.org_id = new.org_id) then
    raise exception 'lease_preparations.org_id must match lease_preparations.lease_id''s own org_id';
  end if;
  return new;
end;
$$;

create trigger lease_preparations_org_match_check
  before insert or update on public.lease_preparations
  for each row execute function public.check_lease_preparation_org_match();

alter table public.lease_preparations enable row level security;

-- Same shape as leases' own write policy (agent+ AND property-scoped, joined through the lease's
-- unit) -- lease preparation is exactly as sensitive as the lease itself.
create policy "lease_preparations_select_staff"
  on public.lease_preparations for select
  using (exists (
    select 1 from public.leases l join public.units u on u.id = l.unit_id
    where l.id = lease_preparations.lease_id
      and public.has_org_role(l.org_id, 'agent')
      and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
  ));

create policy "lease_preparations_insert_staff"
  on public.lease_preparations for insert
  with check (exists (
    select 1 from public.leases l join public.units u on u.id = l.unit_id
    where l.id = lease_preparations.lease_id
      and public.has_org_role(l.org_id, 'agent')
      and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
  ));

create policy "lease_preparations_update_staff"
  on public.lease_preparations for update
  using (exists (
    select 1 from public.leases l join public.units u on u.id = l.unit_id
    where l.id = lease_preparations.lease_id
      and public.has_org_role(l.org_id, 'agent')
      and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
  ))
  with check (exists (
    select 1 from public.leases l join public.units u on u.id = l.unit_id
    where l.id = lease_preparations.lease_id
      and public.has_org_role(l.org_id, 'agent')
      and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
  ));

-- Tenant-portal acknowledgement path (Phase V/W): the tenant on the lease can set (only)
-- tenant_acknowledged_at on their own lease, and only once (never clear it, never touch any other
-- column -- enforced by the trigger below, not just application-layer trust).
create policy "lease_preparations_select_tenant_self"
  on public.lease_preparations for select
  using (public.caller_is_tenant_of_lease(lease_id));

create policy "lease_preparations_tenant_acknowledge"
  on public.lease_preparations for update
  using (public.caller_is_tenant_of_lease(lease_id) and tenant_acknowledged_at is null)
  with check (public.caller_is_tenant_of_lease(lease_id));

create or replace function public.check_tenant_acknowledgement_only()
returns trigger
language plpgsql
as $$
begin
  -- A tenant-role update (no org_role/property_access for this org -- i.e. reached this trigger
  -- via the tenant policy, not the staff one) may only ever set tenant_acknowledged_at, and only
  -- from null to now(); every other column must be unchanged.
  if not (public.has_org_role(new.org_id, 'agent')) then
    if old.tenant_acknowledged_at is not null then
      raise exception 'This lease has already been acknowledged';
    end if;
    if new.status is distinct from old.status
      or new.template_id is distinct from old.template_id
      or new.approved_occupants is distinct from old.approved_occupants
      or new.parking is distinct from old.parking
      or new.utilities is distinct from old.utilities
      or new.special_conditions is distinct from old.special_conditions
      or new.rental_due_day is distinct from old.rental_due_day
      or new.annual_escalation_pct is distinct from old.annual_escalation_pct
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.sent_by is distinct from old.sent_by
      or new.sent_at is distinct from old.sent_at
      or new.staff_confirmed_signed_at is distinct from old.staff_confirmed_signed_at
      or new.staff_confirmed_signed_by is distinct from old.staff_confirmed_signed_by
    then
      raise exception 'A tenant may only acknowledge a lease, not edit it';
    end if;
  end if;
  return new;
end;
$$;

create trigger lease_preparations_tenant_acknowledge_guard
  before update on public.lease_preparations
  for each row execute function public.check_tenant_acknowledgement_only();

-- === lease_documents (Phase N: append-only version history) =====================================

create type public.lease_document_kind as enum ('generated', 'uploaded');
create type public.lease_document_status as enum ('draft', 'issued', 'superseded');

create table public.lease_documents (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.leases(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind public.lease_document_kind not null,
  status public.lease_document_status not null default 'draft',
  version integer not null,
  template_id uuid references public.lease_templates(id),
  storage_path text not null,
  original_file_name text,
  mime_type text not null,
  file_size_bytes bigint not null,
  generated_by uuid references auth.users(id),
  generated_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  sent_by uuid references auth.users(id),
  sent_at timestamptz,
  supersedes_document_id uuid references public.lease_documents(id),
  created_at timestamptz not null default now(),
  unique (lease_id, version)
);

create index lease_documents_lease_idx on public.lease_documents (lease_id);
create index lease_documents_org_idx on public.lease_documents (org_id);

-- At most one non-superseded ("current") document per lease -- generating/uploading a replacement
-- must supersede the prior one first (application layer does this; this index is the backstop).
create unique index lease_documents_one_current_per_lease
  on public.lease_documents (lease_id)
  where status <> 'superseded';

create or replace function public.check_lease_document_org_match()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.leases l where l.id = new.lease_id and l.org_id = new.org_id) then
    raise exception 'lease_documents.org_id must match lease_documents.lease_id''s own org_id';
  end if;
  return new;
end;
$$;

create trigger lease_documents_org_match_check
  before insert or update on public.lease_documents
  for each row execute function public.check_lease_document_org_match();

alter table public.lease_documents enable row level security;

create policy "lease_documents_select_staff"
  on public.lease_documents for select
  using (exists (
    select 1 from public.leases l join public.units u on u.id = l.unit_id
    where l.id = lease_documents.lease_id
      and public.has_org_role(l.org_id, 'agent')
      and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
  ));

create policy "lease_documents_insert_staff"
  on public.lease_documents for insert
  with check (exists (
    select 1 from public.leases l join public.units u on u.id = l.unit_id
    where l.id = lease_documents.lease_id
      and public.has_org_role(l.org_id, 'agent')
      and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
  ));

create policy "lease_documents_update_staff"
  on public.lease_documents for update
  using (exists (
    select 1 from public.leases l join public.units u on u.id = l.unit_id
    where l.id = lease_documents.lease_id
      and public.has_org_role(l.org_id, 'agent')
      and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
  ))
  with check (exists (
    select 1 from public.leases l join public.units u on u.id = l.unit_id
    where l.id = lease_documents.lease_id
      and public.has_org_role(l.org_id, 'agent')
      and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
  ));

-- Tenant-portal read of their own lease's CURRENT issued document only -- never a draft/superseded
-- one (a draft may contain unreviewed/incorrect terms; superseded history is a staff-only record).
create policy "lease_documents_select_tenant_self"
  on public.lease_documents for select
  using (status = 'issued' and public.caller_is_tenant_of_lease(lease_id));

-- No delete policy anywhere -- append-only, matches every other document-history table in this
-- codebase (lease_templates, documents).

-- === Review acknowledgement + explicit send (Phase R/S) ==========================================

-- The explicit "I confirm the lease details are correct and ready to send" checkbox, enforced
-- server-side (not just a UI affordance): validates every precondition the review gate requires
-- before recording reviewed_by/reviewed_at and advancing lease_preparations.status.
create or replace function public.acknowledge_lease_review(p_lease_id uuid)
returns public.lease_preparations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease public.leases%rowtype;
  v_property_id uuid;
  v_prep public.lease_preparations%rowtype;
  v_tenant_count integer;
  v_document_count integer;
begin
  select * into v_lease from public.leases where id = p_lease_id;
  if not found then
    raise exception 'Lease not found';
  end if;

  select property_id into v_property_id from public.units where id = v_lease.unit_id;
  if not (public.has_org_role(v_lease.org_id, 'agent')
      and (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner'))) then
    raise exception 'Caller does not have permission to review this lease';
  end if;

  if v_lease.status <> 'draft' then
    raise exception 'Only a draft lease can be reviewed for sending (current status: %)', v_lease.status;
  end if;

  select count(*) into v_tenant_count from public.lease_tenants where lease_id = p_lease_id;
  if v_tenant_count = 0 then
    raise exception 'Assign a tenant before reviewing this lease';
  end if;
  if v_lease.rent_amount <= 0 then
    raise exception 'Set a rent amount greater than zero before reviewing this lease';
  end if;
  if v_lease.start_date is null then
    raise exception 'Set a start date before reviewing this lease';
  end if;

  select count(*) into v_document_count from public.lease_documents
    where lease_id = p_lease_id and status = 'draft';
  if v_document_count = 0 then
    raise exception 'Generate or upload a lease document before reviewing this lease';
  end if;

  insert into public.lease_preparations (lease_id, org_id, status, reviewed_by, reviewed_at)
  values (p_lease_id, v_lease.org_id, 'reviewed', auth.uid(), now())
  on conflict (lease_id) do update
    set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
  returning * into v_prep;

  update public.lease_documents
    set reviewed_by = auth.uid(), reviewed_at = now()
    where lease_id = p_lease_id and status = 'draft';

  return v_prep;
end;
$$;

comment on function public.acknowledge_lease_review(uuid) is
  'Server-enforced "ready to send" review gate (Phase R): tenant assigned, rent > 0, start date
   set, and a draft lease document exists. Records reviewed_by/at on both lease_preparations and
   the current draft lease_documents row.';

-- Explicit send -- pending/declined applicants are structurally impossible here (a draft lease can
-- only exist once approve_application() has already run, which itself refuses a not-yet-decided
-- application), but this still re-asserts approved-if-application-sourced defensively, per Phase S's
-- explicit requirement. Idempotent: re-sending the SAME already-issued document is a no-op success
-- (used for "resend the email" without ever minting a new document version).
create or replace function public.send_lease(p_lease_id uuid)
returns public.lease_preparations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease public.leases%rowtype;
  v_property_id uuid;
  v_prep public.lease_preparations%rowtype;
  v_app_decision public.application_decision;
begin
  select * into v_lease from public.leases where id = p_lease_id;
  if not found then
    raise exception 'Lease not found';
  end if;

  select property_id into v_property_id from public.units where id = v_lease.unit_id;
  if not (public.has_org_role(v_lease.org_id, 'agent')
      and (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner'))) then
    raise exception 'Caller does not have permission to send this lease';
  end if;

  if v_lease.source_application_id is not null then
    select decision into v_app_decision from public.applications where id = v_lease.source_application_id;
    if v_app_decision is distinct from 'approved' then
      raise exception 'This lease''s source application is not approved -- send denied';
    end if;
  end if;

  select * into v_prep from public.lease_preparations where lease_id = p_lease_id;
  if not found or v_prep.status = 'drafting' then
    raise exception 'Complete the review acknowledgement before sending this lease';
  end if;

  -- Idempotent: already sent and nothing new to send.
  if v_prep.status = 'sent' and not exists (
    select 1 from public.lease_documents where lease_id = p_lease_id and status = 'draft'
  ) then
    return v_prep;
  end if;

  update public.lease_documents
    set status = 'issued', sent_by = auth.uid(), sent_at = now()
    where lease_id = p_lease_id and status = 'draft';

  update public.lease_preparations
    set status = 'sent', sent_by = auth.uid(), sent_at = now()
    where lease_id = p_lease_id
    returning * into v_prep;

  return v_prep;
end;
$$;

comment on function public.send_lease(uuid) is
  'Explicit lease send (Phase S). Requires acknowledge_lease_review() to have already run. Refuses
   if the source application is not approved (structurally already guaranteed, re-checked
   defensively). Marks the current draft lease_documents row issued+sent. Idempotent when already
   sent with no new draft document pending.';

-- === Activation gate extension (Phase X) ==========================================================
-- Manual leases (source <> 'application_approved') are completely unaffected -- this new branch
-- only ever applies to an application-sourced lease, and only requires it's been sent AND either
-- tenant-acknowledged or staff-confirmed-signed (Phase W's two V1 acceptance paths). Every
-- pre-existing check (tenant assigned, rent > 0, start date, no conflicting active lease) is
-- untouched from the current function (migration 20260101000078).
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

  return v_lease;
end;
$$;
