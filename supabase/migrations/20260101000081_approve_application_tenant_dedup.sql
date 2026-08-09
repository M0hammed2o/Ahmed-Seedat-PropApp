-- Workflow-integration pass (WORKLOG.md this date), Stage 9: approve_application() (migration
-- 20260101000031) unconditionally INSERTed a new tenants row on every approval, with no check for
-- an existing person -- directly violates the explicit "do not silently duplicate people"
-- requirement. Fixed by adding an optional p_tenant_id (agent already knows this applicant is an
-- existing tenant -- e.g. re-applying for a different unit) that falls back, when not supplied, to
-- an exact match on tenants.email within the same org (citext, case-insensitive -- same comparison
-- semantics applicant_email already has). No fuzzy name matching: an exact email match is the only
-- deterministic signal available here, guessing on name similarity risks wrongly merging two
-- different people, which is worse than the duplicate this migration is fixing.
--
-- CREATE OR REPLACE with the new parameter appended at the end (default null) keeps every existing
-- caller (apps/admin/app/api/v1/applications/[id]/decide/route.ts, which calls with named
-- parameters) working unchanged. The explicit DROP first matters: Postgres treats a different
-- parameter COUNT as a distinct overload rather than a replacement, so without this the old 6-arg
-- version would keep existing alongside the new 7-arg one -- and any caller relying on defaults
-- (e.g. a 2-positional-arg call) would then hit "function ... is not unique" (found by actually
-- running the local pgTAP suite after this migration, not assumed).
drop function if exists public.approve_application(uuid, numeric, numeric, date, date, public.rent_frequency);

create or replace function public.approve_application(
  p_application_id uuid,
  p_rent_amount numeric,
  p_deposit_amount numeric default 0,
  p_start_date date default current_date,
  p_end_date date default null,
  p_rent_frequency public.rent_frequency default 'monthly',
  p_tenant_id uuid default null
)
returns uuid
language plpgsql
as $$
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

  insert into public.leases (
    org_id, unit_id, start_date, end_date, rent_amount, rent_frequency,
    deposit_amount, status, source, source_application_id
  )
  values (
    v_app.org_id, v_app.unit_id, p_start_date, p_end_date, p_rent_amount, p_rent_frequency,
    p_deposit_amount, 'active', 'application_approved', v_app.id
  )
  returning id into v_lease_id;

  insert into public.lease_tenants (lease_id, tenant_id, is_primary)
  values (v_lease_id, v_tenant_id, true);

  -- First period's rent_schedules row only -- ongoing recurring generation for subsequent periods
  -- is a scheduling/cron concern (unchanged from the original function -- see
  -- TECHNICAL_DEBT_REGISTER.md).
  insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
  values (v_app.org_id, v_lease_id, p_start_date, p_rent_amount, 'pending');

  -- Also handled by sync_unit_status_from_lease_trigger (migration 20260101000079) since this
  -- INSERTs a lease with status='active' directly -- left in place as a defensive, idempotent
  -- no-op write rather than relied upon, exactly as that trigger's own comment anticipates.
  update public.units set status = 'occupied' where id = v_app.unit_id;

  update public.applications
  set status = 'decided', decision = 'approved', decided_by = auth.uid(), decided_at = now()
  where id = p_application_id;

  return v_lease_id;
end;
$$;

comment on function public.approve_application(uuid, numeric, numeric, date, date, public.rent_frequency, uuid) is
  'Atomically creates (or links, via p_tenant_id / email match) a tenant, creates an active lease +
   lease_tenants + first rent_schedules row, and marks the application decided=approved. Never
   creates a duplicate tenants row when an explicit p_tenant_id is given or an existing tenant in
   the same org shares the applicant''s email.';
