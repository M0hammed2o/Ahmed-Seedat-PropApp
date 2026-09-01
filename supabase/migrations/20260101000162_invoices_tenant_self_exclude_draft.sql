-- Autonomous overnight completion pass (WORKLOG.md this date), Phase A item 5/2. LOCAL ONLY --
-- production migration head remains 157 until the controlled deployment phase; this file has not
-- been applied to production yet.
--
-- invoices_select_tenant_self (migration 20260101000049) had no status filter at all -- a tenant
-- could SELECT (and therefore, via GET /api/v1/invoices/:id/pdf, download the PDF of) a DRAFT
-- invoice belonging to them. The tenant-portal application layer (loadInvoicesWithBalances())
-- already filters drafts out of what it DISPLAYS, but that is an application-level filter, not the
-- real RLS boundary -- a caller querying the invoices table directly (or any future route reusing
-- this same policy) was never actually blocked. Tightened to issued-only, matching "Draft invoices
-- must remain hidden" / "Draft invoice: blocked" exactly. Staff still see drafts via the unchanged
-- invoices_select_org_member policy (previewing a draft before issuing is intended staff
-- behaviour) -- this only narrows the TENANT'S OWN read.

drop policy "invoices_select_tenant_self" on public.invoices;
create policy "invoices_select_tenant_self"
  on public.invoices for select
  using (
    tenant_id in (select public.caller_tenant_ids())
    and status = 'issued'
  );

comment on policy "invoices_select_tenant_self" on public.invoices is
  'A tenant may only ever see their own ISSUED invoices -- never draft. A draft invoice id a tenant
   somehow obtained resolves to the same "not found" a genuinely nonexistent id would (RLS hides
   the row entirely, never a separate existence-confirming 403) -- same "never confirm a hidden
   resource" pattern used throughout this codebase. Autonomous overnight completion pass.';

-- Same gap, one join deeper: invoice_line_items_select_tenant_self (migration 20260101000152) also
-- had no status filter -- a tenant could read a draft invoice's line items even though the
-- invoice row itself is now hidden by the fix above.
drop policy "invoice_line_items_select_tenant_self" on public.invoice_line_items;
create policy "invoice_line_items_select_tenant_self"
  on public.invoice_line_items for select
  using (
    exists (
      select 1 from public.invoices i
      join public.tenants t on t.id = i.tenant_id
      where i.id = invoice_line_items.invoice_id
        and t.user_id = auth.uid()
        and i.status = 'issued'
    )
  );

comment on policy "invoice_line_items_select_tenant_self" on public.invoice_line_items is
  'Same issued-only tightening as invoices_select_tenant_self, one join deeper -- a tenant must
   never read a draft invoice''s line items even if they somehow obtained its id. Autonomous
   overnight completion pass.';
