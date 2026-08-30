-- Property/unit lifecycle safety + rent-invoice numbering (WORKLOG.md this date).
--
-- PROPERTY: create_property()/the properties PATCH+DELETE API routes already exist
-- (apps/admin/app/api/v1/properties/[id]/route.ts) -- DELETE already archives (status='archived'),
-- never a real DELETE. What's missing is a genuinely safe, server-enforced HARD delete for a
-- property that has never accumulated real history, and a restore path back from archived. Both
-- are purely additive: no existing column/behavior changes.
--
-- UNIT: units.status has no "no longer usable but historically relevant" state at all today
-- (only vacant/occupied/maintenance) -- add one, additively (existing rows/values untouched).
--
-- INVOICES: public.invoices already exists (20260101000037) as the authoritative tenant-rent
-- invoice entity, entirely separate from subscription_invoices (SaaS billing) -- confirmed via
-- that migration's own header comment. It has no invoice_number column, unlike
-- subscription_invoices/cash_receipts, which both already use a safe, concurrency-proof
-- sequence-based numbering pattern. Add the same pattern here, additively.

-- ============================================================
-- Unit lifecycle: add 'archived' to the existing enum, additively.
-- ============================================================
alter type public.unit_status add value 'archived';

-- ============================================================
-- Invoice numbering, matching subscription_invoices' proven pattern exactly
-- (20260101000108) -- a Postgres sequence, never client-supplied, safe under concurrency.
-- ============================================================
create sequence public.invoice_number_seq;

create or replace function public.generate_invoice_number()
returns text
language sql
as $$
  select 'INV-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
$$;

alter table public.invoices
  add column invoice_number text unique default public.generate_invoice_number();

update public.invoices
set invoice_number = public.generate_invoice_number()
where invoice_number is null;

alter table public.invoices
  alter column invoice_number set not null;

comment on column public.invoices.invoice_number is
  'Deterministic, server-generated (generate_invoice_number(), a Postgres sequence -- never
   client-supplied, safe under concurrent issuance). Distinct from subscription_invoices''
   PLY-<year>-<n> numbering (a different table, SaaS billing, never mixed with this one).';

-- ============================================================
-- Property deletion eligibility -- server-authoritative, matching create_property()/
-- activate_lease()'s own established pattern (plain function, no RLS bypass beyond what the
-- caller's own role already grants via has_org_role/has_property_access checks below).
--
-- Deliberately broader than what the raw FK graph alone would block: several property-scoped
-- tables cascade-delete (property_owners, property_ownership_history, applications, maintenance_
-- tickets, inspections, documents, property_photos, compliance/levy tables, cash_receipts) rather
-- than blocking -- a hard delete relying on FK cascades alone would silently destroy that history.
-- This function treats ANY row in ANY of those tables as a hard blocker, not just the ones the FK
-- graph itself would refuse. expenses/journal_lines/bank_transactions/audit_events additionally
-- have NO ACTION FKs with no cascade at all, so Postgres itself independently refuses those --
-- checked here too, for a clear error message rather than a raw constraint-violation.
-- ============================================================
create or replace function public.get_property_deletion_blockers(p_property_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_blockers text[] := array[]::text[];
  v_count integer;
begin
  -- Checked FIRST and separately from every table-specific check below: audit_events rows are
  -- permanently immutable (audit_events_immutable trigger) and audit_events.property_id has a
  -- NO ACTION foreign key with no cascade -- so ANY property that has EVER had a unit (or any
  -- other audit-tracked, property-scoped row) created under it remains permanently blocked at the
  -- Postgres level even if every such row is later individually removed (empirically confirmed:
  -- a unit hard-deleted via hard_delete_unit() still leaves its own creation audit_events row
  -- behind, referencing this property_id, which the raw DELETE then fails against). Checking this
  -- explicitly turns that into a clear message instead of a raw FK-violation error.
  select count(*) into v_count from public.audit_events where property_id = p_property_id;
  if v_count > 0 then
    v_blockers := array_append(v_blockers, 'this property has activity/audit history and can never be permanently deleted');
  end if;

  select count(*) into v_count from public.units where property_id = p_property_id;
  if v_count > 0 then
    v_blockers := array_append(v_blockers, format('%s unit(s) still recorded on this property', v_count));
  end if;

  select count(*) into v_count from public.applications where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s application(s)', v_count)); end if;

  select count(*) into v_count from public.maintenance_tickets where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s maintenance ticket(s)', v_count)); end if;

  select count(*) into v_count from public.inspections where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s inspection(s)', v_count)); end if;

  select count(*) into v_count from public.documents where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s document(s) that must be retained', v_count)); end if;

  select count(*) into v_count from public.property_owners where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s owner relationship(s)', v_count)); end if;

  select count(*) into v_count from public.property_ownership_history where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, 'ownership history'); end if;

  select count(*) into v_count from public.cash_receipts where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s cash receipt(s)', v_count)); end if;

  select count(*) into v_count from public.payment_reports where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s payment report(s)', v_count)); end if;

  select count(*) into v_count from public.property_rules where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, 'property rules'); end if;

  select count(*) into v_count from public.compliance_requirements where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s compliance requirement(s)', v_count)); end if;

  select count(*) into v_count from public.compliance_acknowledgements where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, 'compliance acknowledgements'); end if;

  select count(*) into v_count from public.property_management_contacts where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s management contact(s)', v_count)); end if;

  select count(*) into v_count from public.levy_statements where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s levy statement(s)', v_count)); end if;

  select count(*) into v_count from public.expenses where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s expense(s) (financial history)', v_count)); end if;

  select count(*) into v_count from public.journal_lines where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, 'accounting/journal history'); end if;

  select count(*) into v_count from public.bank_transactions where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s bank transaction(s) tagged to this property', v_count)); end if;

  select count(*) into v_count from public.payments where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s payment record(s)', v_count)); end if;

  select count(*) into v_count from public.property_photos where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s photo(s)', v_count)); end if;

  select count(*) into v_count from public.announcements where property_id = p_property_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s announcement(s)', v_count)); end if;

  return v_blockers;
end;
$$;

comment on function public.get_property_deletion_blockers(uuid) is
  'Read-only eligibility check -- empty array means the property has no units and no
   property-scoped history of any kind, so a hard delete is safe. Called both by the UI (to decide
   whether to offer Delete vs. Archive) and re-checked server-side inside hard_delete_property()
   itself, never trusted from a prior client-side read alone.';

create or replace function public.hard_delete_property(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_blockers text[];
begin
  select org_id into v_org_id from public.properties where id = p_property_id;
  if v_org_id is null then
    raise exception 'not_found: Property not found';
  end if;

  -- Permanent delete is more restricted than ordinary edit/archive (task's own explicit
  -- requirement) -- principal org role and owner-level property access, not merely agent+
  -- property_manager as archive/edit use.
  if not public.has_org_role(v_org_id, 'principal') then
    raise exception 'insufficient_permission: Only a principal may permanently delete a property';
  end if;
  if not public.has_property_access(p_property_id, 'owner') then
    raise exception 'insufficient_permission: Only an owner-level user may permanently delete this property';
  end if;

  -- Re-validated here, not merely trusted from a prior client-side call -- "the server/database
  -- must reject unsafe deletion," never only a frontend check.
  v_blockers := public.get_property_deletion_blockers(p_property_id);
  if array_length(v_blockers, 1) > 0 then
    raise exception 'property_deletion_blocked: Cannot permanently delete this property: %', array_to_string(v_blockers, '; ');
  end if;

  delete from public.properties where id = p_property_id;
end;
$$;

comment on function public.hard_delete_property(uuid) is
  'The ONLY sanctioned way to permanently delete a property -- no route/UI issues a raw
   DELETE FROM properties directly. Re-checks eligibility and role server-side regardless of what
   the caller already believes. A property with even one unit ever created is also independently
   blocked at the Postgres level: audit_events.property_id (populated by units'' own audit trigger)
   is a NO ACTION foreign key, and audit_events rows are permanently immutable
   (audit_events_immutable trigger) -- so this function''s own check and the database''s own FK
   constraint are two independent layers of the same guarantee, not one relying on the other.';

-- ============================================================
-- Unit deletion eligibility / hard delete -- same shape as the property functions above.
-- ============================================================
create or replace function public.get_unit_deletion_blockers(p_unit_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_blockers text[] := array[]::text[];
  v_count integer;
begin
  select count(*) into v_count from public.leases where unit_id = p_unit_id;
  if v_count > 0 then
    v_blockers := array_append(v_blockers, format('%s lease(s) (current or historical)', v_count));
  end if;

  select count(*) into v_count from public.applications where unit_id = p_unit_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s application(s)', v_count)); end if;

  select count(*) into v_count from public.maintenance_tickets where unit_id = p_unit_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s maintenance ticket(s)', v_count)); end if;

  select count(*) into v_count from public.inspections where unit_id = p_unit_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s inspection(s)', v_count)); end if;

  select count(*) into v_count from public.documents where unit_id = p_unit_id;
  if v_count > 0 then v_blockers := array_append(v_blockers, format('%s document(s) that must be retained', v_count)); end if;

  return v_blockers;
end;
$$;

comment on function public.get_unit_deletion_blockers(uuid) is
  'Leases include EVERY status (draft/active/expired/terminated) -- a unit that ever had even a
   historical lease is not eligible for hard delete, only for archive. rent_schedules/payments
   have no direct unit_id column (reachable only via lease_id), so a unit with zero leases can
   have no rent/payment history either -- the leases check alone is sufficient for that branch.';

create or replace function public.hard_delete_unit(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_property_id uuid;
  v_blockers text[];
begin
  select org_id, property_id into v_org_id, v_property_id from public.units where id = p_unit_id;
  if v_org_id is null then
    raise exception 'not_found: Unit not found';
  end if;

  if not public.has_org_role(v_org_id, 'principal') then
    raise exception 'insufficient_permission: Only a principal may permanently delete a unit';
  end if;
  if not public.has_property_access(v_property_id, 'owner') then
    raise exception 'insufficient_permission: Only an owner-level user may permanently delete this unit';
  end if;

  v_blockers := public.get_unit_deletion_blockers(p_unit_id);
  if array_length(v_blockers, 1) > 0 then
    raise exception 'unit_deletion_blocked: Cannot permanently delete this unit: %', array_to_string(v_blockers, '; ');
  end if;

  delete from public.units where id = p_unit_id;
end;
$$;

-- ============================================================
-- Unit archive/restore -- mirrors property's existing archive precedent (status enum flip), with
-- the active-lease guard the product spec explicitly requires ("must NOT be archived while it has
-- an active lease... never automatically terminate leases").
-- ============================================================
create or replace function public.archive_unit(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_property_id uuid;
  v_status public.unit_status;
  v_active_lease_count integer;
begin
  select org_id, property_id, status into v_org_id, v_property_id, v_status
  from public.units where id = p_unit_id;
  if v_org_id is null then
    raise exception 'not_found: Unit not found';
  end if;

  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'insufficient_permission: Caller does not have permission to archive this unit';
  end if;
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'insufficient_permission: Caller does not have property-level permission to archive this unit';
  end if;

  if v_status = 'archived' then
    return; -- idempotent
  end if;

  select count(*) into v_active_lease_count
  from public.leases where unit_id = p_unit_id and status = 'active';
  if v_active_lease_count > 0 then
    raise exception 'unit_has_active_lease: this unit cannot be archived while it has an active lease -- end the tenancy first';
  end if;

  update public.units set status = 'archived' where id = p_unit_id;
end;
$$;

create or replace function public.restore_unit(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_property_id uuid;
  v_status public.unit_status;
begin
  select org_id, property_id, status into v_org_id, v_property_id, v_status
  from public.units where id = p_unit_id;
  if v_org_id is null then
    raise exception 'not_found: Unit not found';
  end if;

  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'insufficient_permission: Caller does not have permission to restore this unit';
  end if;
  if not (public.has_property_access(v_property_id, 'property_manager') or public.has_property_access(v_property_id, 'owner')) then
    raise exception 'insufficient_permission: Caller does not have property-level permission to restore this unit';
  end if;

  if v_status <> 'archived' then
    raise exception 'unit_not_archived: This unit is not archived';
  end if;

  -- Always back to 'vacant', never 'occupied' -- archiving is only ever reachable when no active
  -- lease exists (archive_unit's own guard), so there is nothing to be "occupied" by.
  update public.units set status = 'vacant' where id = p_unit_id;
end;
$$;
