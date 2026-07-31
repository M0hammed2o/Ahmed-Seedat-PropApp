-- approve_application(): the atomic application-approval transaction DATABASE.md §4 requires
-- ("an application-layer transaction, not a DB trigger, so the business logic stays
-- testable/observable"). A plpgsql function called via RPC is the application layer here, in the
-- same sense create_organization()/accept_organization_invite() already are -- it's still a real,
-- unit-testable function (pgTAP can call it directly), just one that guarantees the multi-table
-- write is all-or-nothing, which a sequence of separate PostgREST calls from a route handler
-- cannot guarantee.
--
-- Deliberately NOT security definer, unlike create_organization()/accept_organization_invite():
-- those needed to bypass RLS because the calling user had no qualifying row yet at call time
-- (bootstrapping problem). Here the caller already holds an agent+ membership in the application's
-- org (that's how they could see/act on the application at all), so every insert below is
-- evaluated under the caller's own RLS exactly as if they'd made each call separately -- this
-- function adds atomicity, not privilege.
--
-- Rejected an "assumed" business rule during design: DATABASE.md's own applications description
-- does not state that screening must have passed before approval is allowed, so this function does
-- not enforce that -- encoding an unstated policy as a hard DB constraint would be a real product
-- decision, not an engineering one (RISK_REGISTER.md-worthy if guessed wrong). It does enforce
-- what DATABASE.md's own CHECK constraint on `applications` already implies: a decision can only
-- be made once (an already-decided application cannot be re-decided).
create or replace function public.approve_application(
  p_application_id uuid,
  p_rent_amount numeric,
  p_deposit_amount numeric default 0,
  p_start_date date default current_date,
  p_end_date date default null,
  p_rent_frequency public.rent_frequency default 'monthly'
)
returns uuid
language plpgsql
as $$
declare
  v_app public.applications%rowtype;
  v_tenant_id uuid;
  v_lease_id uuid;
begin
  select * into v_app from public.applications where id = p_application_id for update;

  if not found then
    raise exception 'Application not found (or not visible to the caller)';
  end if;

  if v_app.status = 'decided' then
    raise exception 'Application % has already been decided', p_application_id;
  end if;

  insert into public.tenants (org_id, full_name, email, phone, status)
  values (v_app.org_id, v_app.applicant_name, v_app.applicant_email, v_app.applicant_phone, 'active')
  returning id into v_tenant_id;

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
  -- is a scheduling/cron concern, tracked separately (TECHNICAL_DEBT_REGISTER.md), not invented
  -- here as an unbounded loop against a lease that may have no end_date.
  insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
  values (v_app.org_id, v_lease_id, p_start_date, p_rent_amount, 'pending');

  -- Natural, expected side effect of a lease starting (units.status feeds the Units/occupancy
  -- dashboard, DATABASE.md §3) -- not documented explicitly for this function, but consistent
  -- with the unit_status enum's own purpose.
  update public.units set status = 'occupied' where id = v_app.unit_id;

  update public.applications
  set status = 'decided', decision = 'approved', decided_by = auth.uid(), decided_at = now()
  where id = p_application_id;

  return v_lease_id;
end;
$$;

comment on function public.approve_application(uuid, numeric, numeric, date, date, public.rent_frequency) is
  'Atomically creates tenant + lease + lease_tenants + first rent_schedules row and marks the
   application decided=approved, per DATABASE.md §4. Not security definer -- relies on the
   caller''s own agent+ RLS rights on every table it writes to.';
