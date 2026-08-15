-- RELEASE A P0 SECURITY FIX (V1 Commercial Launch Gap Audit, this date): a fresh, exhaustive
-- migration-by-migration audit confirmed the original Stage-1 access-cutover work
-- (20260101000064-070, "8 of 8 tables") never actually covered every property-scoped table --
-- `tenants`, `inspections`(+items+photos), `vendors`/`vendor_bills`, and the entire property
-- compliance/levy module (20260101000097-099) were all added AFTER that cutover pass and were
-- never wired to has_property_access() at all -- a `property_access_mode = 'selected'` staff
-- member restricted to Property A can currently read (and, on some tables, write) another
-- property's tenant/inspection/compliance/levy/vendor-billing data by direct ID or raw PostgREST
-- query. This migration closes that gap using the exact same has_property_access() primitive and
-- cutover shape already proven on properties/units/leases/documents/expenses/journal_lines/
-- maintenance_tickets/applications (20260101000063-070/084) -- no new authorization primitive is
-- introduced, only its consistent application to the tables that were missed.
--
-- Per-table property_id resolution path (the "fresh audit" this migration is built from):
--   tenants                     -- indirect, MANY-TO-MANY: lease_tenants -> leases -> units.property_id
--                                   (a tenant may be linked to zero, one, or (rarely) several leases/
--                                   properties over its lifetime -- see has_tenant_property_access() below)
--   inspections                  -- direct property_id column
--   inspection_items             -- indirect: inspection_id -> inspections.property_id
--   inspection_photos            -- indirect: inspection_id -> inspections.property_id
--   vendors                      -- NOT cut over, deliberately -- see comment at that section
--   vendor_bills                 -- indirect + NULLABLE: maintenance_ticket_id -> maintenance_tickets.property_id
--   property_rules                -- direct property_id column
--   property_rule_versions        -- indirect: rule_id -> property_rules.property_id
--   compliance_requirements       -- direct property_id column
--   compliance_acknowledgements   -- direct property_id column
--   property_management_contacts  -- direct property_id column (related resource found during this
--                                    audit pass, same administrative-document domain as property_rules,
--                                    not in the task's named list but clearly in scope)
--   levy_statements                -- direct property_id column
--   levy_statement_line_items      -- indirect: statement_id -> levy_statements.property_id
--   lease_occupants                -- indirect: lease_id -> leases -> units.property_id (related
--                                     resource found during this audit pass -- household-member PII
--                                     scoped to a specific tenancy/property, same domain as tenants)
--
-- Bootstrapping: every table below either (a) has a direct, not-null property_id column supplied
-- by the client/RPC at INSERT time -- same "no bootstrapping problem, the row's own column is what
-- WITH CHECK evaluates" reasoning already documented by every prior cutover migration -- or (b) is
-- always created referencing an ALREADY-EXISTING parent row that already carries a resolved
-- property_id (inspection_items/photos always reference an existing inspection; levy_statement_line_items
-- always references an existing levy_statement; lease_occupants always references an existing lease).
-- The one genuine exception is `tenants`, handled explicitly below.

-- ============================================================
-- TENANTS -- many-to-many via lease_tenants, with an explicit "unassigned" bootstrap case
-- ============================================================
--
-- tenants are created org-wide with no property/lease context at all (POST /api/v1/tenants takes
-- only orgId/fullName/email/phone -- confirmed by direct route inspection) -- a tenant is assigned
-- to a property only later, by being added to a lease via lease_tenants. This is a genuine,
-- deliberate product workflow (create the tenant record, then assign a lease), not a bug, so a
-- hard "must already have a property link" requirement would break tenant creation entirely for
-- every 'selected'-mode staff member. The judgment call (documented here so it is cheap to revisit
-- if real usage shows it wrong, matching 20260101000063's own "judgment call" precedent): a tenant
-- with ZERO lease_tenants links is still org-wide visible to any agent+ staff member (it carries no
-- property-specific information yet to protect -- there is no property to leak); the moment a
-- tenant is linked to at least one lease, visibility narrows to staff who hold property_access on
-- at least one of the properties backing those leases. This also correctly handles a tenant who has
-- moved between several properties over time (visible to staff holding access to ANY of them, past
-- or present -- same "current AND historical" posture compliance_requirements/acknowledgements
-- already use for their own tenant-self policies).
create or replace function public.has_tenant_property_access(
  target_tenant_id uuid,
  min_role public.property_role default 'read_only'
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    not exists (select 1 from public.lease_tenants lt where lt.tenant_id = target_tenant_id)
    or exists (
      select 1
      from public.lease_tenants lt
      join public.leases l on l.id = lt.lease_id
      join public.units u on u.id = l.unit_id
      where lt.tenant_id = target_tenant_id
        and public.has_property_access(u.property_id, min_role)
    );
$$;

comment on function public.has_tenant_property_access(uuid, public.property_role) is
  'True if target_tenant_id has no lease_tenants links yet (still "unassigned", org-wide visible by
   design) OR the calling user holds has_property_access() at min_role on at least one property
   backing one of the tenant''s lease_tenants links (current or historical). Used by tenants'' own
   RLS policy below -- also correctly covers INSERT, since a not-yet-inserted tenant id trivially
   has zero lease_tenants rows, satisfying the first branch.';

drop policy if exists "tenants_select_org_or_self" on public.tenants;
drop policy if exists "tenants_write_agent_plus" on public.tenants;

create policy "tenants_select_org_and_property_access_or_self"
  on public.tenants for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_tenant_property_access(id, 'read_only'))
    or user_id = auth.uid()
  );

create policy "tenants_write_agent_plus_and_property_access"
  on public.tenants for all
  using (public.has_org_role(org_id, 'agent') and public.has_tenant_property_access(id, 'property_manager'))
  with check (public.has_org_role(org_id, 'agent') and public.has_tenant_property_access(id, 'property_manager'));

-- ============================================================
-- INSPECTIONS + ITEMS + PHOTOS
-- ============================================================
-- Direct property_id column, identical shape to maintenance_tickets_access_cutover
-- (20260101000070). Write role bundle: 'property_manager'/'owner' -- inspections are a lease-
-- lifecycle/property-administration action (move-in/move-out/routine condition checks tied to a
-- specific tenancy), the same domain leases/applications already use, not a repair/maintenance
-- action (which would be 'maintenance_manager').
drop policy if exists "inspections_select_org_member" on public.inspections;
drop policy if exists "inspections_write_agent_plus" on public.inspections;

create policy "inspections_select_org_member_and_property_access"
  on public.inspections for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

create policy "inspections_write_agent_plus_and_property_access"
  on public.inspections for all
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  );

drop policy if exists "inspection_items_select_org_member" on public.inspection_items;
drop policy if exists "inspection_items_write_agent_plus" on public.inspection_items;

create policy "inspection_items_select_org_member_and_property_access"
  on public.inspection_items for select
  using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_items.inspection_id
        and public.has_org_role(i.org_id, 'viewer')
        and public.has_property_access(i.property_id, 'read_only')
    )
  );

create policy "inspection_items_write_agent_plus_and_property_access"
  on public.inspection_items for all
  using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_items.inspection_id
        and public.has_org_role(i.org_id, 'agent')
        and (public.has_property_access(i.property_id, 'property_manager') or public.has_property_access(i.property_id, 'owner'))
    )
  )
  with check (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_items.inspection_id
        and public.has_org_role(i.org_id, 'agent')
        and (public.has_property_access(i.property_id, 'property_manager') or public.has_property_access(i.property_id, 'owner'))
    )
  );

drop policy if exists "inspection_photos_select_org_member" on public.inspection_photos;
drop policy if exists "inspection_photos_write_agent_plus" on public.inspection_photos;

create policy "inspection_photos_select_org_member_and_property_access"
  on public.inspection_photos for select
  using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_photos.inspection_id
        and public.has_org_role(i.org_id, 'viewer')
        and public.has_property_access(i.property_id, 'read_only')
    )
  );

create policy "inspection_photos_write_agent_plus_and_property_access"
  on public.inspection_photos for all
  using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_photos.inspection_id
        and public.has_org_role(i.org_id, 'agent')
        and (public.has_property_access(i.property_id, 'property_manager') or public.has_property_access(i.property_id, 'owner'))
    )
  )
  with check (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_photos.inspection_id
        and public.has_org_role(i.org_id, 'agent')
        and (public.has_property_access(i.property_id, 'property_manager') or public.has_property_access(i.property_id, 'owner'))
    )
  );

-- ============================================================
-- VENDORS -- deliberately NOT cut over; VENDOR_BILLS is, where a property context exists
-- ============================================================
-- `vendors` is an org-wide contact directory (a plumber/electrician an org uses across many
-- properties), not property-specific data -- a vendor's name/trade/phone number does not, on its
-- own, reveal anything about a specific property a 'selected'-mode staff member lacks access to,
-- and every staff member needs the full roster to pick from when creating a ticket on ANY property
-- they do have access to. Narrowing `vendors` itself would break that picker for no real security
-- benefit. The actual sensitive, property-attributable data is a vendor's BILLING history against a
-- specific ticket -- that is what `vendor_bills` carries, and that is what this migration scopes.
drop policy if exists "vendor_bills_select_org_member" on public.vendor_bills;
drop policy if exists "vendor_bills_write_agent_plus" on public.vendor_bills;

-- A bill's maintenance_ticket_id is nullable (a bill can exist with no ticket link at all, e.g. a
-- standing/retainer charge) -- when null there is no property to attribute the bill to, so it falls
-- back to the pre-existing org-role-only gate (same "no property context = can't restrict further"
-- reasoning as an unassigned tenant, above). When set, the bill is only visible/writable to staff
-- who hold property_access on the ticket's own property -- referencing vendor_bills'
-- maintenance_ticket_id column directly (not a helper function keyed by the bill's own id) so this
-- correctly evaluates against the NEW row on INSERT, with no bootstrapping gap.
create policy "vendor_bills_select_org_member_and_property_access"
  on public.vendor_bills for select
  using (
    public.has_org_role(org_id, 'viewer')
    and (
      maintenance_ticket_id is null
      or exists (
        select 1 from public.maintenance_tickets mt
        where mt.id = vendor_bills.maintenance_ticket_id
          and public.has_property_access(mt.property_id, 'read_only')
      )
    )
  );

create policy "vendor_bills_write_agent_plus_and_property_access"
  on public.vendor_bills for all
  using (
    public.has_org_role(org_id, 'agent')
    and (
      maintenance_ticket_id is null
      or exists (
        select 1 from public.maintenance_tickets mt
        where mt.id = vendor_bills.maintenance_ticket_id
          and (public.has_property_access(mt.property_id, 'maintenance_manager') or public.has_property_access(mt.property_id, 'owner'))
      )
    )
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (
      maintenance_ticket_id is null
      or exists (
        select 1 from public.maintenance_tickets mt
        where mt.id = vendor_bills.maintenance_ticket_id
          and (public.has_property_access(mt.property_id, 'maintenance_manager') or public.has_property_access(mt.property_id, 'owner'))
      )
    )
  );

-- ============================================================
-- PROPERTY RULES + VERSIONS (compliance module)
-- ============================================================
drop policy if exists "property_rules_select_org_member" on public.property_rules;
drop policy if exists "property_rules_write_agent_plus" on public.property_rules;

create policy "property_rules_select_org_member_and_property_access"
  on public.property_rules for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

create policy "property_rules_write_agent_plus_and_property_access"
  on public.property_rules for all
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  );

-- property_rules_select_tenant_self (20260101000097) already joins property_rules ->
-- property_rule_versions -> compliance_requirements. A naive inline EXISTS join back from
-- property_rule_versions into property_rules (the obvious way to reach property_id) creates a
-- genuine RLS evaluation cycle -- property_rules' policy needs property_rule_versions' policy
-- evaluated, which would need property_rules' policy evaluated, forever ("infinite recursion
-- detected in policy for relation... property_rule_versions", caught by this migration's own
-- local db-reset + pgTAP run before ever reaching production). Fixed the same way
-- has_org_role()/has_property_access() themselves avoid this: a SECURITY DEFINER function, owned
-- by the migration role, resolves property_rules.property_id WITHOUT re-triggering RLS on either
-- table (Postgres skips row security for a table's own owner unless FORCE ROW LEVEL SECURITY is
-- set, which nothing in this schema uses) -- breaking the cycle instead of avoiding the join.
create or replace function public.property_rule_property_id(target_rule_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select property_id from public.property_rules where id = target_rule_id;
$$;

comment on function public.property_rule_property_id(uuid) is
  'Resolves a property_rules.id to its property_id without evaluating property_rules'' own RLS
   policy -- used by property_rule_versions'' select policy specifically to avoid the RLS
   recursion that a direct EXISTS join back into property_rules would create (property_rules'' own
   tenant-self policy already joins into property_rule_versions).';

drop policy if exists "property_rule_versions_select_org_member" on public.property_rule_versions;

create policy "property_rule_versions_select_org_member_and_property_access"
  on public.property_rule_versions for select
  using (
    public.has_org_role(property_rule_versions.org_id, 'viewer')
    and public.has_property_access(public.property_rule_property_id(property_rule_versions.rule_id), 'read_only')
  );
-- property_rule_versions_select_tenant_self (20260101000097) is untouched -- an independent
-- PERMISSIVE policy, OR'd with the one above, unaffected by this staff-scoping change.

-- Staff-side RPC checks: creation/versioning/activation are SECURITY DEFINER and bypass RLS
-- entirely, so they need their own explicit has_property_access check to actually enforce the
-- narrowing above once 'selected' mode is a real, reachable state for this module -- identical
-- reasoning to why activate_lease()/end_lease() needed the same treatment in 20260101000084.
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
  if not (public.has_property_access(p_property_id, 'property_manager') or public.has_property_access(p_property_id, 'owner')) then
    raise exception 'Caller does not have property-level permission to create a rule for this property';
  end if;

  insert into public.property_rules (org_id, property_id, category, title, created_by)
  values (v_org_id, p_property_id, p_category, p_title, auth.uid())
  returning id into v_rule_id;

  return v_rule_id;
end;
$$;

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
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'Caller does not have property-level permission to add a version for this property''s rule';
  end if;

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
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'Caller does not have property-level permission to activate a version for this property''s rule';
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
    and t.status <> 'expired'
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
  'Activates a draft/archived rule version (property-access checked, RELEASE A P0 fix), supersedes
   the rule''s prior active version, and assigns a PENDING compliance_requirement to every tenancy
   currently active on the property. Returns the number of requirements assigned. agent+ org role
   AND property_manager/owner property-level role required.';

-- ============================================================
-- COMPLIANCE REQUIREMENTS + ACKNOWLEDGEMENTS
-- ============================================================
-- Both tables are direct property_id, SELECT-only for staff (no client write policy exists on
-- either -- every mutation goes through the SECURITY DEFINER RPCs above/below, already checked).
-- The tenant-self policies on both tables are untouched -- independent PERMISSIVE policies.
drop policy if exists "compliance_requirements_select_org_member" on public.compliance_requirements;

create policy "compliance_requirements_select_org_member_and_property_access"
  on public.compliance_requirements for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

drop policy if exists "compliance_acknowledgements_select_org_member" on public.compliance_acknowledgements;

create policy "compliance_acknowledgements_select_org_member_and_property_access"
  on public.compliance_acknowledgements for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

create or replace function public.waive_compliance_requirement(p_requirement_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_property_id uuid;
  v_status public.compliance_requirement_status;
begin
  select org_id, property_id, status into v_org_id, v_property_id, v_status
    from public.compliance_requirements where id = p_requirement_id;
  if v_org_id is null then
    raise exception 'Requirement not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Only agent-or-above staff can waive a requirement';
  end if;
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'Caller does not have property-level permission to waive this requirement';
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

comment on function public.waive_compliance_requirement(uuid, text) is
  'Staff waives an outstanding requirement (property-access checked, RELEASE A P0 fix). agent+ org
   role AND property_manager/owner property-level role required.';

-- ============================================================
-- PROPERTY MANAGEMENT CONTACTS (body corporate / managing agent / HOA)
-- ============================================================
drop policy if exists "property_management_contacts_select_org_member" on public.property_management_contacts;
drop policy if exists "property_management_contacts_write_agent_plus" on public.property_management_contacts;

create policy "property_management_contacts_select_org_member_and_property_access"
  on public.property_management_contacts for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

create policy "property_management_contacts_write_agent_plus_and_property_access"
  on public.property_management_contacts for all
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  );

-- ============================================================
-- LEVY / BODY CORPORATE STATEMENTS
-- ============================================================
drop policy if exists "levy_statements_select_org_member" on public.levy_statements;
drop policy if exists "levy_statements_write_agent_plus" on public.levy_statements;

create policy "levy_statements_select_org_member_and_property_access"
  on public.levy_statements for select
  using (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'));

create policy "levy_statements_write_agent_plus_and_property_access"
  on public.levy_statements for all
  using (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  );

drop policy if exists "levy_statement_line_items_select_org_member" on public.levy_statement_line_items;
drop policy if exists "levy_statement_line_items_write_agent_plus" on public.levy_statement_line_items;

create policy "levy_statement_line_items_select_org_member_and_property_access"
  on public.levy_statement_line_items for select
  using (
    exists (
      select 1 from public.levy_statements ls
      where ls.id = levy_statement_line_items.statement_id
        and public.has_org_role(ls.org_id, 'viewer')
        and public.has_property_access(ls.property_id, 'read_only')
    )
  );

create policy "levy_statement_line_items_write_agent_plus_and_property_access"
  on public.levy_statement_line_items for all
  using (
    exists (
      select 1 from public.levy_statements ls
      where ls.id = levy_statement_line_items.statement_id
        and public.has_org_role(ls.org_id, 'agent')
        and (public.has_property_access(ls.property_id, 'property_manager') or public.has_property_access(ls.property_id, 'owner'))
    )
  )
  with check (
    exists (
      select 1 from public.levy_statements ls
      where ls.id = levy_statement_line_items.statement_id
        and public.has_org_role(ls.org_id, 'agent')
        and (public.has_property_access(ls.property_id, 'property_manager') or public.has_property_access(ls.property_id, 'owner'))
    )
  );

-- ============================================================
-- LEASE OCCUPANTS (household members, related resource found during this audit pass)
-- ============================================================
drop policy if exists "lease_occupants_select_org_member" on public.lease_occupants;
drop policy if exists "lease_occupants_write_agent_plus" on public.lease_occupants;

create policy "lease_occupants_select_org_member_and_property_access"
  on public.lease_occupants for select
  using (
    exists (
      select 1 from public.leases l
      join public.units u on u.id = l.unit_id
      where l.id = lease_occupants.lease_id
        and public.has_org_role(l.org_id, 'viewer')
        and public.has_property_access(u.property_id, 'read_only')
    )
  );

create policy "lease_occupants_write_agent_plus_and_property_access"
  on public.lease_occupants for all
  using (
    exists (
      select 1 from public.leases l
      join public.units u on u.id = l.unit_id
      where l.id = lease_occupants.lease_id
        and public.has_org_role(l.org_id, 'agent')
        and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
    )
  )
  with check (
    exists (
      select 1 from public.leases l
      join public.units u on u.id = l.unit_id
      where l.id = lease_occupants.lease_id
        and public.has_org_role(l.org_id, 'agent')
        and (public.has_property_access(u.property_id, 'property_manager') or public.has_property_access(u.property_id, 'owner'))
    )
  );
-- lease_occupants_select_tenant_self (20260101000097) is untouched -- independent PERMISSIVE
-- policy, OR'd with the one above.
