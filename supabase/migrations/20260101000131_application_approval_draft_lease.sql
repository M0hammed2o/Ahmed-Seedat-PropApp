-- Applicant->tenant->lease V1 audit (WORKLOG.md 2026-08-25): approval-semantics fix, the single
-- most architecturally significant change in this pass. approve_application() (originally
-- 20260101000031) currently creates the tenant AND an ACTIVE lease AND a rent_schedules row AND
-- directly occupies the unit, all atomically at approval time. That conflates two genuinely
-- different real-world events: "we have decided to accept this applicant" (a decision) and "this
-- unit is now actually occupied under agreed commercial terms" (a fact that should only become
-- true once a real lease has been prepared, reviewed, sent, and accepted/activated). It also forces
-- staff to supply commercial terms (rent/deposit/dates) at the moment of a screening decision,
-- before any lease document has even been drafted.
--
-- New behaviour: approval creates/links a tenant (dedup logic unchanged) and a DRAFT lease with
-- source_application_id set, with the applicant's tenant already assigned via lease_tenants -- but
-- deliberately does NOT set an active status, does NOT touch units.status, and does NOT create a
-- rent_schedules row. Those all remain exclusively activate_lease()'s job (migration
-- 20260101000078, already correct and untouched by this migration): it already independently
-- requires a tenant to be assigned, rent_amount > 0, and a start_date before allowing 'draft' ->
-- 'active', and only generates the rent schedule at that point via
-- generate_rent_schedules_for_lease(). sync_unit_status_from_lease_trigger (20260101000079) only
-- reacts to a lease's status actually becoming 'active', so inserting a 'draft' lease here is
-- already a verified no-op for unit occupancy (confirmed by reading the trigger, not assumed).
--
-- rent_amount/start_date placeholders (0 / current_date) exist only to satisfy the leases table's
-- own NOT NULL / >= 0 constraints -- they carry no commercial meaning and activate_lease() already
-- refuses to activate a lease with rent_amount <= 0, so a never-completed draft can never silently
-- become a real occupancy-driving lease.
--
-- Manual lease creation (POST /api/v1/leases, always source='manual', source_application_id null)
-- is completely untouched by this migration -- a different code path, never routed through this
-- function.
--
-- Drops the old 7-parameter signature (rent/deposit/dates/frequency all removed -- those are now
-- entered during lease preparation, not at the approval decision) and replaces it with a 2-parameter
-- version. Call sites (apps/admin/app/api/v1/applications/[id]/decide/route.ts and its
-- validation/UI) are updated in the same commit as this migration.

drop function if exists public.approve_application(uuid, numeric, numeric, date, date, rent_frequency, uuid);

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

  -- Draft only. Commercial terms are set during lease preparation and the lease only ever becomes
  -- active (and only ever drives occupancy/rent-schedule generation) via activate_lease().
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

comment on function public.approve_application(uuid, uuid) is
  'Approval decision only: creates/links a tenant and a DRAFT lease (source_application_id set,
   tenant already assigned) -- never active, never occupies the unit, never creates a rent
   schedule. Those remain activate_lease()''s exclusive responsibility (migration 20260101000078).
   Returns the new draft lease id.';
