-- Workflow-integration pass (WORKLOG.md this date), Stage 7/18: `units.status` was a bare manual
-- field before this migration -- the only automatic writer was approve_application() (migration
-- 20260101000031), so a manually-created-and-activated lease never flipped its unit to occupied,
-- and NOTHING anywhere ever reverted a unit to vacant when a lease ended (grepped the whole
-- codebase before writing this -- confirmed, not assumed). This migration makes lease activity the
-- single authoritative source for occupied/vacant; 'maintenance' remains a manual, explicit
-- operational override, enforced only at the API layer (this migration doesn't change how
-- `maintenance` gets set -- it only makes `occupied`/`vacant` system-derived), gated so it can only
-- be applied when the unit has no active lease (see apps/admin/app/api/v1/units/[id]/route.ts).

-- One-time backfill, added after a real incremental-upgrade simulation against representative
-- pre-079 data proved the trigger below is forward-only: it only fires on a lease INSERT/UPDATE,
-- so any unit whose status was already wrong relative to its real lease state (e.g. manually
-- marked 'occupied' with no active lease, or left 'vacant' despite an active lease -- both
-- reachable under the pre-078/079 schema, which enforced neither) would stay wrong forever unless
-- something later touched that specific lease again. This directly serves the migration's own
-- stated purpose ("make lease activity the single authoritative source for occupied/vacant") --
-- unlike the duplicate-active-lease case in migration 20260101000078, this has one objectively
-- correct answer derivable from data that already exists (does an active lease exist for this
-- unit, yes or no), not a business judgement call, so it is safe to apply automatically rather
-- than requiring manual resolution. 'maintenance' is left untouched -- it is an explicit manual
-- override, not something lease activity should ever silently overwrite.
update public.units u
set status = case when exists (
  select 1 from public.leases l where l.unit_id = u.id and l.status = 'active'
) then 'occupied'::public.unit_status else 'vacant'::public.unit_status end
where u.status <> 'maintenance'
  and u.status <> (case when exists (
    select 1 from public.leases l where l.unit_id = u.id and l.status = 'active'
  ) then 'occupied'::public.unit_status else 'vacant'::public.unit_status end);

create or replace function public.sync_unit_status_from_lease()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    update public.units set status = 'occupied' where id = new.unit_id;
  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status in ('expired', 'terminated') then
    -- Defensive `status = 'occupied'` guard: by construction this unit's status can only be
    -- 'occupied' at this point (the branch above is the only way it became so), never
    -- 'maintenance' -- maintenance is only settable via the API when no active lease exists. The
    -- guard exists so this trigger never clobbers a maintenance flag it didn't itself set, in case
    -- production data predating this migration is ever inconsistent.
    update public.units set status = 'vacant' where id = new.unit_id and status = 'occupied';
  end if;
  return new;
end;
$$;

comment on function public.sync_unit_status_from_lease() is
  'Authoritative source for units.status = occupied/vacant: fires whenever a lease becomes (or
   stops being) active. Security definer so it can write units.status regardless of the caller''s
   own direct grants on that table -- same posture as track_property_ownership_history().';

create trigger sync_unit_status_from_lease_trigger
  after insert or update of status on public.leases
  for each row execute function public.sync_unit_status_from_lease();
