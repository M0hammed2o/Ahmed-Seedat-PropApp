-- Property rules / occupant compliance / body corporate / managing agent / levy statement
-- workflow (WORKLOG.md this date). Extends Proplyst from plain document storage into structured,
-- auditable compliance evidence -- reuses the existing `documents`/`document_categories` model
-- (a rule or levy statement PDF remains a real `documents` row; this migration adds structured
-- metadata layered on top, not a parallel file-storage system), the existing
-- has_org_role()/caller_tenant_ids()/caller_is_tenant_of_lease() RLS helpers, and the existing
-- extraction_jobs/extraction_results OCR pipeline. Nothing here touches accounting (Chart of
-- Accounts/journal_entries/owner_statements) -- levy-statement line items are reviewed and stored,
-- never auto-posted (see levy_statements.status: 'reviewed' is the final state this migration
-- supports; converting a reviewed line item into an actual ledger entry is a deliberately
-- out-of-scope follow-up, not guessed at here).
--
-- Reuses `document_categories` rows already seeded by earlier migrations: 'compliance_documents'
-- (20260101000007) for rule PDFs, 'levies' (20260101000007) for levy statement PDFs -- no new
-- category rows needed.

-- ============================================================
-- PROPERTY RULES + VERSIONING
-- ============================================================

-- Deliberately a real enum (not a lookup table) -- this is a small, genuinely bounded set the
-- same way document_type already is; 'other_compliance_document' is the escape hatch so an
-- unanticipated document kind is never blocked from being uploaded.
create type public.compliance_document_category as enum (
  'conduct_rules',
  'body_corporate_rules',
  'estate_rules',
  'house_rules',
  'csos_rules',
  'welcome_pack',
  'rule_amendment',
  'occupant_policy',
  'other_compliance_document'
);

-- One row per named rule "family" for a property (e.g. "Conduct Rules") -- versions (below) are
-- what actually carry a document/effective-date/status. Deliberately property-scoped, not
-- unit-scoped: every uploaded reference document (conduct rules, CSOS rules) applies scheme-wide
-- in the source material, not per-unit; a future unit-specific rule can still reuse this same
-- shape by adding a nullable unit_id later without breaking anything built here.
create table public.property_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  category public.compliance_document_category not null,
  title text not null check (char_length(title) between 1 and 200),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index property_rules_org_idx on public.property_rules (org_id);
create index property_rules_property_idx on public.property_rules (property_id);

create trigger set_property_rules_updated_at
  before update on public.property_rules
  for each row execute function public.set_updated_at();

alter table public.property_rules enable row level security;

create policy "property_rules_select_org_member"
  on public.property_rules for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "property_rules_write_agent_plus"
  on public.property_rules for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- Tenant read access to a specific rule is derived entirely through having an assigned
-- compliance_requirement (below) -- a tenant never sees every rule a property has, only the ones
-- actually assigned to their own tenancy (current or historical). Defined after
-- compliance_requirements exists (see further down this file).

create type public.property_rule_version_status as enum ('draft', 'active', 'superseded', 'archived');

create table public.property_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.property_rules(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id),
  version_number integer not null check (version_number > 0),
  status public.property_rule_version_status not null default 'draft',
  effective_date date not null,
  expiry_date date,
  acknowledgement_required boolean not null default true,
  superseded_by uuid references public.property_rule_versions(id),
  created_by uuid not null references auth.users(id),
  activated_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, version_number),
  check (expiry_date is null or expiry_date > effective_date)
);

-- One active version per rule at a time -- same partial-unique-index backstop pattern as
-- tenant_invitations_one_active_per_tenant (20260101000059): activate_property_rule_version()
-- below also supersedes the prior active row first, this is the DB-level guarantee regardless.
create unique index property_rule_versions_one_active_per_rule
  on public.property_rule_versions (rule_id)
  where status = 'active';

create index property_rule_versions_rule_idx on public.property_rule_versions (rule_id);
create index property_rule_versions_org_idx on public.property_rule_versions (org_id);

create trigger set_property_rule_versions_updated_at
  before update on public.property_rule_versions
  for each row execute function public.set_updated_at();

alter table public.property_rule_versions enable row level security;

create policy "property_rule_versions_select_org_member"
  on public.property_rule_versions for select
  using (public.has_org_role(org_id, 'viewer'));

-- No direct insert/update policy for staff -- creation/activation/supersession only ever happen
-- through create_property_rule_version()/activate_property_rule_version() below (SECURITY
-- DEFINER), so version_number sequencing and the "never mutate a version once acknowledgements
-- exist" rule can't be bypassed by a raw client write.

-- ============================================================
-- COMPLIANCE REQUIREMENTS + ACKNOWLEDGEMENTS
-- ============================================================

create type public.compliance_requirement_status as enum (
  'pending', 'viewed', 'acknowledged', 'waived', 'superseded'
);

-- Tenancy-specific assignment of one rule version. Deliberately keyed by tenant_id (not
-- lease_id) as the primary scoping column -- PERMISSIONS.md's tenant-self-access pattern
-- throughout this codebase (rent_schedules, invoices, maintenance_tickets) already scopes by
-- tenant_id via caller_tenant_ids(), and a rule assignment is a property-de-facto-tenancy concept
-- that should survive a lease renewal the same tenant continues into. lease_id is kept as
-- denormalized context (which specific lease was active at assignment time), never the
-- authorization key.
create table public.compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  rule_version_id uuid not null references public.property_rule_versions(id),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lease_id uuid references public.leases(id) on delete set null,
  status public.compliance_requirement_status not null default 'pending',
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  viewed_at timestamptz,
  acknowledged_at timestamptz,
  waived_at timestamptz,
  waived_by uuid references auth.users(id),
  waived_reason text,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rule_version_id, tenant_id)
);

create index compliance_requirements_org_idx on public.compliance_requirements (org_id);
create index compliance_requirements_property_idx on public.compliance_requirements (property_id);
create index compliance_requirements_tenant_idx on public.compliance_requirements (tenant_id);
create index compliance_requirements_rule_version_idx on public.compliance_requirements (rule_version_id);
-- Owner/staff dashboard's primary query shape: "outstanding requirements for this property".
create index compliance_requirements_outstanding_idx
  on public.compliance_requirements (property_id, status)
  where status in ('pending', 'viewed');

alter table public.compliance_requirements enable row level security;

create policy "compliance_requirements_select_org_member"
  on public.compliance_requirements for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "compliance_requirements_select_tenant_self"
  on public.compliance_requirements for select
  using (tenant_id in (select public.caller_tenant_ids()));

-- No client insert/update/delete policy anywhere -- every mutation (assignment on activation,
-- viewed-marking, acknowledgement, waiving) goes through a SECURITY DEFINER function below so the
-- status state machine (PENDING -> VIEWED -> ACKNOWLEDGED, or -> WAIVED, or -> SUPERSEDED) can
-- never be bypassed by a raw client write from either a tenant or staff.

-- Now that compliance_requirements exists, a tenant may read exactly the rule/version/document
-- rows they have (or had) an assignment for -- current AND historical, so an old, superseded
-- version they acknowledged remains visible ("Conduct Rules v1 -- Acknowledged [date]").
create policy "property_rule_versions_select_tenant_self"
  on public.property_rule_versions for select
  using (
    exists (
      select 1 from public.compliance_requirements cr
      where cr.rule_version_id = property_rule_versions.id
        and cr.tenant_id in (select public.caller_tenant_ids())
    )
  );

create policy "property_rules_select_tenant_self"
  on public.property_rules for select
  using (
    exists (
      select 1 from public.property_rule_versions prv
      join public.compliance_requirements cr on cr.rule_version_id = prv.id
      where prv.rule_id = property_rules.id
        and cr.tenant_id in (select public.caller_tenant_ids())
    )
  );

-- Narrower grant on `documents` itself (mirrors documents_select_tenant_self's own "adds a
-- narrower grant via a join" pattern, 20260101000033) -- a tenant can read the underlying PDF row
-- for a rule version they have an assignment for, without gaining any broader property-document
-- access (owner-only paperwork on the same property stays invisible).
create policy "documents_select_tenant_compliance"
  on public.documents for select
  using (
    exists (
      select 1 from public.property_rule_versions prv
      join public.compliance_requirements cr on cr.rule_version_id = prv.id
      where prv.document_id = documents.id
        and cr.tenant_id in (select public.caller_tenant_ids())
    )
  );

-- Immutable acknowledgement evidence -- append-only, matching user_terms_acceptances'
-- (20260101000005) own "never edited" posture exactly. One row per requirement (enforced by the
-- unique constraint below), never migrated to point at a different version.
create table public.compliance_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null unique references public.compliance_requirements(id),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  rule_version_id uuid not null references public.property_rule_versions(id),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lease_id uuid references public.leases(id) on delete set null,
  user_id uuid not null references auth.users(id),
  acknowledged_at timestamptz not null default now(),
  -- The exact statement text shown at the moment of acceptance, snapshotted -- not a version
  -- number pointing at copy that could later change underneath the evidence.
  acceptance_statement text not null check (char_length(acceptance_statement) between 1 and 2000),
  -- Text, not an enum: only 'portal_click' exists today, but PERMISSIONS.md/EMAIL.md's own pattern
  -- (WhatsApp-triggered acceptance, an admin-recorded paper acknowledgement) is a plausible near-
  -- term extension an enum migration would needlessly gate.
  acceptance_method text not null default 'portal_click',
  ip_address inet,
  user_agent text,
  -- Snapshot of documents.checksum_sha256 at accept time -- proves exactly which file bytes were
  -- acknowledged even if the same document row were somehow later touched (it shouldn't be, but
  -- this makes the evidence self-contained rather than trusting a live join to stay stable).
  document_checksum text not null,
  created_at timestamptz not null default now()
);

create index compliance_acknowledgements_org_idx on public.compliance_acknowledgements (org_id);
create index compliance_acknowledgements_tenant_idx on public.compliance_acknowledgements (tenant_id);
create index compliance_acknowledgements_rule_version_idx on public.compliance_acknowledgements (rule_version_id);

alter table public.compliance_acknowledgements enable row level security;

create policy "compliance_acknowledgements_select_org_member"
  on public.compliance_acknowledgements for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "compliance_acknowledgements_select_tenant_self"
  on public.compliance_acknowledgements for select
  using (tenant_id in (select public.caller_tenant_ids()));

-- No insert/update/delete policy at all -- acknowledge_compliance_requirement() below (SECURITY
-- DEFINER) is the only path that can ever create a row, and nothing can ever update or delete one
-- (PHASE 17 "immutability": staff cannot silently edit an acknowledgement; invalidating one means
-- waiving/reassigning the requirement, never touching this table).

-- ============================================================
-- RPCs: rule creation / versioning / activation / acknowledgement / waiving
-- ============================================================

create or replace function public.create_property_rule(
  p_property_id uuid,
  p_category public.compliance_document_category,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_rule_id uuid;
begin
  select org_id into v_org_id from public.properties where id = p_property_id;
  if v_org_id is null then
    raise exception 'Property not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Only agent-or-above staff can create a property rule';
  end if;

  insert into public.property_rules (org_id, property_id, category, title, created_by)
  values (v_org_id, p_property_id, p_category, p_title, auth.uid())
  returning id into v_rule_id;

  return v_rule_id;
end;
$$;

comment on function public.create_property_rule(uuid, public.compliance_document_category, text) is
  'Creates the named rule "family" for a property (e.g. "Conduct Rules"). Versions are added
   separately via create_property_rule_version(). agent+ only.';

-- Creates a new DRAFT version pointing at an already-uploaded `documents` row (the caller uploads
-- the PDF through the existing document-upload path first, exactly like lease/bill documents
-- already work -- this function never touches storage itself). version_number auto-increments per
-- rule; draft versions never generate compliance_requirements (only activation does, below).
create or replace function public.create_property_rule_version(
  p_rule_id uuid,
  p_document_id uuid,
  p_effective_date date,
  p_expiry_date date default null,
  p_acknowledgement_required boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_property_id uuid;
  v_document_org_check uuid;
  v_next_version integer;
  v_version_id uuid;
begin
  select org_id, property_id into v_org_id, v_property_id
    from public.property_rules where id = p_rule_id;
  if v_org_id is null then
    raise exception 'Rule not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Only agent-or-above staff can add a rule version';
  end if;

  -- The supplied document must actually belong to the same property -- guards against a staff
  -- member (of the right org) accidentally or deliberately pointing a rule version at a document
  -- from a different property.
  select property_id into v_document_org_check
    from public.documents where id = p_document_id and property_id = v_property_id;
  if v_document_org_check is null then
    raise exception 'Document not found for this property';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
    from public.property_rule_versions where rule_id = p_rule_id;

  insert into public.property_rule_versions (
    rule_id, org_id, document_id, version_number, status,
    effective_date, expiry_date, acknowledgement_required, created_by
  )
  values (
    p_rule_id, v_org_id, p_document_id, v_next_version, 'draft',
    p_effective_date, p_expiry_date, p_acknowledgement_required, auth.uid()
  )
  returning id into v_version_id;

  return v_version_id;
end;
$$;

comment on function public.create_property_rule_version(uuid, uuid, date, date, boolean) is
  'Adds a new DRAFT version to an existing rule, referencing an already-uploaded documents row.
   Does not assign any compliance requirement -- call activate_property_rule_version() for that.';

-- Activates a draft version: supersedes the rule''s prior active version (if any -- its historical
-- acknowledgements are NEVER touched, only its own status/superseded_at/superseded_by change), then
-- assigns a compliance_requirement to every tenancy currently active on the property. Idempotent:
-- rerunning against an already-active version is a no-op for already-existing requirements
-- (on conflict do nothing, backed by compliance_requirements' own unique(rule_version_id, tenant_id)).
create or replace function public.activate_property_rule_version(p_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule_id uuid;
  v_org_id uuid;
  v_property_id uuid;
  v_status public.property_rule_version_status;
  v_prior_active_id uuid;
  v_assigned_count integer;
begin
  select prv.rule_id, prv.org_id, pr.property_id, prv.status
    into v_rule_id, v_org_id, v_property_id, v_status
    from public.property_rule_versions prv
    join public.property_rules pr on pr.id = prv.rule_id
    where prv.id = p_version_id;
  if v_rule_id is null then
    raise exception 'Rule version not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Only agent-or-above staff can activate a rule version';
  end if;
  if v_status = 'active' then
    return 0; -- already active, idempotent no-op
  end if;
  if v_status not in ('draft', 'archived') then
    raise exception 'Only a draft or archived version can be activated (current status: %)', v_status;
  end if;

  select id into v_prior_active_id
    from public.property_rule_versions
    where rule_id = v_rule_id and status = 'active';

  if v_prior_active_id is not null then
    update public.property_rule_versions
      set status = 'superseded', superseded_at = now(), superseded_by = p_version_id
      where id = v_prior_active_id;
    -- The prior version's still-outstanding (never-acknowledged) requirements are superseded, not
    -- silently left "pending" forever against a version nobody should act on anymore. Requirements
    -- that were already ACKNOWLEDGED are never touched -- that evidence is permanent regardless of
    -- what happens to later versions.
    update public.compliance_requirements
      set status = 'superseded', superseded_at = now()
      where rule_version_id = v_prior_active_id and status in ('pending', 'viewed');
  end if;

  update public.property_rule_versions
    set status = 'active', activated_at = now()
    where id = p_version_id;

  insert into public.compliance_requirements (org_id, property_id, rule_version_id, tenant_id, lease_id, status)
  select
    v_org_id, v_property_id, p_version_id, t.id, lt.lease_id, 'pending'
  from public.tenants t
  join public.lease_tenants lt on lt.tenant_id = t.id
  join public.leases l on l.id = lt.lease_id
  join public.units u on u.id = l.unit_id
  where u.property_id = v_property_id
    and t.status = 'active'
    and l.status = 'active'
  on conflict (rule_version_id, tenant_id) do nothing;

  get diagnostics v_assigned_count = row_count;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_org_id, auth.uid(), 'user', 'property_rule_version.activated', 'property_rule_versions', p_version_id,
    jsonb_build_object('ruleId', v_rule_id, 'propertyId', v_property_id, 'requirementsAssigned', v_assigned_count)
  );

  return v_assigned_count;
end;
$$;

comment on function public.activate_property_rule_version(uuid) is
  'Activates a draft/archived rule version, supersedes the prior active version of the same rule
   (never mutating its historical acknowledgements), and assigns a PENDING compliance_requirement
   to every tenancy currently active on the property. Returns the number of requirements assigned.
   agent+ only.';

-- Tenant marks a requirement as VIEWED -- explicitly never implies acknowledgement (PHASE 4/5:
-- "viewing must NOT mean acknowledged"). Only advances PENDING -> VIEWED; never downgrades a
-- requirement that is already further along (acknowledged/waived/superseded).
create or replace function public.mark_compliance_requirement_viewed(p_requirement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'mark_compliance_requirement_viewed requires an authenticated user';
  end if;

  update public.compliance_requirements
    set status = 'viewed', viewed_at = coalesce(viewed_at, now())
    where id = p_requirement_id
      and tenant_id in (select public.caller_tenant_ids())
      and status = 'pending';
end;
$$;

-- Atomic, idempotent acknowledgement. IP/user-agent are supplied by the caller (the Next.js route
-- handler resolves the trusted client IP the same way rateLimitOrRespond's own callers already do
-- via resolveTrustedClientIp() -- a Postgres function has no reliable access to the real client IP
-- through PostgREST, so capturing it here would be guessing, not evidence).
create or replace function public.acknowledge_compliance_requirement(
  p_requirement_id uuid,
  p_acceptance_statement text,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requirement public.compliance_requirements%rowtype;
  v_document_id uuid;
  v_checksum text;
  v_ack_id uuid;
begin
  if auth.uid() is null then
    raise exception 'acknowledge_compliance_requirement requires an authenticated user';
  end if;
  if p_acceptance_statement is null or char_length(trim(p_acceptance_statement)) = 0 then
    raise exception 'An acceptance statement is required';
  end if;

  select * into v_requirement
    from public.compliance_requirements
    where id = p_requirement_id and tenant_id in (select public.caller_tenant_ids())
    for update;
  if v_requirement.id is null then
    raise exception 'Requirement not found';
  end if;

  -- Idempotent retry: already acknowledged by this same tenancy -- return the existing evidence
  -- row rather than erroring (a double-click/retry must never fail, matching
  -- accept_tenant_invitation()'s own idempotent-retry posture).
  if v_requirement.status = 'acknowledged' then
    select id into v_ack_id from public.compliance_acknowledgements where requirement_id = p_requirement_id;
    return v_ack_id;
  end if;
  if v_requirement.status = 'waived' then
    raise exception 'This requirement has been waived and can no longer be acknowledged';
  end if;
  if v_requirement.status = 'superseded' then
    raise exception 'This requirement has been superseded by a newer version';
  end if;

  select document_id into v_document_id
    from public.property_rule_versions where id = v_requirement.rule_version_id;
  select checksum_sha256 into v_checksum from public.documents where id = v_document_id;

  insert into public.compliance_acknowledgements (
    requirement_id, org_id, property_id, rule_version_id, tenant_id, lease_id, user_id,
    acceptance_statement, ip_address, user_agent, document_checksum
  )
  values (
    v_requirement.id, v_requirement.org_id, v_requirement.property_id, v_requirement.rule_version_id,
    v_requirement.tenant_id, v_requirement.lease_id, auth.uid(),
    p_acceptance_statement, p_ip_address, p_user_agent, v_checksum
  )
  returning id into v_ack_id;

  update public.compliance_requirements
    set status = 'acknowledged', acknowledged_at = now()
    where id = v_requirement.id;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_requirement.org_id, auth.uid(), 'user', 'compliance_requirement.acknowledged',
    'compliance_requirements', v_requirement.id,
    jsonb_build_object('ruleVersionId', v_requirement.rule_version_id, 'tenantId', v_requirement.tenant_id)
  );

  return v_ack_id;
end;
$$;

comment on function public.acknowledge_compliance_requirement(uuid, text, inet, text) is
  'Atomic, idempotent tenant acknowledgement. Writes an immutable compliance_acknowledgements row
   and advances the requirement to ACKNOWLEDGED. Never allows acknowledging a waived or superseded
   requirement. Retrying an already-acknowledged requirement returns the existing evidence id
   rather than erroring or creating a duplicate.';

-- Staff waives an outstanding requirement (e.g. a documented exception) -- cannot waive one that
-- is already acknowledged (nothing to waive; the evidence stands) or already superseded/waived.
create or replace function public.waive_compliance_requirement(p_requirement_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status public.compliance_requirement_status;
begin
  select org_id, status into v_org_id, v_status
    from public.compliance_requirements where id = p_requirement_id;
  if v_org_id is null then
    raise exception 'Requirement not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Only agent-or-above staff can waive a requirement';
  end if;
  if v_status not in ('pending', 'viewed') then
    raise exception 'Only a pending or viewed requirement can be waived (current status: %)', v_status;
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to waive a requirement';
  end if;

  update public.compliance_requirements
    set status = 'waived', waived_at = now(), waived_by = auth.uid(), waived_reason = p_reason
    where id = p_requirement_id;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_org_id, auth.uid(), 'user', 'compliance_requirement.waived', 'compliance_requirements', p_requirement_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

-- ============================================================
-- OCCUPANTS (non-login household members -- co-tenants already exist via lease_tenants)
-- ============================================================

-- PHASE 8's "clean distinction between AUTH USER, TENANT RECORD, LEASE PARTY, OCCUPANT": a
-- co-tenant is ALREADY modeled correctly -- lease_tenants.is_primary=false is a second tenants row
-- with its own possible portal login (20260101000030). This table is deliberately only for people
-- who live in the unit but are NOT a separate tenants/lease_tenants row and may never need login
-- access at all (a child, a non-paying partner) -- "do NOT automatically create an Auth account
-- for every occupant". portal_user_id is a nullable forward-looking column (never set by any code
-- in this migration) for a possible future "grant this occupant their own login" extension.
create type public.lease_occupant_type as enum ('spouse_partner', 'child_dependant', 'other_approved_occupant');

create table public.lease_occupants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lease_id uuid not null references public.leases(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 200),
  occupant_type public.lease_occupant_type not null,
  relationship text,
  move_in_date date,
  move_out_date date,
  is_active boolean not null default true,
  contact_phone text,
  contact_email citext,
  -- Not wired to any auth flow by this migration -- see comment above.
  portal_user_id uuid references auth.users(id),
  compliance_applicable boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (move_out_date is null or move_in_date is null or move_out_date >= move_in_date)
);

create index lease_occupants_org_idx on public.lease_occupants (org_id);
create index lease_occupants_lease_idx on public.lease_occupants (lease_id);

create trigger set_lease_occupants_updated_at
  before update on public.lease_occupants
  for each row execute function public.set_updated_at();

alter table public.lease_occupants enable row level security;

create policy "lease_occupants_select_org_member"
  on public.lease_occupants for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "lease_occupants_write_agent_plus"
  on public.lease_occupants for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- Tenant may see (read-only) who else is recorded as living in their own household.
create policy "lease_occupants_select_tenant_self"
  on public.lease_occupants for select
  using (public.caller_is_tenant_of_lease(lease_occupants.lease_id));

-- ============================================================
-- BODY CORPORATE / MANAGING AGENT / PROPERTY MANAGEMENT CONTACTS
-- ============================================================

-- Deliberately NOT the Vendors model (a vendor is a paid service provider Proplyst tracks
-- expenses against -- a body corporate/managing agent relationship is administrative/contact
-- information, not a billable vendor relationship in this codebase's existing accounting sense,
-- confirmed no `vendors` table row would correctly represent "who administers the scheme" without
-- conflating the two concepts). A property may have zero, one, or several of these rows
-- simultaneously (e.g. both a body corporate AND its managing agent, per PHASE 9's own example).
create type public.property_management_contact_type as enum (
  'body_corporate', 'managing_agent', 'hoa', 'estate_management', 'other'
);

create table public.property_management_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  contact_type public.property_management_contact_type not null,
  name text not null check (char_length(name) between 1 and 200),
  company_name text,
  registration_number text,
  contact_person text,
  email citext,
  phone text,
  emergency_phone text,
  address text,
  account_reference text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index property_management_contacts_org_idx on public.property_management_contacts (org_id);
create index property_management_contacts_property_idx on public.property_management_contacts (property_id);

create trigger set_property_management_contacts_updated_at
  before update on public.property_management_contacts
  for each row execute function public.set_updated_at();

alter table public.property_management_contacts enable row level security;

create policy "property_management_contacts_select_org_member"
  on public.property_management_contacts for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "property_management_contacts_write_agent_plus"
  on public.property_management_contacts for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- Deliberately staff/owner-only for now, not tenant-readable -- PHASE 9 illustrates this on the
-- Property (staff) UI only; extending it to tenants (e.g. "who do I call") is a reasonable, small
-- follow-up but not implemented here to keep the initial access surface minimal and reviewed.

-- ============================================================
-- LEVY / BODY CORPORATE STATEMENTS
-- ============================================================

create type public.levy_statement_status as enum ('uploaded', 'extracting', 'extracted', 'reviewed');

create table public.levy_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  document_id uuid not null references public.documents(id),
  management_contact_id uuid references public.property_management_contacts(id) on delete set null,
  statement_date date,
  period_start date,
  period_end date,
  opening_balance numeric(12, 2),
  closing_balance numeric(12, 2),
  payment_due_date date,
  payment_reference text,
  status public.levy_statement_status not null default 'uploaded',
  extraction_job_id uuid references public.extraction_jobs(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index levy_statements_org_idx on public.levy_statements (org_id);
create index levy_statements_property_idx on public.levy_statements (property_id);

create trigger set_levy_statements_updated_at
  before update on public.levy_statements
  for each row execute function public.set_updated_at();

alter table public.levy_statements enable row level security;

-- Financial data -- staff/owner only (agent+ to write, viewer to read), matching the codebase's
-- existing "owner financials never tenant-visible" posture (PHASE 12: "many charges belong to the
-- property owner"). No tenant policy exists on either table below, deliberately.
create policy "levy_statements_select_org_member"
  on public.levy_statements for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "levy_statements_write_agent_plus"
  on public.levy_statements for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

create type public.levy_statement_line_item_type as enum ('charge', 'payment', 'credit');
create type public.levy_statement_line_item_source as enum ('ocr_heuristic', 'manual');

-- Flexible categorisation (PHASE 10: "prefer Statement/StatementLineItem with flexible
-- categorisation rather than adding database columns for every possible charge") -- `category` is
-- free text, not an enum, since real managing-agent statements use inconsistent terminology (the
-- reference statement alone used "monthly levy"/"CSOS levy"/"unit water"/"common water"/"general
-- sewer" -- a closed enum would need a migration for every new agent's own wording).
create table public.levy_statement_line_items (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.levy_statements(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  line_type public.levy_statement_line_item_type not null,
  category text not null check (char_length(category) between 1 and 100),
  description text,
  amount numeric(12, 2) not null,
  source public.levy_statement_line_item_source not null default 'manual',
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index levy_statement_line_items_statement_idx on public.levy_statement_line_items (statement_id);
create index levy_statement_line_items_org_idx on public.levy_statement_line_items (org_id);

create trigger set_levy_statement_line_items_updated_at
  before update on public.levy_statement_line_items
  for each row execute function public.set_updated_at();

alter table public.levy_statement_line_items enable row level security;

create policy "levy_statement_line_items_select_org_member"
  on public.levy_statement_line_items for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "levy_statement_line_items_write_agent_plus"
  on public.levy_statement_line_items for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

comment on table public.levy_statement_line_items is
  'Reviewed/correctable structured line items extracted from a levy/body-corporate statement.
   Never posted to accounting by anything in this schema -- PHASE 12''s explicit boundary: a
   reviewed line item becoming a real journal entry/expense/recoverable-tenant-charge is a
   deliberately out-of-scope follow-up, not guessed at here, since the correct accounting
   treatment (owner expense vs recoverable tenant charge) is not determinable from the statement
   text alone.';

-- ============================================================
-- STORAGE: tenant read access to a rule document's underlying object
-- ============================================================

-- `documents_select_tenant_compliance` (above) grants table-level SELECT, but the `documents`
-- storage bucket's own object-level policies (20260101000048) are ALL org-membership-based
-- (`has_org_role(...)`) -- a tenant has no organization_members row at all, so without this, a
-- tenant could read the `documents` row but GET /api/v1/documents/:id's own
-- `storage.createSignedUrl()` call (made with the caller's own session-bound client) would fail
-- with a storage-level 403 despite the table read succeeding. This closes that gap the same
-- narrow way the table policy does: gated on an actual compliance_requirements join, not a
-- blanket property-level grant.
create policy "documents_bucket_select_tenant_compliance"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      join public.property_rule_versions prv on prv.document_id = d.id
      join public.compliance_requirements cr on cr.rule_version_id = prv.id
      where d.storage_path = storage.objects.name
        and cr.tenant_id in (select public.caller_tenant_ids())
    )
  );
