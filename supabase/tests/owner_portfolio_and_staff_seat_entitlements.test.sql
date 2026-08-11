-- Tests for 20260101000094_owner_portfolio_and_staff_seat_entitlements.sql: may_create_portfolio()
-- (linked-owner-only accounts cannot spin up a free portfolio org) and available_staff_seats()
-- (a plan's feature_limits.maxStaff is now actually enforced, at the RLS layer, on
-- organization_invites INSERT).

begin;
select plan(17);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'entitlement-fresh-signup@test.propertyvault.example'),
  ('e1000000-0000-0000-0000-000000000002', 'entitlement-linked-owner-only@test.propertyvault.example'),
  ('e1000000-0000-0000-0000-000000000003', 'entitlement-owner-and-staff-elsewhere@test.propertyvault.example'),
  ('e1000000-0000-0000-0000-000000000004', 'entitlement-seat-org-principal@test.propertyvault.example'),
  ('e1000000-0000-0000-0000-000000000005', 'entitlement-seat-org-existing-staff@test.propertyvault.example');

-- Mohammed's org -- holds the shared property and the `owners` rows for the two linked-owner
-- scenarios. No organization_subscriptions row -- unlimited seats, matching every existing test
-- fixture/production org today (nothing changes for an org that hasn't set up seat-limited
-- billing).
insert into public.organizations (id, legal_name, org_type)
values ('e2000000-0000-0000-0000-000000000001', 'Entitlement Test Org A (Mohammed)', 'agency');

insert into public.owners (id, org_id, user_id, name, status)
values
  ('e3000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000002', 'Linked Owner Only', 'active'),
  ('e3000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000003', 'Owner And Staff Elsewhere', 'active');

-- A third, unrelated org where user 003 is already staff -- proves "already belongs to any org"
-- unlocks portfolio creation even when that org isn't the one holding their owners row.
insert into public.organizations (id, legal_name, org_type)
values ('e2000000-0000-0000-0000-000000000003', 'Entitlement Test Org C (unrelated)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'agent', 'active', now());

set local role authenticated;

-- === may_create_portfolio() / create_organization() ===

set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';
select ok(
  (select public.may_create_portfolio()),
  'a fresh signup with no owners row and no org membership may_create_portfolio()'
);
select isnt(
  (select public.create_organization('Fresh Signup Portfolio')),
  null,
  'a fresh signup can actually create_organization() -- unaffected by this migration'
);

set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000002';
select ok(
  not (select public.may_create_portfolio()),
  'a linked-owner-only account (owners row, zero org memberships) may NOT create_portfolio'
);
select throws_ok(
  $$ select public.create_organization('Junaids Unpaid Portfolio Attempt') $$,
  'P0001',
  'owner_subscription_required: an active Proplyst owner subscription is required to create your own portfolio.',
  'a linked-owner-only account cannot call create_organization() directly (RPC-level, not just the API route)'
);

-- Grant the explicit override (the super-admin lever until real billing exists) and prove it
-- actually unlocks portfolio creation.
reset role;
insert into public.owner_portfolio_grants (user_id, granted_by, note)
values ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'pgTAP grant test');
set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000002';

select ok(
  (select public.may_create_portfolio()),
  'after an owner_portfolio_grants row is inserted, the same linked owner MAY create_portfolio'
);
select isnt(
  (select public.create_organization('Junaids Paid Portfolio')),
  null,
  'the granted linked owner can now actually create_organization()'
);

set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000003';
select ok(
  (select public.may_create_portfolio()),
  'a linked owner who ALREADY has an active membership in a different org may_create_portfolio (unaffected)'
);
select isnt(
  (select public.create_organization('Owner Who Is Also Staff Elsewhere Portfolio')),
  null,
  'that account can actually create_organization() too -- pre-existing org membership anywhere is sufficient'
);

-- === Staff seats: org with no organization_subscriptions row at all (unlimited, unchanged) ===

reset role;
select is(
  (select public.available_staff_seats('e2000000-0000-0000-0000-000000000001')),
  null,
  'available_staff_seats() is null (unlimited) for an org with no organization_subscriptions row'
);

-- === Staff seats: seat-limited org (starter plan, maxStaff = 1) ===

insert into public.organizations (id, legal_name, org_type)
values ('e2000000-0000-0000-0000-000000000004', 'Entitlement Test Org D (seat-limited)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('e2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'e2000000-0000-0000-0000-000000000004',
  (select id from public.plans where code = 'starter'),
  'monthly', current_date, current_date + interval '1 month', 'active'
);

select is(
  (select public.org_staff_seat_limit('e2000000-0000-0000-0000-000000000004')),
  1,
  'org_staff_seat_limit() reads the starter plan''s feature_limits.maxStaff (1)'
);
select is(
  (select public.org_active_billable_staff_count('e2000000-0000-0000-0000-000000000004')),
  0::integer,
  'org_active_billable_staff_count() is 0 before any staff are added (the principal does not count)'
);
select is(
  (select public.available_staff_seats('e2000000-0000-0000-0000-000000000004')),
  1,
  'available_staff_seats() is 1 (1 limit - 0 billable staff)'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000004';
select lives_ok(
  $$ insert into public.organization_invites (org_id, email, role, invited_by)
     values ('e2000000-0000-0000-0000-000000000004', 'first-seat@test.propertyvault.example', 'agent',
             'e1000000-0000-0000-0000-000000000004') $$,
  'the org principal CAN create an invite while a seat is available'
);

reset role;
-- Simulate that invite being accepted (org_active_billable_staff_count reads organization_members,
-- not organization_invites -- inserting the member row directly is the realistic post-accept state).
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('e2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000005', 'agent', 'active', now());

select is(
  (select public.available_staff_seats('e2000000-0000-0000-0000-000000000004')),
  0,
  'available_staff_seats() drops to 0 once the one paid seat is occupied'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000004';
select throws_ok(
  $$ insert into public.organization_invites (org_id, email, role, invited_by)
     values ('e2000000-0000-0000-0000-000000000004', 'second-seat@test.propertyvault.example', 'agent',
             'e1000000-0000-0000-0000-000000000004') $$,
  '42501',
  null,
  'a manager+ CANNOT insert a second organization_invites row once the org''s one paid seat is full (RLS-level, not just the API route)'
);

-- Removing the staff member frees the seat again (STAFF SEAT OWNERSHIP: seat availability is a
-- live count, not a stored, manually-decremented value).
reset role;
update public.organization_members
  set status = 'revoked'
  where org_id = 'e2000000-0000-0000-0000-000000000004' and user_id = 'e1000000-0000-0000-0000-000000000005';

select is(
  (select public.available_staff_seats('e2000000-0000-0000-0000-000000000004')),
  1,
  'available_staff_seats() returns to 1 once the staff member''s membership is revoked'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000004';
select lives_ok(
  $$ insert into public.organization_invites (org_id, email, role, invited_by)
     values ('e2000000-0000-0000-0000-000000000004', 'third-seat@test.propertyvault.example', 'agent',
             'e1000000-0000-0000-0000-000000000004') $$,
  'a freed seat can be re-used for a new invite'
);

select * from finish();
rollback;
