-- Applicant->tenant->lease V1 continuation (WORKLOG.md 2026-08-25), Phase V security fix: a real
-- information-disclosure gap surfaced by this pass's own earlier work, not present before it.
-- approve_application() (migration 20260101000131) now assigns the tenant to a DRAFT lease via
-- lease_tenants immediately at approval time -- but leases_select_tenant_self (unchanged since
-- long before this pass) has no status filter at all, so /my-lease's own query
-- (apps/admin/app/(tenant)/my-lease/page.tsx) would already let that tenant read the draft lease's
-- placeholder rent/dates before staff has ever reviewed or sent it. This never happened previously
-- because a tenant was only ever assigned to a lease that was already active.
--
-- Fix: a tenant may see a lease that is NOT a draft (active/expired/terminated -- unchanged
-- behaviour), OR a draft lease that has actually been sent (lease_preparations.status = 'sent',
-- Phase S) -- matching "tenant accesses lease securely" only ever happening after explicit send,
-- never before.

drop policy if exists leases_select_tenant_self on public.leases;
create policy leases_select_tenant_self on public.leases
for select
using (
  caller_is_tenant_of_lease(id)
  and (
    status <> 'draft'
    or exists (
      select 1 from public.lease_preparations lp
      where lp.lease_id = leases.id and lp.status = 'sent'
    )
  )
);
