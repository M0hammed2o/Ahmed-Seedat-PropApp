-- Security + maintenance workflow pass (WORKLOG.md this date): maintenance_tickets already had a
-- nullable unit_id column (20260101000034) with no picker UI ever built for it -- the schema was
-- correct, the workflow wasn't. null already means "common area / property-wide" by construction
-- (no separate flag needed), so this only needs (a) a server-side/database-side guarantee that a
-- supplied unit_id actually belongs to the ticket's own property_id -- the task's explicit "do not
-- rely only on the UI" requirement -- and (b) the UI to actually offer the choice (app-layer
-- change, no migration).
--
-- A trigger, not a CHECK constraint, because the invariant spans two tables (units.property_id);
-- security definer so the check is authoritative regardless of the calling session's own
-- visibility into `units` (this is a structural invariant, not an authorization decision --
-- has_property_access already gates whether the caller may write the ticket at all, via the
-- existing maintenance_tickets_write_agent_plus_and_property_access policy).
create or replace function public.validate_maintenance_ticket_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unit_id is not null then
    if not exists (
      select 1 from public.units u where u.id = new.unit_id and u.property_id = new.property_id
    ) then
      raise exception 'unit_id must belong to the maintenance ticket''s own property_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_maintenance_ticket_unit_trigger
  before insert or update on public.maintenance_tickets
  for each row execute function public.validate_maintenance_ticket_unit();

comment on function public.validate_maintenance_ticket_unit() is
  'Rejects any insert/update that sets maintenance_tickets.unit_id to a unit belonging to a
   different property than maintenance_tickets.property_id. unit_id staying null continues to mean
   "common area / property-wide" -- existing tickets with no unit require no backfill and remain
   valid under this trigger unchanged.';
