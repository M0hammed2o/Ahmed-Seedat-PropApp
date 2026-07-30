-- M5 (TASKS.md): the "contract" step of properties' expand/contract migration begun in
-- 20260101000022. No real production data exists yet (WORKLOG.md, DECISIONS.md), so the
-- backfill below is a no-op in practice, not a real data migration — this is still written as a
-- proper backfill-then-constrain sequence rather than a direct `not null` so the same migration
-- shape works unchanged once real data does exist.
--
-- Scope note: this migration cuts over `properties` only. `documents`/`bills`/`payments`/
-- `payment_matches`/`extraction_jobs`/`subscriptions`/`audit_events` share the same
-- `owner_user_id` pattern and were originally scoped to land in this same change (TASKS.md M1's
-- original note) — deliberately deferred here instead, because completing all eight tables'
-- cutover (schema + every dependent application file) in one pass, within one working session,
-- risked leaving all eight in a half-finished state rather than one done correctly. Tracked as
-- the next unit of work, not silently dropped — see TECHNICAL_DEBT_REGISTER.md.

-- Backfill: any existing row with org_id still null cannot be assigned an org automatically
-- (there is no reliable mapping from an individual owner_user_id to one specific organization —
-- that mapping is a business decision, not something a migration should guess). In this
-- environment there are zero such rows. If this is ever run against a database that does have
-- rows, it will raise below rather than silently corrupting ownership.
do $$
declare
  v_unassigned_count integer;
begin
  select count(*) into v_unassigned_count from public.properties where org_id is null;
  if v_unassigned_count > 0 then
    raise exception
      'properties_org_contract: % row(s) have no org_id assigned. This migration does not guess an owner-to-org mapping — assign org_id manually (or via a one-off script informed by real business context) before re-running.',
      v_unassigned_count;
  end if;
end $$;

alter table public.properties alter column org_id set not null;
alter table public.properties drop column owner_user_id;

-- Replace the PropVault-era single-owner RLS policies with the org-scoped equivalent, matching
-- the pattern already established for `units` (20260101000022).
drop policy if exists "properties_select_own" on public.properties;
drop policy if exists "properties_insert_own" on public.properties;
drop policy if exists "properties_update_own" on public.properties;
drop policy if exists "properties_delete_own" on public.properties;

create policy "properties_select_org_member"
  on public.properties for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "properties_write_agent_plus"
  on public.properties for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- The old owner_user_id index is gone with the column; org_id already has an index from the
-- expand-step migration (20260101000022), and (org_id, status) from that same migration covers
-- the list-view query shape.
