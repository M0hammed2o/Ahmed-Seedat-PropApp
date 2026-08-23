-- Tests for 20260101000063_property_access.sql: has_property_access() role semantics,
-- grant_property_access()/revoke_property_access() authorization gating, the backfill's
-- zero-regression grant, and the owner-with-login pre-population.
--
-- The property's own id is stashed via set_config() right after creation (same pattern as
-- multi_tenant_foundation_integration.test.sql) and read back via current_setting() throughout,
-- rather than re-queried by nickname under each test user's own session -- properties' RLS is
-- deliberately NOT cut over to consider property_access in this pass (that is a separate,
-- higher-risk follow-up), so a non-org-member test user genuinely cannot see the properties row
-- at all via an ordinary query, same as in the real app today. Re-querying by nickname from a
-- restricted session would silently resolve to NULL and make every downstream assertion
-- meaningless, not fail loudly -- found live while first writing this file (a raw EXISTS query
-- returned false even though the correct property_access row demonstrably existed, isolated by
-- comparing `pa.user_id = auth.uid()` directly against a nickname-scoped property_id lookup).

begin;
select plan(20);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'pa-principal@test.propertyvault.example'),
  ('f1000000-0000-0000-0000-000000000002', 'pa-viewer@test.propertyvault.example'),
  ('f1000000-0000-0000-0000-000000000003', 'pa-outsider@test.propertyvault.example'),
  ('f1000000-0000-0000-0000-000000000004', 'pa-owner-login@test.propertyvault.example');

-- Principal creates the org (and its own property) as the acting user throughout setup.
set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Property Access Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Property Access Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

-- properties no longer has a client-facing INSERT policy (20260101000064) -- create_property()
-- is the only sanctioned path as of that migration. Its trigger also auto-grants the creator
-- (and every other currently-active org member) an administrator property_access row -- this
-- means the "backfill" section below now needs a fresh, empty org member to exercise against
-- (the principal already has a real grant from this trigger, not the replicated backfill query).
select set_config(
  'pgtap.property_access_test.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Property Access Test Org'),
    'Access Test Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

-- A second, viewer-role member of the same org (added directly, bypassing invite flow -- test
-- setup only), added AFTER the property already exists -- exercises
-- grant_new_member_property_access_trigger (20260101000064), the live companion to the one-time
-- backfill, which grants a newly (re)activated org member administrator access on every existing
-- property in their org. organization_members has no INSERT policy for the `authenticated` role
-- at all (by design -- only create_organization()'s creator-as-principal insert and
-- accept_organization_invite() may create a membership row) -- reset to the superuser
-- test-runner role for this direct insert, same pattern as
-- multi_tenant_foundation_integration.test.sql.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'f1000000-0000-0000-0000-000000000002', 'viewer', 'active', now()
from public.organizations where legal_name = 'Property Access Test Org';

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

-- ==== Zero-regression grants: create_property()'s own trigger grants the creator; the
-- organization_members trigger grants a member who joins afterward. Neither is the outsider
-- (never an org member at all). ====

select is(
  (select property_role from public.property_access
     where property_id = current_setting('pgtap.property_access_test.property_id')::uuid
       and user_id = 'f1000000-0000-0000-0000-000000000001'::uuid),
  'administrator'::public.property_role,
  'create_property()''s trigger grants the creating principal administrator access'
);

select is(
  (select property_role from public.property_access
     where property_id = current_setting('pgtap.property_access_test.property_id')::uuid
       and user_id = 'f1000000-0000-0000-0000-000000000002'::uuid),
  'administrator'::public.property_role,
  'the organization_members trigger grants a viewer-role member who joins AFTER property creation administrator access too (matches todays actual org-wide visibility -- zero regression)'
);

select is(
  (select count(*)::int from public.property_access
     where property_id = current_setting('pgtap.property_access_test.property_id')::uuid
       and user_id = 'f1000000-0000-0000-0000-000000000003'::uuid),
  0,
  'an outsider with no org membership gets no automatic grant'
);

-- ==== has_property_access() role semantics, evaluated as the outsider (no grant at all) ====

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000003';

select ok(
  not (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'read_only'
  )),
  'outsider fails even the read_only minimum -- no grant at all'
);

-- ==== has_property_access() as the backfilled administrator (principal) ====

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

select ok(
  (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'read_only'
  )),
  'administrator satisfies read_only minimum'
);

select ok(
  (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'owner'
  )),
  'administrator satisfies owner minimum (superset role)'
);

select ok(
  (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'administrator'
  )),
  'administrator satisfies its own exact minimum'
);

-- ==== grant_property_access(): authorization gate (manager+ only) ====

-- The viewer-role member attempts to grant access to the outsider -- must fail (viewer < manager).
set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.grant_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid,
    'f1000000-0000-0000-0000-000000000003'::uuid,
    'read_only'::public.property_role
  ) $$,
  'Only the organization principal may grant property access',
  'a viewer-role member cannot grant property access'
);

-- The principal grants the outsider a narrow read_only role -- must succeed.
set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

select isnt(
  (select public.grant_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid,
    'f1000000-0000-0000-0000-000000000003'::uuid,
    'read_only'::public.property_role
  )),
  null,
  'a manager-role member (principal) can grant property access'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000003';

select ok(
  (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'read_only'
  )),
  'the outsider now satisfies read_only after being granted it'
);

select ok(
  not (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'accountant'
  )),
  'read_only grant does NOT satisfy a higher, unrelated minimum (accountant)'
);

-- ==== Sibling-role semantics: accountant does not satisfy property_manager, and vice versa ====

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

select isnt(
  (select public.grant_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid,
    'f1000000-0000-0000-0000-000000000003'::uuid,
    'accountant'::public.property_role
  )),
  null,
  'principal upgrades the outsider''s grant to accountant'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000003';

select ok(
  (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'accountant'
  )),
  'accountant grant satisfies the accountant minimum'
);

select ok(
  not (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'property_manager'
  )),
  'accountant grant does NOT satisfy the property_manager minimum -- siblings, not ranked'
);

select ok(
  (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'read_only'
  )),
  'accountant grant still satisfies the universal read_only minimum'
);

-- ==== revoke_property_access(): authorization gate + effect ====

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.revoke_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid,
    'f1000000-0000-0000-0000-000000000003'::uuid
  ) $$,
  'Only the organization principal may revoke property access',
  'a viewer-role member cannot revoke property access'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.revoke_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid,
    'f1000000-0000-0000-0000-000000000003'::uuid
  ) $$,
  'a manager-role member (principal) can revoke property access'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000003';

select ok(
  not (select public.has_property_access(
    current_setting('pgtap.property_access_test.property_id')::uuid, 'read_only'
  )),
  'the outsider no longer has any access after revocation'
);

-- ==== Owner-with-login pre-population ====

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

insert into public.owners (org_id, user_id, name)
select id, 'f1000000-0000-0000-0000-000000000004', 'Owner With Login'
from public.organizations where legal_name = 'Property Access Test Org';

insert into public.property_owners (property_id, owner_id, ownership_pct)
select current_setting('pgtap.property_access_test.property_id')::uuid, o.id, 100
from public.owners o
where o.name = 'Owner With Login';

-- Superseded by 20260101000083's sync_owner_property_access_trigger (shared-access architecture
-- pass, WORKLOG.md that date): recording a NEW ownership share for an owner who already has a
-- linked account now DOES grant 'owner' property_access live, not just at invitation-acceptance
-- time -- otherwise only the properties owned AT THE MOMENT an owner accepted their invitation
-- would ever get a grant, and every later-added property would silently need manual curation.
select is(
  (select property_role::text from public.property_access
     where property_id = current_setting('pgtap.property_access_test.property_id')::uuid
       and user_id = 'f1000000-0000-0000-0000-000000000004'::uuid),
  'owner',
  'an ownership share recorded for an owner who already has a linked account grants owner-role property_access live'
);

select * from finish();
rollback;
