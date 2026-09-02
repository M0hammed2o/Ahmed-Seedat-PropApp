-- Payment-report ledger allocation fix (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §7 finding,
-- WORKLOG.md this date).
--
-- TRACED before writing this migration: confirm_payment_report() (migration 20260101000106) and
-- its API wrapper (apps/admin/app/api/v1/payment-reports/[id]/confirm/route.ts) only ever flip
-- payment_reports.status and dispatch a WhatsApp notification. They NEVER call
-- record_invoice_payment() (migration 20260101000158, the one authoritative payment-allocation
-- entry point) or touch invoice_payments/rent_schedules.status in any way. So today, an owner
-- tapping "Confirm" on a tenant-reported payment does NOT change what Rent Due, the tenant portal,
-- or Owner Home read as the tenant's paid/outstanding status -- those all read rent_schedules.status
-- directly, and it never moves. This is a real gap between what the UI implies ("payment
-- confirmed") and what the ledger actually records, not merely a documentation gap.
--
-- Audit trail was ALSO traced and found to be correctly implemented already (both the confirm and
-- reject API routes call writeAuditEvent() with the service-role client after a successful RPC) --
-- that part of the prior audit's Blocker #4 is resolved; nothing needed changing there.
--
-- Fix: confirm_payment_report() now allocates through record_invoice_payment() -- the SAME single
-- entry point every other payment path already uses -- whenever the report can be unambiguously
-- matched to one issued invoice. It does NOT invent a second ledger and does NOT set
-- rent_schedules.status directly; recompute_rent_schedule_status() (called from inside
-- record_invoice_payment()) remains the only writer of that column, unchanged.
--
-- Three distinguishable outcomes on first confirmation (never re-run on an idempotent re-confirm,
-- since the ledger call only happens on the reported -> confirmed transition):
--   1. rent_schedule_id is set AND a matching 'issued' invoice exists -> allocated for real via
--      record_invoice_payment(); ledger_allocated = true.
--   2. rent_schedule_id is null (e.g. an advance/ad-hoc payment not tied to one schedule row) ->
--      acknowledgement-only, EXACTLY the old behaviour, ledger_allocated = false. This is a
--      genuine ambiguity (which invoice would it even apply to?), not a shortcut -- documented in
--      UTILITIES_RATES_BUDGET_IMPLEMENTATION.md.
--   3. rent_schedule_id is set but no matching issued invoice exists yet -> confirmation is
--      REFUSED (error_code 'invoice_not_issued'), not silently downgraded to acknowledgement-only
--      -- issuing the invoice is a separate, existing accountant action this migration does not
--      reach into.
-- Overpayment / already-allocated conflicts from record_invoice_payment() are caught and surfaced
-- as a structured error_code instead of a raw exception reaching the API route as a 500.

alter table public.payment_reports
  add column invoice_payment_id uuid references public.invoice_payments(id);

comment on column public.payment_reports.invoice_payment_id is
  'Set only when confirm_payment_report() successfully allocated this report through
   record_invoice_payment() (migration 165). Null means either not yet confirmed, or confirmed as
   acknowledgement-only (no rent_schedule_id to unambiguously allocate against) -- see this
   migration''s header comment.';

-- payment_report_method ('eft','cash','other') is a strict subset of invoice_payments' own method
-- CHECK list ('eft','cash','card','debit_order','bank_deposit','other') -- confirmed before writing
-- this, so the pass-through mapping below needs no translation table.

drop function if exists public.confirm_payment_report(uuid);

create or replace function public.confirm_payment_report(p_payment_report_id uuid)
returns table (
  success boolean,
  error_code text,
  org_id uuid,
  tenant_id uuid,
  amount numeric,
  ledger_allocated boolean,
  invoice_payment_id uuid
)
language plpgsql
as $$
declare
  v_report public.payment_reports%rowtype;
  v_rent_schedule public.rent_schedules%rowtype;
  v_invoice_id uuid;
  v_invoice_payment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'confirm_payment_report requires an authenticated user';
  end if;

  select * into v_report from public.payment_reports where id = p_payment_report_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid, null::uuid, null::numeric, false, null::uuid;
    return;
  end if;

  if not public.has_org_role(v_report.org_id, 'accountant') then
    return query select false, 'forbidden'::text, null::uuid, null::uuid, null::numeric, false, null::uuid;
    return;
  end if;

  if v_report.status <> 'reported' then
    -- Idempotent: re-confirming never re-runs the ledger allocation below -- it already happened
    -- (or was deliberately skipped) on the first transition.
    if v_report.status = 'confirmed' then
      return query select true, null::text, v_report.org_id, v_report.tenant_id, v_report.amount,
        (v_report.invoice_payment_id is not null), v_report.invoice_payment_id;
      return;
    end if;
    return query select false, 'already_rejected'::text, null::uuid, null::uuid, null::numeric, false, null::uuid;
    return;
  end if;

  -- Ledger allocation, only when unambiguous (outcome 1 above).
  if v_report.rent_schedule_id is not null then
    select * into v_rent_schedule from public.rent_schedules where id = v_report.rent_schedule_id;

    select i.id into v_invoice_id
    from public.invoices i
    where i.lease_id = v_rent_schedule.lease_id
      and i.period = v_rent_schedule.due_date
      and i.status = 'issued'
    limit 1;

    if v_invoice_id is null then
      return query select false, 'invoice_not_issued'::text, null::uuid, null::uuid, null::numeric, false, null::uuid;
      return;
    end if;

    begin
      v_invoice_payment_id := public.record_invoice_payment(
        v_invoice_id,
        v_report.amount,
        v_report.payment_date,
        v_report.payment_method::text,
        'payment_report:' || v_report.id::text,
        'Allocated from tenant-reported payment (payment_reports.' || v_report.id::text || ')',
        null
      );
    exception when others then
      return query select false, 'ledger_allocation_failed'::text, null::uuid, null::uuid, null::numeric, false, null::uuid;
      return;
    end;
  end if;

  update public.payment_reports
  set status = 'confirmed', reviewed_by = auth.uid(), reviewed_at = now(), invoice_payment_id = v_invoice_payment_id
  where id = p_payment_report_id;

  -- No audit_events write here, deliberately -- unchanged from the original migration's own
  -- reasoning (SECURITY INVOKER, audit_events has no client insert policy; the API route already
  -- correctly writes it with the service-role client after this returns success -- traced and
  -- confirmed working in this same pass, see this migration's header comment).
  return query select true, null::text, v_report.org_id, v_report.tenant_id, v_report.amount,
    (v_invoice_payment_id is not null), v_invoice_payment_id;
end;
$$;

comment on function public.confirm_payment_report(uuid) is
  'Owner/staff (accountant+) acknowledges a reported payment AND, when it references a specific
   rent_schedule with a matching issued invoice, allocates it through record_invoice_payment() --
   the same single authoritative ledger entry point every other payment path uses. Idempotent on an
   already-confirmed report (never re-allocates). Returns ledger_allocated=false when the report has
   no rent_schedule_id (acknowledgement-only, unchanged from pre-165 behaviour) or
   error_code=invoice_not_issued when it has one but no matching invoice has been issued yet.';
