-- Tenant-portal release-gate pass (WORKLOG.md this date), Part H. LOCAL ONLY -- production
-- migration head remains 157; this file has NOT been applied to production.
--
-- Investigation of the tenant portal's "My Payments" page (apps/admin/app/(tenant)/my-payments/
-- page.tsx) found it computes "outstanding balance" from rent_schedules and shows only
-- self-reported payment_reports -- never the real invoice_payments ledger this whole engagement
-- pass just made authoritative. invoice_payments had NO tenant-self SELECT policy at all
-- (confirmed by direct query against pg_policies), so even a rewritten page could not have shown
-- this data without this policy existing first. Mirrors invoices_select_tenant_self (migration
-- 20260101000049) exactly -- scoped through the owning invoice's tenant_id, never independently.

create policy "invoice_payments_select_tenant_self"
  on public.invoice_payments for select
  using (
    invoice_id in (
      select i.id from public.invoices i where i.tenant_id in (select public.caller_tenant_ids())
    )
  );

comment on policy "invoice_payments_select_tenant_self" on public.invoice_payments is
  'A tenant may read the non-reversed AND reversed invoice_payments rows for their own invoices
   (reversed included -- Part H requires a reversed payment to remain historically visible, never
   hidden, to the tenant too). Scoped through invoices.tenant_id via caller_tenant_ids(), same
   pattern as invoices_select_tenant_self. Tenant-portal release-gate pass.';
