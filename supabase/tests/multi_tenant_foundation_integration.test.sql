-- End-to-end integration test for the M1-M5 multi-tenant foundation, written 2026-07-31 per
-- Mohammed's instruction to verify organization creation, invitations, memberships, role
-- resolution, org switching, property ownership, and org_id propagation "as one integrated
-- subsystem," not independently. rls_isolation.test.sql and multi_tenant_isolation.test.sql cover
-- cross-org isolation and role-write-denial in isolation; this file walks the actual user
-- journey end to end: create org -> invite -> accept -> role-gated write -> multi-org membership.
--
-- Two findings from this same verification pass are exercised here as regression coverage:
--   1. organization_invites had no INSERT policy at all until migration
--      20260101000026_organization_invites_insert_policy.sql (RLS-enabled + zero matching policy
--      = deny-by-default) -- the whole invite-creation half of this flow could never have worked
--      before that migration. Test 3 below is the regression guard.
--   2. organizations.status is NOT currently checked by any RLS policy anywhere (has_org_role()
--      only checks organization_members.status). This means an archived/suspended/cancelled org's
--      own active members retain full read/write access exactly as an active org's would. This is
--      NOT asserted here as a verified isolation guarantee (it isn't one) -- it is documented as
--      current, real, evidenced behavior, flagged as an open product decision in
--      RISK_REGISTER.md/TECHNICAL_DEBT_REGISTER.md rather than silently assumed either way.

begin;
select plan(14);

-- Fixtures: three users. user1 creates Org A and becomes its principal. user2 will be invited
-- into Org A. user3 exists only to prove multi-org membership (joins a second org, Org B).
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'foundation-user1@test.propertyvault.example'),
  ('a0000000-0000-0000-0000-000000000002', 'foundation-user2@test.propertyvault.example'),
  ('a0000000-0000-0000-0000-000000000003', 'foundation-user3@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'a0000000-0000-0000-0000-000000000001';

-- === 1. Organization creation (create_organization RPC) ===
select isnt(
  (select public.create_organization('Foundation Test Org A', 'agency')),
  null,
  'user1 can create an organization via create_organization()'
);

select is(
  (select role from public.organization_members om
     join public.organizations o on o.id = om.org_id
     where o.legal_name = 'Foundation Test Org A' and om.user_id = 'a0000000-0000-0000-0000-000000000001'),
  'principal'::public.organization_member_role,
  'create_organization() atomically makes the creator a principal member (never an orphaned org)'
);

-- === 2. Role resolution: principal can invite (has_org_role manager+ gate) ===
select ok(
  (select public.has_org_role(
    (select id from public.organizations where legal_name = 'Foundation Test Org A'),
    'manager'
  )),
  'user1 (principal) satisfies the manager+ gate required to create an invite'
);

-- === 3. Invitation creation -- regression guard for the missing-INSERT-policy fix ===
select lives_ok(
  $$ insert into public.organization_invites (org_id, email, role, invited_by)
     select id, 'foundation-user2@test.propertyvault.example', 'agent', 'a0000000-0000-0000-0000-000000000001'
     from public.organizations where legal_name = 'Foundation Test Org A' $$,
  'user1 (principal, manager+) can INSERT an organization_invites row (20260101000026 fix)'
);

select is(
  (select count(*) from public.organization_invites oi
     join public.organizations o on o.id = oi.org_id
     where o.legal_name = 'Foundation Test Org A'
       and oi.email = 'foundation-user2@test.propertyvault.example'),
  1::bigint,
  'exactly one pending invite exists for user2 after the insert'
);

-- === 4. Invitation acceptance (accept_organization_invite RPC, as the invited user) ===
-- Stash the token while still in user1's session, who *can* SELECT it
-- (organization_invites_select_same_org requires an existing active membership in the org).
-- Bug found by first running this test: the original version looked the token up as user2 via a
-- subquery run *after* switching sessions -- but user2 is, by definition, not yet a member at
-- that point, so RLS correctly returned zero rows and the accept call silently received a NULL
-- token, failing with "Invite not found." That failure was real and correctly caught by
-- lives_ok, but it was a bug in this test's setup, not in accept_organization_invite() itself --
-- it does not match how the real flow works (the token comes from the invite email link, never
-- from the recipient querying organization_invites themselves).
select set_config(
  'pgtap.test_invite_token',
  (select token::text from public.organization_invites oi
     join public.organizations o on o.id = oi.org_id
     where o.legal_name = 'Foundation Test Org A'
       and oi.email = 'foundation-user2@test.propertyvault.example'),
  false
);

set local "request.jwt.claim.sub" = 'a0000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.accept_organization_invite(current_setting('pgtap.test_invite_token')::uuid) $$,
  'user2 can accept the invite addressed to their own signed-in email'
);

select is(
  (select role from public.organization_members om
     join public.organizations o on o.id = om.org_id
     where o.legal_name = 'Foundation Test Org A' and om.user_id = 'a0000000-0000-0000-0000-000000000002'),
  'agent'::public.organization_member_role,
  'accepting the invite creates a membership row with the invited role (agent), not principal'
);

select is(
  (select accepted_at is not null from public.organization_invites oi
     join public.organizations o on o.id = oi.org_id
     where o.legal_name = 'Foundation Test Org A'
       and oi.email = 'foundation-user2@test.propertyvault.example'),
  true,
  'the invite row is marked accepted after acceptance (cannot be replayed)'
);

-- === 5. org_id propagation: the newly-joined agent can create a property scoped to this org ===
-- properties no longer has a client-facing INSERT policy (20260101000064) -- create_property()
-- is the only sanctioned path as of that migration, same reasoning as organizations/
-- create_organization().
select lives_ok(
  $$ select public.create_property(
       (select id from public.organizations where legal_name = 'Foundation Test Org A'),
       'Foundation Test Property', '1 Integration Street', 'Cape Town', 'ZA', 'house'::public.property_type
     ) $$,
  'user2 (agent, meets the agent+ write gate) can create a property in the org they just joined'
);

select is(
  (select o.legal_name from public.properties p
     join public.organizations o on o.id = p.org_id
     where p.nickname = 'Foundation Test Property'),
  'Foundation Test Org A',
  'the created property''s org_id resolves back to the correct organization -- propagation is correct, not just non-null'
);

-- === 6. Role resolution ceiling: the same agent cannot update the org compliance profile
--        (manager+ only) -- proves role resolution is per-action, not "any member can do anything" ===
select lives_ok(
  $$ update public.organizations set trading_name = 'Should Not Apply'
     where legal_name = 'Foundation Test Org A' $$,
  'user2 (agent) UPDATE against the org profile runs without error (RLS silently filters to zero rows, verified next)'
);

select is(
  (select trading_name from public.organizations where legal_name = 'Foundation Test Org A'),
  null,
  'the agent''s attempted compliance-profile edit did not apply -- manager+ gate holds even for an active, correctly-scoped member'
);

-- === 7. Org switching / multi-org membership: user1 also joins a second org at a different rank,
--        proving has_org_role() resolves per-org, not as one global role per user ===
set local "request.jwt.claim.sub" = 'a0000000-0000-0000-0000-000000000003';
select public.create_organization('Foundation Test Org B', 'owner_managed');

-- Bug found by first running this test: the original version inserted this second membership row
-- directly while still `set local role authenticated` -- but organization_members has no INSERT
-- policy for that role at all (by design: the only two sanctioned ways to create a membership row
-- are create_organization()'s creator-as-principal insert and accept_organization_invite()'s
-- invited-user insert, both security-definer; there is no "add an existing user to an org"
-- self-service action, since that would be a real privilege-escalation hole). The bare INSERT
-- correctly raised an RLS violation and aborted the surrounding transaction, which is why test 14
-- failed too -- a test-harness bug, not a schema bug. `reset role` drops back to this script's
-- own superuser connection for this one fixture-setup statement only (mirroring how
-- rls_isolation.test.sql/multi_tenant_isolation.test.sql insert their own fixtures before ever
-- calling `set local role authenticated`), then re-enters `authenticated` immediately after.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'a0000000-0000-0000-0000-000000000001', 'viewer', 'active', now()
from public.organizations where legal_name = 'Foundation Test Org B';
set local role authenticated;
set local "request.jwt.claim.sub" = 'a0000000-0000-0000-0000-000000000001';

select is(
  (select public.has_org_role(
    (select id from public.organizations where legal_name = 'Foundation Test Org A'), 'manager'
  )),
  true,
  'user1 is still manager+ in Org A (their own org)'
);

select is(
  (select public.has_org_role(
    (select id from public.organizations where legal_name = 'Foundation Test Org B'), 'manager'
  )),
  false,
  'the same user1 is NOT manager+ in Org B, where they hold only viewer -- role resolution is genuinely per-org, not a single global rank carried across the switch'
);

select * from finish();
rollback;
