-- Commercial-launch execution plan, Stage 3, Phase 6 close-out (Governance, WORKLOG.md this date).
-- Stage 0 wired writeAuditEvent() into four routes at the APP layer (expense-create, expense-
-- record, journal-entry-reversal, property-owner-ownership-change) -- real, but only as complete
-- as whichever developer remembered to call it on each route, and this session's own earlier
-- research found that gap is exactly why "who approved this expense" was unanswerable for most of
-- the codebase before Stage 0. This migration takes the plan's own recommendation from that
-- research (WORKLOG.md, Stage 0 entry: "a code-path-dependent log has a weaker evidentiary story
-- than one the database guarantees") and adds DB-TRIGGER-based coverage -- catches every future
-- mutation path automatically, not just the ones a route handler happens to call.
--
-- Scoped to the tables with real, mutable state that benefits from before/after tracking and no
-- existing coverage: owner_statements (draft->issued->paid, payout amounts), cash_receipts
-- (recorded->deposited, variance), maintenance_tickets (status changes, approvals). Deliberately
-- NOT applied to owner_statement_payouts, journal_entries, or journal_lines -- all three are
-- already permanent, immutable, insert-only records with their own actor column
-- (created_by/created_by respectively) baked into the row itself; a generic before/after trigger
-- adds nothing on a table that never has an "after" to diff against. Also not applied to
-- expenses/property_owners -- already covered at the app layer by Stage 0; adding a second,
-- trigger-based writer there now would double-log every action, a data-quality regression, not an
-- improvement -- consolidating those two onto triggers instead is real follow-up work, not done
-- silently here (see TECHNICAL_DEBT_REGISTER.md).

-- Generic, reusable across any table shaped like (id uuid, org_id uuid, ...) -- captures the
-- entire row via to_jsonb(), not just hand-picked fields, so it's strictly more complete than the
-- app-layer calls it complements. security definer because audit_events has no client insert
-- policy at all (by design -- system-only writes, matching lib/audit.ts's own service-role-only
-- posture) and the tables this attaches to are mutated via SECURITY INVOKER RPCs
-- (record_cash_receipt(), confirm_cash_receipt_deposit(), etc.) running as the calling staff
-- member's own role, which has no audit_events grant.
create or replace function public.log_audit_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_entity_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_org_id := (to_jsonb(OLD)->>'org_id')::uuid;
    v_entity_id := (to_jsonb(OLD)->>'id')::uuid;
  else
    v_org_id := (to_jsonb(NEW)->>'org_id')::uuid;
    v_entity_id := (to_jsonb(NEW)->>'id')::uuid;
  end if;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after)
  values (
    v_org_id,
    auth.uid(),
    (case when auth.uid() is null then 'system' else 'user' end)::public.audit_actor_type,
    TG_TABLE_NAME || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    v_entity_id,
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end
  );

  return coalesce(NEW, OLD);
end;
$$;

comment on function public.log_audit_event_trigger() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger. Attach to any (id uuid, org_id uuid, ...)
   table needing automatic before/after governance history -- see this migration''s header for
   which tables deliberately do and do not have it.';

create trigger owner_statements_audit_trigger
  after insert or update or delete on public.owner_statements
  for each row execute function public.log_audit_event_trigger();

create trigger cash_receipts_audit_trigger
  after insert or update or delete on public.cash_receipts
  for each row execute function public.log_audit_event_trigger();

create trigger maintenance_tickets_audit_trigger
  after insert or update or delete on public.maintenance_tickets
  for each row execute function public.log_audit_event_trigger();

-- Owner-facing visibility: `audit_events_select_org_member` (20260101000032) requires
-- has_org_role(), which a genuine owner (no organization_members row -- Phase 5's whole premise)
-- never satisfies. A second, narrower PERMISSIVE policy grants exactly the entity types an owner
-- has real standing to see, each resolved back to their own property/statement grant -- never a
-- blanket "any audit_events row," which would leak other owners'/properties' history.
create policy "audit_events_select_owner_relevant"
  on public.audit_events for select
  using (
    (
      entity_type = 'cash_receipts'
      and exists (
        select 1 from public.cash_receipts cr
        where cr.id = audit_events.entity_id and public.has_property_access(cr.property_id, 'owner')
      )
    )
    or (
      entity_type = 'maintenance_tickets'
      and exists (
        select 1 from public.maintenance_tickets mt
        where mt.id = audit_events.entity_id and public.has_property_access(mt.property_id, 'owner')
      )
    )
    or (
      entity_type = 'owner_statements'
      and exists (
        select 1 from public.owner_statements os
        join public.owners o on o.id = os.owner_id
        where os.id = audit_events.entity_id and o.user_id = auth.uid()
      )
    )
  );
