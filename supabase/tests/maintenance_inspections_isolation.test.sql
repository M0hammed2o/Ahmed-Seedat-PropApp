-- RLS isolation + invariant tests for maintenance_tickets/vendors/vendor_bills and
-- inspections/inspection_items (TASKS.md M13, migration 20260101000034). The inspection
-- completion CHECK constraint gets the most scrutiny here since TASKS.md M14's deposit-release
-- gate (ACCOUNTING.md §4) depends on it actually holding, not just being API-asserted.

begin;
select plan(13);

insert into auth.users (id, email) values
  ('91000000-0000-0000-0000-000000000001', 'maint-agent-a@test.propertyvault.example'),
  ('92000000-0000-0000-0000-000000000001', 'maint-agent-b@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('9a9a9a9a-1111-0000-0000-000000000001', 'Maint Test Org A', 'agency'),
  ('9b9b9b9b-1111-0000-0000-000000000001', 'Maint Test Org B', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('9a9a9a9a-1111-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  ('9b9b9b9b-1111-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'agent', 'active', now());

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values ('9c9c9c9c-1111-0000-0000-000000000001', '9a9a9a9a-1111-0000-0000-000000000001',
        'Maint Test Property', '1 Test Street', 'Cape Town', 'ZA', 'house');

insert into public.units (id, property_id, org_id, unit_label, status)
values ('9d9d9d9d-1111-0000-0000-000000000001', '9c9c9c9c-1111-0000-0000-000000000001',
        '9a9a9a9a-1111-0000-0000-000000000001', 'Unit 1', 'occupied');

set local role authenticated;
set local "request.jwt.claim.sub" = '91000000-0000-0000-0000-000000000001';

-- === maintenance_tickets: exactly-one-submitter constraint ===
select throws_ok(
  $$ insert into public.maintenance_tickets (org_id, property_id, summary, submitted_by_user_id, submitted_by_tenant_id)
     values ('9a9a9a9a-1111-0000-0000-000000000001', '9c9c9c9c-1111-0000-0000-000000000001',
             'Both submitters set', '91000000-0000-0000-0000-000000000001', gen_random_uuid()) $$,
  '23514',
  'new row for relation "maintenance_tickets" violates check constraint "maintenance_tickets_check"',
  'a maintenance ticket cannot have both submitted_by_user_id and submitted_by_tenant_id set'
);

select lives_ok(
  $$ insert into public.maintenance_tickets (org_id, property_id, summary, submitted_by_user_id)
     values ('9a9a9a9a-1111-0000-0000-000000000001', '9c9c9c9c-1111-0000-0000-000000000001',
             'Leaking tap', '91000000-0000-0000-0000-000000000001') $$,
  'a maintenance ticket with exactly one submitter (staff-submitted) inserts cleanly'
);

-- === Cross-org isolation: maintenance_tickets, vendors ===
set local "request.jwt.claim.sub" = '92000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.maintenance_tickets where org_id = '9a9a9a9a-1111-0000-0000-000000000001'),
  0::bigint,
  'Org B cannot see Org A''s maintenance ticket'
);
set local "request.jwt.claim.sub" = '91000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ insert into public.vendors (org_id, name, trade_category)
     values ('9a9a9a9a-1111-0000-0000-000000000001', 'Test Plumbing Co', 'plumbing') $$,
  'an org agent can create a vendor'
);

set local "request.jwt.claim.sub" = '92000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.vendors where org_id = '9a9a9a9a-1111-0000-0000-000000000001'),
  0::bigint,
  'Org B cannot see Org A''s vendor'
);
set local "request.jwt.claim.sub" = '91000000-0000-0000-0000-000000000001';

-- === inspections: the completion invariant (the highest-value coverage in this file) ===
insert into public.inspections (id, org_id, property_id, unit_id, inspection_type, scheduled_at, status)
values ('9e9e9e9e-1111-0000-0000-000000000001', '9a9a9a9a-1111-0000-0000-000000000001',
        '9c9c9c9c-1111-0000-0000-000000000001', '9d9d9d9d-1111-0000-0000-000000000001',
        'routine', now(), 'awaiting_signature');

select throws_ok(
  $$ update public.inspections set status = 'completed' where id = '9e9e9e9e-1111-0000-0000-000000000001' $$,
  '23514',
  'new row for relation "inspections" violates check constraint "inspections_check"',
  'cannot mark an inspection completed with neither signature nor refusal logged'
);

select lives_ok(
  $$ update public.inspections set landlord_signed_at = now()
     where id = '9e9e9e9e-1111-0000-0000-000000000001' $$,
  'landlord signature alone can be recorded'
);

select throws_ok(
  $$ update public.inspections set status = 'completed' where id = '9e9e9e9e-1111-0000-0000-000000000001' $$,
  '23514',
  'new row for relation "inspections" violates check constraint "inspections_check"',
  'cannot mark completed with only the landlord signed -- tenant signature or refusal is still required'
);

select throws_ok(
  $$ update public.inspections
     set tenant_signed_at = now(), tenant_refusal_reason = 'Tenant refused to sign'
     where id = '9e9e9e9e-1111-0000-0000-000000000001' $$,
  '23514',
  'new row for relation "inspections" violates check constraint "inspections_check1"',
  'cannot set both tenant_signed_at and tenant_refusal_reason simultaneously (mutually exclusive)'
);

select lives_ok(
  $$ update public.inspections set status = 'completed', tenant_signed_at = now()
     where id = '9e9e9e9e-1111-0000-0000-000000000001' $$,
  'landlord + tenant both signed -> completion succeeds'
);

-- Second inspection, to prove the refusal-logged path independently (not just tenant-signed).
insert into public.inspections (id, org_id, property_id, unit_id, inspection_type, scheduled_at, status, landlord_signed_at)
values ('9f9f9f9f-1111-0000-0000-000000000001', '9a9a9a9a-1111-0000-0000-000000000001',
        '9c9c9c9c-1111-0000-0000-000000000001', '9d9d9d9d-1111-0000-0000-000000000001',
        'move_out', now(), 'awaiting_signature', now());

select lives_ok(
  $$ update public.inspections
     set status = 'completed', tenant_refusal_reason = 'Tenant was not present at the scheduled time'
     where id = '9f9f9f9f-1111-0000-0000-000000000001' $$,
  'landlord signed + refusal reason logged (no tenant signature) -> completion also succeeds'
);

-- === inspection_items: scoped through the parent inspection ===
select lives_ok(
  $$ insert into public.inspection_items (inspection_id, room, item_description, condition_rating)
     values ('9e9e9e9e-1111-0000-0000-000000000001', 'Kitchen', 'Cabinet doors', 'good') $$,
  'an org agent can add an inspection item to their own org''s inspection'
);

set local "request.jwt.claim.sub" = '92000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.inspection_items where inspection_id = '9e9e9e9e-1111-0000-0000-000000000001'),
  0::bigint,
  'Org B cannot see Org A''s inspection item (scoped through the parent inspection''s org)'
);

select * from finish();
rollback;
