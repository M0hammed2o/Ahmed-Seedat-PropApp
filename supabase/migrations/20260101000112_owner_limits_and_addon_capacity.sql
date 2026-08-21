-- Commercial plan restructure, Part 2 (WORKLOG.md this date): external-owner capacity limits
-- (new -- no owner-count enforcement existed anywhere before this) and persisted, purchased add-on
-- capacity for both properties and owners (RELEASE A's own property/staff limit functions never
-- had an add-on layer at all; "extra property/owner capacity" was not a real, storable concept
-- until this migration).
--
-- "External owner" = a distinct row in `owners` (already the correct unit -- property-to-owner
-- SHARES live in the separate `property_owners` join table, so counting `owners` rows already
-- means "one owner linked to 5 properties counts as one owner", not five -- no new join-collapsing
-- logic needed, the schema already models this correctly).

alter table public.organization_subscriptions
  add column purchased_extra_properties integer not null default 0
    check (purchased_extra_properties >= 0),
  add column purchased_extra_owner_slots integer not null default 0
    check (purchased_extra_owner_slots >= 0);

comment on column public.organization_subscriptions.purchased_extra_properties is
  'Paid add-on capacity ON TOP OF the plan''s feature_limits.maxProperties (e.g. Professional''s
   included 15 + 3 purchased = 18 active-property allowance). Persisted, not a UI-only number --
   billed monthly at feature_limits.extraPropertyPrice per unit (lib/billing.ts).';

comment on column public.organization_subscriptions.purchased_extra_owner_slots is
  'Same shape as purchased_extra_properties, for feature_limits.includedOwners /
   feature_limits.extraOwnerPrice.';

-- ============================================================
-- maxProperties / available_property_slots -- extended (not replaced in meaning) to add
-- purchased_extra_properties on top of the plan's base allowance. A missing subscription row
-- still resolves to unlimited (unchanged default -- see this migration's own grandfathering note
-- below and 20260101000102's original comment for why that default exists).
-- ============================================================
create or replace function public.org_property_limit(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when (p.feature_limits ->> 'maxProperties') is null then null
      else (p.feature_limits ->> 'maxProperties')::integer + os.purchased_extra_properties
    end
  from public.organization_subscriptions os
  join public.plans p on p.id = os.plan_id
  where os.org_id = p_org_id
  order by os.current_period_start desc
  limit 1;
$$;

comment on function public.org_property_limit(uuid) is
  'The org''s current plan''s feature_limits.maxProperties PLUS any purchased_extra_properties
   (null base = unlimited, add-ons irrelevant in that case). Returns null (unlimited) for an org
   with no organization_subscriptions row at all -- unchanged convention from 20260101000102.';

-- ============================================================
-- Owner capacity -- new. Mirrors org_property_limit()/available_property_slots() exactly, plus
-- feature_limits.includedOwners (Starter has no owner-portal concept at all, so its includedOwners
-- is 0 and ownerPortalEnabled is false -- both must independently be true/nonzero for an org to
-- actually add an external owner; see the RLS policy below).
-- ============================================================
create or replace function public.org_active_owner_count(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.owners
  where owners.org_id = p_org_id
    and owners.status = 'active';
$$;

comment on function public.org_active_owner_count(uuid) is
  'Distinct external-owner IDENTITIES for this org -- owners is already one row per person/entity
   (property-to-owner SHARES live in the separate property_owners join table), so this is already
   "one owner linked to 5 properties counts once", never a property_owners row count.';

create or replace function public.org_owner_limit(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when (p.feature_limits ->> 'includedOwners') is null then null
      else (p.feature_limits ->> 'includedOwners')::integer + os.purchased_extra_owner_slots
    end
  from public.organization_subscriptions os
  join public.plans p on p.id = os.plan_id
  where os.org_id = p_org_id
  order by os.current_period_start desc
  limit 1;
$$;

comment on function public.org_owner_limit(uuid) is
  'The org''s current plan''s feature_limits.includedOwners PLUS any purchased_extra_owner_slots
   (null = unlimited; missing key on a real plan row resolves to 0 via coalesce below, not
   unlimited -- Starter deliberately has no owner allowance at all, unlike maxProperties/maxStaff
   which use null-is-unlimited). Returns null (unlimited) for an org with no
   organization_subscriptions row at all, matching every other limit function''s "no subscription
   yet" convention.';

create or replace function public.available_owner_slots(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when public.org_owner_limit(p_org_id) is null then null
      else public.org_owner_limit(p_org_id) - public.org_active_owner_count(p_org_id)
    end;
$$;

comment on function public.available_owner_slots(uuid) is
  'null = unlimited. Callers treat "> 0 or null" as "may add another external owner."';

-- ============================================================
-- Enforcement: owners INSERT only (never UPDATE/DELETE -- an org already over its owner
-- allowance, e.g. after a downgrade, must still be able to edit or archive an EXISTING owner
-- record; only creating a NEW one is capacity-gated). The prior single owners_write_agent_plus
-- (FOR ALL, 20260101000022) is split into precise per-command policies so this capacity check
-- cannot be bypassed by a second, more permissive policy matching the same INSERT.
-- ============================================================
drop policy if exists "owners_write_agent_plus" on public.owners;

create policy "owners_insert_agent_plus_capacity"
  on public.owners for insert
  with check (
    public.has_org_role(org_id, 'agent')
    and (public.available_owner_slots(org_id) is null or public.available_owner_slots(org_id) > 0)
  );

create policy "owners_update_agent_plus"
  on public.owners for update
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

create policy "owners_delete_agent_plus"
  on public.owners for delete
  using (public.has_org_role(org_id, 'agent'));

revoke all on function public.org_active_owner_count(uuid) from public;
revoke all on function public.org_owner_limit(uuid) from public;
revoke all on function public.available_owner_slots(uuid) from public;
grant execute on function public.org_active_owner_count(uuid) to authenticated, service_role;
grant execute on function public.org_owner_limit(uuid) to authenticated, service_role;
grant execute on function public.available_owner_slots(uuid) to authenticated, service_role;
