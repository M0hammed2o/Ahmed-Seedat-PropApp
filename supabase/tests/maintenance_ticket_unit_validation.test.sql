-- Security + maintenance workflow pass (WORKLOG.md this date). maintenance_tickets.unit_id
-- already existed (20260101000034) but nothing enforced that a supplied unit actually belonged to
-- the ticket's own property_id -- 20260101000087 closes that with a trigger. Covers the task
-- brief's explicit verification items 3-6: a unit from another property can never be attached
-- (on insert or update), null stays valid (common area / property-wide, no backfill required),
-- and a legitimate same-property unit round-trips correctly.

begin;
select plan(7);

insert into auth.users (id, email) values
  ('c3000000-0000-0000-0000-000000000001', 'mtuv-principal@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'c3000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Maintenance Unit Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Maintenance Unit Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'c3000000-0000-0000-0000-000000000001';
select set_config('pgtap.mtuv.org_id', (select id::text from public.organizations where legal_name = 'Maintenance Unit Test Org'), false);

select set_config(
  'pgtap.mtuv.property_a_id',
  (select public.create_property(current_setting('pgtap.mtuv.org_id')::uuid, 'Property A', '1 A St', 'Cape Town', 'ZA', 'apartment'::public.property_type)::text),
  false
);
select set_config(
  'pgtap.mtuv.property_b_id',
  (select public.create_property(current_setting('pgtap.mtuv.org_id')::uuid, 'Property B', '2 B St', 'Cape Town', 'ZA', 'apartment'::public.property_type)::text),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.mtuv.property_a_id')::uuid, current_setting('pgtap.mtuv.org_id')::uuid, '601', 'vacant');
select set_config('pgtap.mtuv.unit_601_id', (select id::text from public.units where unit_label = '601'), false);

insert into public.units (property_id, org_id, unit_label, status)
values (current_setting('pgtap.mtuv.property_b_id')::uuid, current_setting('pgtap.mtuv.org_id')::uuid, '901', 'vacant');
select set_config('pgtap.mtuv.unit_901_id', (select id::text from public.units where unit_label = '901'), false);

-- === 3: a unit from another property cannot be attached, on INSERT ===
select throws_ok(
  $$
    insert into public.maintenance_tickets (org_id, property_id, unit_id, submitted_by_user_id, summary)
    values (
      current_setting('pgtap.mtuv.org_id')::uuid,
      current_setting('pgtap.mtuv.property_a_id')::uuid,
      current_setting('pgtap.mtuv.unit_901_id')::uuid,
      'c3000000-0000-0000-0000-000000000001',
      'Cross-property unit attempt'
    )
  $$,
  'unit_id must belong to the maintenance ticket''s own property_id',
  '3: a Property B unit cannot be attached to a Property A ticket on insert'
);

-- === valid insert: a same-property unit is accepted ===
insert into public.maintenance_tickets (org_id, property_id, unit_id, submitted_by_user_id, summary)
values (
  current_setting('pgtap.mtuv.org_id')::uuid, current_setting('pgtap.mtuv.property_a_id')::uuid,
  current_setting('pgtap.mtuv.unit_601_id')::uuid, 'c3000000-0000-0000-0000-000000000001', 'Leaking Kitchen Tap'
);
select set_config('pgtap.mtuv.ticket_601_id', (select id::text from public.maintenance_tickets where summary = 'Leaking Kitchen Tap'), false);

-- === 5: creating a Unit 601 issue displays Unit 601 after save (the persisted value round-trips) ===
select is(
  (select unit_id from public.maintenance_tickets where id = current_setting('pgtap.mtuv.ticket_601_id')::uuid),
  current_setting('pgtap.mtuv.unit_601_id')::uuid,
  '5: a ticket created against Unit 601 persists that exact unit_id'
);

-- === valid insert: null unit_id (common area) is accepted with no unit at all ===
insert into public.maintenance_tickets (org_id, property_id, unit_id, submitted_by_user_id, summary)
values (
  current_setting('pgtap.mtuv.org_id')::uuid, current_setting('pgtap.mtuv.property_a_id')::uuid,
  null, 'c3000000-0000-0000-0000-000000000001', 'Common Area Issue'
);

-- === 6: creating a Common Area issue displays Common Area after save (null, not a placeholder unit) ===
select is(
  (select unit_id from public.maintenance_tickets where summary = 'Common Area Issue'),
  null,
  '6: a ticket created with no unit selected persists unit_id = null (common area / property-wide)'
);

-- === 4: existing (pre-this-pass) tickets with a null unit remain valid and untouched by the trigger ===
select lives_ok(
  $$ update public.maintenance_tickets set description = 'no-op touch' where summary = 'Common Area Issue' $$,
  '4: updating an unrelated column on a null-unit ticket does not trip the unit/property validation'
);

-- === 3 (update path): a unit from another property cannot be attached via UPDATE either ===
select throws_ok(
  $$ update public.maintenance_tickets set unit_id = current_setting('pgtap.mtuv.unit_901_id')::uuid where id = current_setting('pgtap.mtuv.ticket_601_id')::uuid $$,
  'unit_id must belong to the maintenance ticket''s own property_id',
  '3: a Property B unit cannot be attached to a Property A ticket on update either'
);

-- === editing the location: switching a ticket from a unit back to common area is a legal, tracked change ===
update public.maintenance_tickets set unit_id = null where id = current_setting('pgtap.mtuv.ticket_601_id')::uuid;
select is(
  (select unit_id from public.maintenance_tickets where id = current_setting('pgtap.mtuv.ticket_601_id')::uuid),
  null,
  'editing a ticket''s location from Unit 601 back to common area is accepted and persists'
);

select * from finish();
rollback;
