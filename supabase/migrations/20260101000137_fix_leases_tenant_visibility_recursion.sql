-- Applicant->tenant->lease V1 continuation (WORKLOG.md 2026-08-25): fixes a real bug in the
-- immediately-preceding migration (20260101000136), caught by the pgTAP suite itself (infinite
-- recursion detected in policy for relation "leases") -- never committed on its own, so this is a
-- direct correction, not a later "never edit an already-shipped migration" violation.
--
-- Root cause: leases_select_tenant_self's new branch queried lease_preparations directly, but
-- lease_preparations' OWN staff RLS policies join back through leases (to check
-- has_org_role/has_property_access via the lease's own org/property) -- Postgres evaluates RLS
-- policies for every table touched by a query, including tables referenced inside another table's
-- policy's own subquery, so this created leases -> lease_preparations -> leases -> ... recursion
-- the instant a caller without staff access on the org tried to insert/select a leases row at all
-- (approve_application() itself hit this immediately, since it inserts into leases as an ordinary
-- session-authenticated agent, not a superuser).
--
-- Fix: move the "is this lease's current preparation status 'sent'?" check into a SECURITY DEFINER
-- function. A security-definer function owned by a superuser bypasses RLS on the tables it queries
-- internally (same reasoning already relied on throughout this session -- e.g.
-- caller_is_tenant_of_lease() itself is SECURITY DEFINER for exactly this reason), so the
-- lease_preparations lookup inside it never re-triggers lease_preparations' own RLS, breaking the
-- cycle.

create or replace function public.lease_is_prepared_and_sent(p_lease_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lease_preparations lp
    where lp.lease_id = p_lease_id and lp.status = 'sent'
  );
$$;

drop policy if exists leases_select_tenant_self on public.leases;
create policy leases_select_tenant_self on public.leases
for select
using (
  caller_is_tenant_of_lease(id)
  and (status <> 'draft' or public.lease_is_prepared_and_sent(id))
);
