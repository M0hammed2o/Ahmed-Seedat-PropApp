-- TASKS.md M10 / TECHNICAL_DEBT_REGISTER.md TD-20: recurring monthly rent_schedules generation.
-- approve_application() (migration 20260101000031) deliberately creates only the first period's
-- row -- this migration adds the ongoing generator that fills in every subsequent period, closing
-- the gap that otherwise leaves the Rent Due dashboard silently blank from month 2 onward.

-- A real, DB-enforced duplicate guard (not just application logic) -- this is what makes the
-- generator idempotent/retry-safe: calling it twice for the same lease/period is a no-op, not a
-- duplicate row.
alter table public.rent_schedules
  add constraint rent_schedules_lease_due_unique unique (lease_id, due_date);

-- generate_rent_schedules_for_lease: inserts every missing monthly rent_schedules row for one
-- lease, from its own start_date cadence, up to and including p_through, stopping strictly before
-- end_date when present. Only ever INSERTs -- existing rows (pending/invoiced/paid/partial/
-- overdue) are never touched, so posted/paid history is always preserved.
--
-- Each period's due date is computed directly from start_date + (k months), never chained off
-- the previous row's due date -- Postgres's date+interval arithmetic clamps a day that doesn't
-- exist in the target month (2026-01-31 + 1 month = 2026-02-28), and a naive running "+1 month"
-- chain from that clamped result would permanently lose the 31st for every later period. Anchoring
-- every period to the original start_date recovers the correct day whenever the target month is
-- long enough (2026-01-31 + 2 months = 2026-03-31 computed directly, not via February).
--
-- No mid-month proration is applied -- ACCOUNTING.md/DATABASE.md document no proration rule for a
-- lease starting mid-month, and approve_application() itself already posts the full rent_amount
-- for period one regardless of the day of month, so this generator matches that existing,
-- unambiguous V1 behaviour rather than inventing a new rule for periods 2+.
--
-- SECURITY DEFINER because the intended caller is a system job with no interactive session/org
-- membership (see the API route this backs) -- EXECUTE is revoked from anon/authenticated below
-- and granted only to service_role, the same lockdown pattern already used for
-- resolve_whatsapp_sender() (migration 20260101000040). org_id/lease scope are always read from
-- the lease row itself, never accepted as caller input, so this cannot be used to write into an
-- org the caller doesn't already have a lease_id for.
create or replace function public.generate_rent_schedules_for_lease(
  p_lease_id uuid,
  p_through date default (current_date + interval '1 month')::date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease public.leases%rowtype;
  v_period_count integer;
  v_due_date date;
  v_created integer := 0;
begin
  select * into v_lease from public.leases where id = p_lease_id for update;
  if not found then
    raise exception 'Lease % not found', p_lease_id;
  end if;

  -- draft/expired/terminated leases never get new schedule rows -- only an active lease is
  -- expected to keep accruing rent due.
  if v_lease.status <> 'active' then
    return 0;
  end if;

  select count(*) into v_period_count from public.rent_schedules where lease_id = p_lease_id;

  loop
    v_due_date := (v_lease.start_date + (v_period_count || ' months')::interval)::date;
    exit when v_due_date > p_through;
    exit when v_lease.end_date is not null and v_due_date >= v_lease.end_date;

    insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
    values (v_lease.org_id, v_lease.id, v_due_date, v_lease.rent_amount, 'pending')
    on conflict (lease_id, due_date) do nothing;

    if found then
      v_created := v_created + 1;
    end if;

    v_period_count := v_period_count + 1;
  end loop;

  return v_created;
end;
$$;

comment on function public.generate_rent_schedules_for_lease(uuid, date) is
  'Idempotently fills in every missing monthly rent_schedules row for one active lease, anchored
   to its own start_date, up to p_through and never at/after end_date. TASKS.md M10, TD-20.';

revoke execute on function public.generate_rent_schedules_for_lease(uuid, date) from public;
revoke execute on function public.generate_rent_schedules_for_lease(uuid, date) from anon, authenticated;
grant execute on function public.generate_rent_schedules_for_lease(uuid, date) to service_role;

-- generate_rent_schedules_for_active_leases: the bulk entry point the scheduled job actually
-- calls -- every active lease across every org, in one pass. Returns one row per lease so the
-- caller (API route) can log/report exactly what was generated, per org, without a second query.
create or replace function public.generate_rent_schedules_for_active_leases(
  p_through date default (current_date + interval '1 month')::date
)
returns table(lease_id uuid, org_id uuid, created_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease record;
begin
  for v_lease in select l.id, l.org_id from public.leases l where l.status = 'active' order by l.id loop
    return query select v_lease.id, v_lease.org_id, public.generate_rent_schedules_for_lease(v_lease.id, p_through);
  end loop;
end;
$$;

comment on function public.generate_rent_schedules_for_active_leases(date) is
  'Runs generate_rent_schedules_for_lease() for every active lease, across every org, in one pass
   -- the function a scheduled job / callable admin endpoint invokes. TASKS.md M10, TD-20.';

revoke execute on function public.generate_rent_schedules_for_active_leases(date) from public;
revoke execute on function public.generate_rent_schedules_for_active_leases(date) from anon, authenticated;
grant execute on function public.generate_rent_schedules_for_active_leases(date) to service_role;
