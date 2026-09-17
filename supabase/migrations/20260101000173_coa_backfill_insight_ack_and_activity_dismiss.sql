-- Android V1 cleanup pass (2026-09-17). Four narrow, additive changes behind three reported bugs.
-- Nothing here changes a financial calculation, drops anything, or touches customer records other
-- than adding the ledger accounts an organisation is supposed to have had from the day it existed.

-- === 1. Organisations created outside create_organization() never got a chart of accounts =======
--
-- Confirming a tenant-reported payment fails for such an org. Traced end to end on 2026-09-17:
-- confirm_payment_report -> record_invoice_payment -> post_journal_entry, which raises
-- 'chart_of_accounts_incomplete' because the org has zero rows in chart_of_accounts. The RPC
-- reported that back as the generic 'ledger_allocation_failed', whose user-facing message claims
-- the invoice "may already be fully paid" -- untrue and misleading here.
--
-- seed_chart_of_accounts() (20260101000035) is called from create_organization(), and orgs created
-- any other way (the demo/provisioning scripts insert the row directly) silently skipped it. The
-- same backfill shape as 20260101000051, which added the trust accounts to already-existing orgs.
-- Only orgs with NO accounts at all are touched; an org that has any is left exactly as it is,
-- because accounts are permanent by design ("cannot be deleted, only deactivated").
do $$
declare
  v_org record;
  v_seeded integer := 0;
begin
  for v_org in
    select o.id
    from public.organizations o
    where not exists (select 1 from public.chart_of_accounts c where c.org_id = o.id)
  loop
    perform public.seed_chart_of_accounts(v_org.id);
    v_seeded := v_seeded + 1;
  end loop;
  raise notice 'seeded a chart of accounts for % organisation(s) that had none', v_seeded;
end $$;

-- === 2. Say WHY an allocation failed, instead of one catch-all ================================
--
-- Same function as 20260101000165 with one change: the exception handler keeps the underlying
-- SQLSTATE/message and maps the one cause a user can actually act on
-- ('chart_of_accounts_incomplete') to its own error_code. Everything else still collapses to
-- ledger_allocation_failed, and every success path is byte-for-byte the previous behaviour.
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
  v_error_message text;
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
    -- (or was deliberately skipped) on the first transition. This is what makes a double tap in
    -- the app safe.
    if v_report.status = 'confirmed' then
      return query select true, null::text, v_report.org_id, v_report.tenant_id, v_report.amount,
        (v_report.invoice_payment_id is not null), v_report.invoice_payment_id;
      return;
    end if;
    return query select false, 'already_rejected'::text, null::uuid, null::uuid, null::numeric, false, null::uuid;
    return;
  end if;

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
      get stacked diagnostics v_error_message = message_text;
      if v_error_message like 'chart_of_accounts_incomplete%' then
        return query select false, 'chart_of_accounts_incomplete'::text, null::uuid, null::uuid, null::numeric, false, null::uuid;
      else
        return query select false, 'ledger_allocation_failed'::text, null::uuid, null::uuid, null::numeric, false, null::uuid;
      end if;
      return;
    end;
  end if;

  update public.payment_reports
  set status = 'confirmed', reviewed_by = auth.uid(), reviewed_at = now(), invoice_payment_id = v_invoice_payment_id
  where id = p_payment_report_id;

  return query select true, null::text, v_report.org_id, v_report.tenant_id, v_report.amount,
    (v_invoice_payment_id is not null), v_invoice_payment_id;
end;
$$;

comment on function public.confirm_payment_report(uuid) is
  'Owner/staff (accountant+) acknowledges a reported payment AND, when it references a specific
   rent_schedule with a matching issued invoice, allocates it through record_invoice_payment() --
   the same single authoritative ledger entry point every other payment path uses. Idempotent on an
   already-confirmed report (never re-allocates). error_code is invoice_not_issued when no invoice
   has been issued for the period, chart_of_accounts_incomplete when the organisation has no ledger
   accounts to post to (2026-09-17), and ledger_allocation_failed for anything else.';

-- === 3. Acknowledging a Needs-attention alert that is still true ===============================
--
-- portfolio_insights.dismissed_at is already used by reconcilePortfolioInsights() to auto-resolve
-- an insight whose condition stopped being true. Reusing it for "the user dismissed this" would
-- conflate the two: the reconciler filters dismissed rows out of its "already exists" lookup, so a
-- still-true condition is simply re-inserted as a brand-new row and the alert reappears minutes
-- later.
--
-- acknowledged_at is the separate, honest state: the condition is STILL TRUE and still counted as
-- an unresolved business fact, the person has simply said "I have seen this". The reconciler keeps
-- the acknowledgement while the condition is unchanged, and clears it when severity or message
-- changes -- a materially different alert deserves attention again.
alter table public.portfolio_insights
  add column if not exists acknowledged_at timestamptz;

comment on column public.portfolio_insights.acknowledged_at is
  'Set when a user acknowledges an alert that is still true (2026-09-17). Distinct from
   dismissed_at, which the reconciler sets when the underlying condition stops being true.
   Acknowledged alerts are hidden from the default Needs-attention feed but remain unresolved, so
   overdue rent stays overdue -- acknowledging never changes business data.';

create index if not exists portfolio_insights_open_idx
  on public.portfolio_insights (org_id, severity)
  where dismissed_at is null and acknowledged_at is null;

-- === 4. Hiding a single Activity entry ========================================================
--
-- The Activity feed is public.notifications, one row per user, which already carries read_at and
-- whose RLS lets a user update their own rows. Dismissing hides that person's feed entry and
-- nothing else: the payment, invoice or ticket it describes is untouched, and other users keep
-- their own copies.
alter table public.notifications
  add column if not exists dismissed_at timestamptz;

comment on column public.notifications.dismissed_at is
  'Set when the recipient hides this entry from their own Activity feed (2026-09-17). Never deletes
   the business record the notification describes, and never affects another user''s feed.';

create index if not exists notifications_visible_idx
  on public.notifications (user_id, created_at desc)
  where dismissed_at is null;
