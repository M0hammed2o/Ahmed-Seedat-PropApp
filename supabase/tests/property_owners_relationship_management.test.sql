-- Property owners relationship-management pass (V1 launch-completion, this date). Covers the
-- DB-layer guarantees the new DELETE route (apps/admin/app/api/v1/properties/[id]/owners/
-- [ownerId]/route.ts) and inline percentage-edit UI depend on:
--   1. DELETE removes only the property_owners relationship row, never the owners identity row.
--   2. DELETE (and every other property_owners write) requires org agent+ role AND property-level
--      owner/administrator access -- an outsider with no org membership, and a same-org member
--      whose role doesn't clear the agent+ floor, are both silently blocked by RLS.
--   3. A percentage change via the same upsert-on-conflict shape the POST route uses (re-supplying
--      an existing owner_id with a new ownership_pct) succeeds.
--   4. Ownership percentages that don't sum to 100 are NOT blocked at the DB layer -- confirms the
--      migration 20260101000022 comment ("validated at the application layer, not a DB
--      constraint") still holds; this stays a UI-layer warning only (PropertyOwnersPanel.tsx).
--   5. property_ownership_history (migration 20260101000062) keeps recording DELETE/UPDATE on
--      property_owners -- the new route writes through the normal table, never bypasses the
--      trigger.
-- Migration 20260101000144 added no new RLS policy (verified: property_owners already carries a
-- `for all` write policy from 20260101000084 covering DELETE) -- this file is what proves that
-- verification true against a real database rather than just a migration-history read.

begin;
select plan(14);

insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'porm-principal@test.propertyvault.example'),
  ('f5000000-0000-0000-0000-000000000002', 'porm-outsider@test.propertyvault.example'),
  ('f5000000-0000-0000-0000-000000000003', 'porm-viewer@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Property Owners Relationship Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Property Owners Relationship Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';
select set_config('pgtap.porm.org_id', (select id::text from public.organizations where legal_name = 'Property Owners Relationship Test Org'), false);

select set_config(
  'pgtap.porm.property_id',
  (select public.create_property(current_setting('pgtap.porm.org_id')::uuid, 'Relationship Mgmt Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type)::text),
  false
);

-- A same-org member with 'viewer' role -- below the agent+ floor every property_owners write
-- requires, but property_access_mode defaults to 'all' so they still automatically hold
-- 'administrator' property_access on this property (the org-role check is the one expected to
-- block them, isolating exactly what's under test).
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values (current_setting('pgtap.porm.org_id')::uuid, 'f5000000-0000-0000-0000-000000000003', 'viewer', 'active', now());
set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';

insert into public.owners (org_id, name, email) values (current_setting('pgtap.porm.org_id')::uuid, 'Owner A', null);
select set_config('pgtap.porm.owner_a_id', (select id::text from public.owners where name = 'Owner A' and org_id = current_setting('pgtap.porm.org_id')::uuid), false);
insert into public.owners (org_id, name, email) values (current_setting('pgtap.porm.org_id')::uuid, 'Owner B', null);
select set_config('pgtap.porm.owner_b_id', (select id::text from public.owners where name = 'Owner B' and org_id = current_setting('pgtap.porm.org_id')::uuid), false);

-- 1: percentages that don't sum to 100 (60 + 50 = 110) are accepted -- no DB constraint blocks it.
insert into public.property_owners (property_id, owner_id, ownership_pct)
values (current_setting('pgtap.porm.property_id')::uuid, current_setting('pgtap.porm.owner_a_id')::uuid, 60);
insert into public.property_owners (property_id, owner_id, ownership_pct)
values (current_setting('pgtap.porm.property_id')::uuid, current_setting('pgtap.porm.owner_b_id')::uuid, 50);
select is(
  (select count(*)::int from public.property_owners where property_id = current_setting('pgtap.porm.property_id')::uuid),
  2,
  '1: two ownership rows created even though percentages sum to 110, not 100 -- sum is a UI-layer warning only'
);

-- 2/3: an outsider with no organization_members row at all cannot delete the relationship -- RLS
-- silently filters the DELETE (affects zero rows), the relationship survives untouched.
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000002';
delete from public.property_owners
where property_id = current_setting('pgtap.porm.property_id')::uuid
  and owner_id = current_setting('pgtap.porm.owner_a_id')::uuid;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.property_owners where property_id = current_setting('pgtap.porm.property_id')::uuid and owner_id = current_setting('pgtap.porm.owner_a_id')::uuid),
  1,
  '2: an outsider with no org membership cannot delete the relationship -- it still exists'
);
select is(
  (select count(*)::int from public.owners where id = current_setting('pgtap.porm.owner_a_id')::uuid),
  1,
  '3: (and the owner identity was of course untouched -- it was never at risk)'
);

-- 4: a same-org member whose role doesn't clear the agent+ floor (viewer) also cannot delete it,
-- even though property_access_mode='all' already granted them 'administrator' property_access.
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000003';
delete from public.property_owners
where property_id = current_setting('pgtap.porm.property_id')::uuid
  and owner_id = current_setting('pgtap.porm.owner_a_id')::uuid;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.property_owners where property_id = current_setting('pgtap.porm.property_id')::uuid and owner_id = current_setting('pgtap.porm.owner_a_id')::uuid),
  1,
  '4: a same-org viewer-role member (below the agent+ floor) also cannot delete the relationship'
);

-- 5/6: the org's own agent+ (here, the Principal, who automatically holds 'administrator'
-- property_access on every property via property_access_mode='all') CAN remove the relationship --
-- and only the relationship row, never the owner identity.
delete from public.property_owners
where property_id = current_setting('pgtap.porm.property_id')::uuid
  and owner_id = current_setting('pgtap.porm.owner_a_id')::uuid;
select is(
  (select count(*)::int from public.property_owners where property_id = current_setting('pgtap.porm.property_id')::uuid and owner_id = current_setting('pgtap.porm.owner_a_id')::uuid),
  0,
  '5: an authorized agent+ user (with property owner/administrator access) removes the relationship'
);
select is(
  (select count(*)::int from public.owners where id = current_setting('pgtap.porm.owner_a_id')::uuid),
  1,
  '6: Owner A''s identity row still exists -- DELETE never touches public.owners'
);
select is(
  (select count(*)::int from public.property_owners where property_id = current_setting('pgtap.porm.property_id')::uuid),
  1,
  '7: exactly one relationship remains (Owner B) -- Owner A''s removal did not cascade further'
);

-- 8: property_ownership_history keeps recording -- the DELETE closed Owner A's open history row,
-- with no new row opened (mirrors property_ownership_history.test.sql's own delete assertion).
select is(
  (select count(*)::int from public.property_ownership_history where property_id = current_setting('pgtap.porm.property_id')::uuid and owner_id = current_setting('pgtap.porm.owner_a_id')::uuid and effective_to is null),
  0,
  '8: the ownership-history trigger closed Owner A''s open history row on delete -- not bypassed'
);

-- 9/10: percentage update via the same upsert-on-conflict shape the POST route uses (re-supplying
-- Owner B's existing owner_id with a new ownership_pct) succeeds and is exactly the update path.
insert into public.property_owners (property_id, owner_id, ownership_pct)
values (current_setting('pgtap.porm.property_id')::uuid, current_setting('pgtap.porm.owner_b_id')::uuid, 75)
on conflict (property_id, owner_id) do update set ownership_pct = excluded.ownership_pct;
select is(
  (select ownership_pct from public.property_owners where property_id = current_setting('pgtap.porm.property_id')::uuid and owner_id = current_setting('pgtap.porm.owner_b_id')::uuid),
  75.00::numeric,
  '9: re-posting an existing owner_id with a new ownership_pct updates it in place (no duplicate row)'
);
select is(
  (select count(*)::int from public.property_owners where property_id = current_setting('pgtap.porm.property_id')::uuid),
  1,
  '10: the percentage update did not create a second row for Owner B'
);

-- 11: an unauthorized user (outsider) also cannot perform that same percentage-update upsert --
-- confirms UPDATE, not just DELETE, is covered by the same `for all` policy.
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000002';
update public.property_owners
set ownership_pct = 99
where property_id = current_setting('pgtap.porm.property_id')::uuid
  and owner_id = current_setting('pgtap.porm.owner_b_id')::uuid;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';
select is(
  (select ownership_pct from public.property_owners where property_id = current_setting('pgtap.porm.property_id')::uuid and owner_id = current_setting('pgtap.porm.owner_b_id')::uuid),
  75.00::numeric,
  '11: an outsider''s attempted percentage update is silently blocked by RLS -- value unchanged'
);

-- 12: the history trigger also recorded the successful percentage change (closes 60->75... here
-- effectively the row opened at 50, closed, reopened at 75 -- two total history rows for Owner B).
select is(
  (select count(*)::int from public.property_ownership_history where property_id = current_setting('pgtap.porm.property_id')::uuid and owner_id = current_setting('pgtap.porm.owner_b_id')::uuid),
  2,
  '12: the ownership-history trigger recorded the percentage change for Owner B (insert + update)'
);

-- 13: final sum-not-100 regression -- Owner B alone at 75% is nowhere near 100, still not blocked.
select is(
  (select sum(ownership_pct)::int from public.property_owners where property_id = current_setting('pgtap.porm.property_id')::uuid),
  75,
  '13: the property''s ownership total (75%) is left exactly as-is -- still a UI warning, never enforced'
);

select * from finish();
rollback;
