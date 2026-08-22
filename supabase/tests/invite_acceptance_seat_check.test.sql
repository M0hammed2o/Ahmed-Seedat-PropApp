-- Tests for 20260101000123_invite_acceptance_seat_check.sql: accept_organization_invite() now
-- re-validates staff-seat capacity at the moment of ACCEPTANCE, not just at invite-creation time
-- (owner_portfolio_and_staff_seat_entitlements.test.sql already covers the creation-time RLS
-- gate on organization_invites INSERT -- this file covers the separate, previously-missing
-- acceptance-time gate inside the RPC itself). True concurrent-acceptance racing (two real
-- simultaneous connections) can't be exercised inside a single pgTAP transaction -- that case is
-- covered separately by a real-local-Supabase vitest integration test
-- (lib/__tests__/inviteAcceptance.seatCheck.test.ts) using two genuinely parallel client calls.

begin;
select plan(10);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'seat-check-principal@test.propertyvault.example'),
  ('f1000000-0000-0000-0000-000000000002', 'seat-check-first-invitee@test.propertyvault.example'),
  ('f1000000-0000-0000-0000-000000000003', 'seat-check-second-invitee@test.propertyvault.example'),
  ('f1000000-0000-0000-0000-000000000004', 'seat-check-unlimited-invitee@test.propertyvault.example');

-- Seat-limited org: starter plan, maxStaff = 1 (same fixture shape as
-- owner_portfolio_and_staff_seat_entitlements.test.sql).
insert into public.organizations (id, legal_name, org_type)
values ('f2000000-0000-0000-0000-000000000001', 'Seat Check Test Org (limited)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'f2000000-0000-0000-0000-000000000001',
  (select id from public.plans where code = 'starter'),
  'monthly', current_date, current_date + interval '1 month', 'active'
);

select is(
  (select public.org_staff_seat_limit('f2000000-0000-0000-0000-000000000001')),
  1,
  'fixture sanity check: starter plan maxStaff is 1'
);

insert into public.organization_invites (id, org_id, email, role, invited_by, token, expires_at)
values (
  'f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001',
  'seat-check-first-invitee@test.propertyvault.example', 'agent',
  'f1000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', now() + interval '7 days'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.accept_organization_invite('f4000000-0000-0000-0000-000000000001'::uuid) $$,
  'first invitee accepts successfully while a seat is available'
);
select ok(
  (select accepted_at is not null from public.organization_invites where id = 'f3000000-0000-0000-0000-000000000001'),
  'the first invite is marked accepted'
);
select ok(
  exists(select 1 from public.organization_members
    where org_id = 'f2000000-0000-0000-0000-000000000001'
      and user_id = 'f1000000-0000-0000-0000-000000000002' and status = 'active'),
  'the first invitee''s membership row was created'
);
select is(
  (select public.org_active_billable_staff_count('f2000000-0000-0000-0000-000000000001')),
  1,
  'the org''s one seat is now occupied (principal still does not count)'
);

-- A second invite for the SAME now-full org -- acceptance must be rejected, atomically, with
-- nothing partially created.
reset role;
insert into public.organization_invites (id, org_id, email, role, invited_by, token, expires_at)
values (
  'f3000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001',
  'seat-check-second-invitee@test.propertyvault.example', 'agent',
  'f1000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000002', now() + interval '7 days'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.accept_organization_invite('f4000000-0000-0000-0000-000000000002'::uuid) $$,
  'P0001',
  'staff_seat_limit_reached: this organization has no remaining staff seats available.',
  'a second invitee is rejected once the org''s one seat is already occupied'
);

-- The rejected invitee has zero org memberships (their acceptance failed) -- under RLS
-- (organization_invites_select_same_org), they genuinely cannot SELECT this invite row at all,
-- so these verification reads need postgres/service-role-equivalent visibility, same as every
-- other "inspect the real resulting state" check elsewhere in this suite.
reset role;
select ok(
  (select accepted_at is null from public.organization_invites where id = 'f3000000-0000-0000-0000-000000000002'),
  'the rejected invite was NOT marked accepted -- safe to retry later'
);
select ok(
  not exists(select 1 from public.organization_members
    where org_id = 'f2000000-0000-0000-0000-000000000001'
      and user_id = 'f1000000-0000-0000-0000-000000000003'),
  'no membership row was created for the rejected acceptance -- no partial state'
);
select is(
  (select public.org_active_billable_staff_count('f2000000-0000-0000-0000-000000000001')),
  1,
  'the org''s billable staff count is still exactly 1 -- the rejected attempt never touched it'
);

-- Regression: an org with NO organization_subscriptions row at all remains unlimited, exactly
-- like every existing fixture/production org that hasn't set up seat-limited billing.
reset role;
insert into public.organizations (id, legal_name, org_type)
values ('f2000000-0000-0000-0000-000000000002', 'Seat Check Test Org (unlimited)', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_invites (id, org_id, email, role, invited_by, token, expires_at)
values (
  'f3000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000002',
  'seat-check-unlimited-invitee@test.propertyvault.example', 'agent',
  'f1000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000003', now() + interval '7 days'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000004';
select lives_ok(
  $$ select public.accept_organization_invite('f4000000-0000-0000-0000-000000000003'::uuid) $$,
  'acceptance is never blocked for an org with no seat-limited subscription at all (unaffected)'
);

select * from finish();
rollback;
