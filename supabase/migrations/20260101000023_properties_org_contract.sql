-- M5 (TASKS.md): the "contract" step of properties' expand/contract migration begun in
-- 20260101000022. No real production data exists yet (WORKLOG.md, DECISIONS.md), so the
-- backfill below is a no-op in practice, not a real data migration — this is still written as a
-- proper backfill-then-constrain sequence rather than a direct `not null` so the same migration
-- shape works unchanged once real data does exist.
--
-- REVISED 2026-07-30 after a real `supabase start` run against a clean local database (per
-- Mohammed's instruction to verify migrations for real before going further) caught something
-- the original version of this migration got wrong: it does NOT actually drop `owner_user_id`.
-- The original version tried to; Postgres rejected the `DROP COLUMN` because
-- `document_categories.sql` (`property_expected_categories` policies) and `documents.sql`
-- (its select policy) both reference `properties.owner_user_id` via a cross-table subquery —
-- real dependencies that only surface by actually running the migration, not by reading the
-- schema. Those two tables are themselves still owner_user_id-scoped and haven't been cut over
-- yet (same deferred scope as documents/bills/payments/etc. below), so their policies can't be
-- fixed as a side effect of this migration without expanding this change far past "properties."
--
-- Corrected approach: `org_id` becomes the required, RLS-enforced ownership column (the actual
-- goal of this migration); `owner_user_id` is relaxed to nullable and left physically in place,
-- inert, until the tables that still depend on it are cut over too — at which point a follow-up
-- migration drops it for real. This was previously reported as fully dropped; that was inaccurate
-- and is corrected here rather than left standing — see WORKLOG.md 2026-07-30 and
-- TECHNICAL_DEBT_REGISTER.md TD-01.
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

-- Relaxed, not dropped — see the revision note above. `owner_user_id` stays populated on
-- existing rows (harmless) and becomes optional for new ones; application code (packages/types,
-- propertyRepository.ts) already stopped reading/writing it as of this same change, so this is
-- purely a physical-schema accommodation for the still-dependent tables, not something the app
-- relies on going forward.
alter table public.properties alter column owner_user_id drop not null;

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

-- org_id already has an index from the expand-step migration (20260101000022), and (org_id,
-- status) from that same migration covers the list-view query shape — no new index needed here.
