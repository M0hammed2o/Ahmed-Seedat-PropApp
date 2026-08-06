-- Tests for 20260101000062_property_ownership_history.sql: the trigger that turns
-- property_owners writes into an append-only, effective-dated ledger. Covers insert (opens a
-- row), a no-op update (must NOT fabricate a history boundary), a real percentage change (closes
-- the old row, opens a new one), and delete (closes the row, no new one).

begin;
select plan(10);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'ownership-history@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Ownership History Test Org', 'owner_managed')), null, 'org created');

insert into public.owners (org_id, name)
select id, 'Owner A' from public.organizations where legal_name = 'Ownership History Test Org';

-- properties no longer has a client-facing INSERT policy (20260101000064) -- create_property()
-- is the only sanctioned path as of that migration.
select public.create_property(
  (select id from public.organizations where legal_name = 'Ownership History Test Org'),
  'History Test Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
);

-- Insert: opens exactly one history row matching the current ownership_pct.
insert into public.property_owners (property_id, owner_id, ownership_pct)
select p.id, o.id, 60
from public.properties p, public.owners o
where p.nickname = 'History Test Property' and o.name = 'Owner A' and o.org_id = p.org_id;

select is(
  (select count(*)::int from public.property_ownership_history h
     join public.owners o on o.id = h.owner_id where o.name = 'Owner A'),
  1,
  'insert opens exactly one history row'
);

select is(
  (select h.ownership_pct from public.property_ownership_history h
     join public.owners o on o.id = h.owner_id where o.name = 'Owner A'),
  60.00::numeric,
  'history row records the inserted ownership_pct'
);

select ok(
  (select h.effective_to is null from public.property_ownership_history h
     join public.owners o on o.id = h.owner_id where o.name = 'Owner A'),
  'history row is open (effective_to is null)'
);

-- No-op update (touching an unrelated column, not ownership_pct): must not create a new row or
-- close the existing one.
update public.property_owners po
set created_at = po.created_at
from public.owners o
where po.owner_id = o.id and o.name = 'Owner A';

select is(
  (select count(*)::int from public.property_ownership_history h
     join public.owners o on o.id = h.owner_id where o.name = 'Owner A'),
  1,
  'no-op update does not fabricate a history boundary'
);

-- Real percentage change: closes the 60% row, opens a new 45% row.
update public.property_owners po
set ownership_pct = 45
from public.owners o
where po.owner_id = o.id and o.name = 'Owner A';

select is(
  (select count(*)::int from public.property_ownership_history h
     join public.owners o on o.id = h.owner_id where o.name = 'Owner A'),
  2,
  'percentage change closes the old row and opens a new one'
);

select is(
  (select count(*)::int from public.property_ownership_history h
     join public.owners o on o.id = h.owner_id where o.name = 'Owner A' and h.effective_to is null),
  1,
  'exactly one open row remains after a percentage change'
);

select is(
  (select h.ownership_pct from public.property_ownership_history h
     join public.owners o on o.id = h.owner_id where o.name = 'Owner A' and h.effective_to is null),
  45.00::numeric,
  'the open row reflects the new ownership_pct'
);

-- Delete: closes the open row, creates no new one.
delete from public.property_owners po
using public.owners o
where po.owner_id = o.id and o.name = 'Owner A';

select is(
  (select count(*)::int from public.property_ownership_history h
     join public.owners o on o.id = h.owner_id where o.name = 'Owner A' and h.effective_to is null),
  0,
  'delete closes the open row'
);

select is(
  (select count(*)::int from public.property_ownership_history h
     join public.owners o on o.id = h.owner_id where o.name = 'Owner A'),
  2,
  'delete does not insert a new row, only closes the existing open one'
);

select * from finish();
rollback;
