-- Tests for 20260101000117_commercial_setup_rls_enforcement.sql (follow-up gate task, Objective
-- A): a genuinely new, self-service, not-yet-set-up organization must not be able to bypass
-- /organization/billing/setup by calling the operational APIs/RLS directly. Covers the exact list
-- from the task: properties, owners, staff invites, accounting -- plus proof that a
-- grandfathered-shaped org (commercial_setup_required = false, matching every pre-existing
-- production org and every pre-existing pgTAP fixture) is completely unaffected, and that rights
-- return automatically once activate_trial_after_payment() runs.

begin;
select plan(18);

insert into auth.users (id, email) values
  ('cc000000-0000-0000-0000-000000000001', 'cs-principal-new@test.propertyvault.example'),
  ('cc000000-0000-0000-0000-000000000002', 'cs-principal-grandfathered@test.propertyvault.example');

-- === Org A: created via create_organization() -- the real, sole production self-service path --
--     commercial_setup_required is true, setup not yet completed. ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'cc000000-0000-0000-0000-000000000001';
select isnt((select public.create_organization('New Unpaid Org', 'agency')), null, 'org A created');

select ok(
  (select commercial_setup_required and commercial_setup_completed_at is null
     from public.organizations where legal_name = 'New Unpaid Org'),
  'org A: commercial_setup_required is true, commercial_setup_completed_at is null'
);

-- === Org B: a direct insert, matching every pre-existing/grandfathered production org and every
--     pre-existing pgTAP fixture -- commercial_setup_required defaults to false. ===
reset role;
insert into public.organizations (legal_name, org_type)
values ('Grandfathered-Shaped Org', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'cc000000-0000-0000-0000-000000000002'::uuid, 'principal', 'active', now()
from public.organizations where legal_name = 'Grandfathered-Shaped Org';

select ok(
  (select not commercial_setup_required from public.organizations where legal_name = 'Grandfathered-Shaped Org'),
  'org B: commercial_setup_required defaults to false for a directly-inserted (grandfathered-shaped) org'
);

-- === Org A (unpaid, self-service): every write-sensitive operational entry point is blocked ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'cc000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select public.create_property(
       (select id from public.organizations where legal_name = 'New Unpaid Org'),
       'Blocked Property', '1 Test Street', 'Cape Town', 'ZA', 'apartment'
     ) $$,
  'P0001',
  'commercial_setup_required: complete payment-method setup before adding properties.',
  'org A: create_property() is blocked for a not-yet-set-up self-service org'
);

select throws_ok(
  $$ insert into public.owners (org_id, name)
     values ((select id from public.organizations where legal_name = 'New Unpaid Org'), 'Blocked Owner') $$,
  '42501',
  null,
  'org A: direct owners insert is blocked by RLS'
);

select throws_ok(
  $$ insert into public.organization_invites (org_id, email, role, invited_by)
     values (
       (select id from public.organizations where legal_name = 'New Unpaid Org'),
       'blocked-invite@test.propertyvault.example', 'agent',
       'cc000000-0000-0000-0000-000000000001'
     ) $$,
  '42501',
  null,
  'org A: direct staff-invite insert is blocked by RLS'
);

select throws_ok(
  $$ insert into public.journal_entries (org_id, entry_date, source_type, created_by)
     values (
       (select id from public.organizations where legal_name = 'New Unpaid Org'),
       current_date, 'adjustment', 'cc000000-0000-0000-0000-000000000001'
     ) $$,
  '42501',
  null,
  'org A: direct accounting (journal_entries) insert is blocked by RLS'
);

-- Read access is completely untouched -- the principal can still see their own org/plans to
-- render the billing/setup page itself.
select ok(
  (select count(*) from public.organizations where legal_name = 'New Unpaid Org') = 1,
  'org A: read access to the organizations row itself still works (billing/setup page can render)'
);
select ok(
  (select count(*) from public.plans where is_active) > 0,
  'org A: read access to plans still works (billing/setup page can render pricing)'
);

-- === Org B (grandfathered-shaped): the exact same four operations succeed -- zero regression ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'cc000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.create_property(
       (select id from public.organizations where legal_name = 'Grandfathered-Shaped Org'),
       'Allowed Property', '1 Test Street', 'Cape Town', 'ZA', 'apartment'
     ) $$,
  'org B: create_property() succeeds for a grandfathered-shaped org'
);

select lives_ok(
  $$ insert into public.owners (org_id, name)
     values ((select id from public.organizations where legal_name = 'Grandfathered-Shaped Org'), 'Allowed Owner') $$,
  'org B: direct owners insert succeeds for a grandfathered-shaped org'
);

select lives_ok(
  $$ insert into public.organization_invites (org_id, email, role, invited_by)
     values (
       (select id from public.organizations where legal_name = 'Grandfathered-Shaped Org'),
       'allowed-invite@test.propertyvault.example', 'agent',
       'cc000000-0000-0000-0000-000000000002'
     ) $$,
  'org B: direct staff-invite insert succeeds for a grandfathered-shaped org'
);

select lives_ok(
  $$ insert into public.journal_entries (org_id, entry_date, source_type, created_by)
     values (
       (select id from public.organizations where legal_name = 'Grandfathered-Shaped Org'),
       current_date, 'adjustment', 'cc000000-0000-0000-0000-000000000002'
     ) $$,
  'org B: direct accounting (journal_entries) insert succeeds for a grandfathered-shaped org'
);

-- === After verified activation, org A's rights return automatically ===
reset role;
select public.activate_trial_after_payment(
  (select id from public.organizations where legal_name = 'New Unpaid Org')
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'cc000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.create_property(
       (select id from public.organizations where legal_name = 'New Unpaid Org'),
       'Now Allowed Property', '1 Test Street', 'Cape Town', 'ZA', 'apartment'
     ) $$,
  'org A: create_property() succeeds after activate_trial_after_payment()'
);

select lives_ok(
  $$ insert into public.owners (org_id, name)
     values ((select id from public.organizations where legal_name = 'New Unpaid Org'), 'Now Allowed Owner') $$,
  'org A: owners insert succeeds after activate_trial_after_payment()'
);

select lives_ok(
  $$ insert into public.organization_invites (org_id, email, role, invited_by)
     values (
       (select id from public.organizations where legal_name = 'New Unpaid Org'),
       'now-allowed-invite@test.propertyvault.example', 'agent',
       'cc000000-0000-0000-0000-000000000001'
     ) $$,
  'org A: staff-invite insert succeeds after activate_trial_after_payment()'
);

select lives_ok(
  $$ insert into public.journal_entries (org_id, entry_date, source_type, created_by)
     values (
       (select id from public.organizations where legal_name = 'New Unpaid Org'),
       current_date, 'adjustment', 'cc000000-0000-0000-0000-000000000001'
     ) $$,
  'org A: accounting insert succeeds after activate_trial_after_payment()'
);

-- === Platform Admin / support-session access is unaffected -- it was never write-capable above
--     viewer to begin with (has_org_role's support_access_sessions OR-branch only ever fires for
--     min_role='viewer'), so it can't have been changed by conditions added only to non-viewer
--     WITH CHECK clauses. Proven directly: a support session still resolves viewer-level
--     has_org_role() true for org A, completely independent of commercial_setup_required. ===
reset role;
insert into auth.users (id, email) values
  ('cc000000-0000-0000-0000-000000000099', 'cs-admin@test.propertyvault.example')
on conflict do nothing;
insert into public.platform_admin_users (id, auth_user_id, role, display_name)
values ('cc000000-0000-0000-0000-000000000099', 'cc000000-0000-0000-0000-000000000099', 'support_admin', 'CS Test Admin')
on conflict do nothing;
insert into public.support_access_sessions (platform_admin_id, org_id, reason)
values (
  'cc000000-0000-0000-0000-000000000099',
  (select id from public.organizations where legal_name = 'Grandfathered-Shaped Org'),
  'pgTAP regression check'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'cc000000-0000-0000-0000-000000000099';
select ok(
  (select public.has_org_role(
    (select id from public.organizations where legal_name = 'Grandfathered-Shaped Org'), 'viewer'
  )),
  'a platform admin support session still resolves viewer access, unaffected by this migration'
);

select * from finish();
rollback;
