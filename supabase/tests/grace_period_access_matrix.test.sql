-- V1 billing invoice pass (WORKLOG.md this date), Phase 10: the grace-period access matrix,
-- upgraded from "Likely" (the prior pass's own self-rating) to fully live-tested across ALL five
-- organizations.status values, for BOTH the has_org_role() predicate every RLS policy on
-- properties/tenants/leases/documents/etc. actually calls (supabase/migrations/20260101000055,
-- 20260101000057) AND one real table-level round trip against `properties` itself -- not inferred
-- from migration comments, run live.
--
-- multi_tenant_isolation.test.sql already live-tests 'archived' (zero access) and 'suspended'
-- (viewer passes, agent fails) via has_org_role() directly. This file completes the matrix with
-- 'trial'/'active'/'overdue' (all full read+write) and 'cancelled' (viewer passes, agent fails,
-- same as suspended -- has_org_role()'s own status branch treats them identically), PLUS a real
-- INSERT/SELECT against `properties` for the two statuses that actually change behaviour
-- (active vs suspended) so this isn't only proving the predicate function in isolation.

begin;
select plan(16);

insert into auth.users (id, email) values
  ('9a000000-0000-0000-0000-000000000001', 'grace-matrix-principal@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type, status) values
  ('9a1a0000-0000-0000-0000-000000000001', 'Grace Matrix Test Org', 'agency', 'trial');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('9a1a0000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', 'principal', 'active', now());

set local role authenticated;
set local "request.jwt.claim.sub" = '9a000000-0000-0000-0000-000000000001';

-- === trial: full read+write access (unaffected by the status branch -- SUBSCRIPTIONS.md: "trial,
-- active, overdue -> unchanged, full role-based access") ===
select ok(
  (select public.has_org_role('9a1a0000-0000-0000-0000-000000000001', 'viewer')),
  'trial: has_org_role() at viewer passes'
);
select ok(
  (select public.has_org_role('9a1a0000-0000-0000-0000-000000000001', 'agent')),
  'trial: has_org_role() at agent (write) also passes -- trial is not a restricted state'
);

-- === active: full read+write access ===
reset role;
update public.organizations set status = 'active' where id = '9a1a0000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '9a000000-0000-0000-0000-000000000001';

select ok(
  (select public.has_org_role('9a1a0000-0000-0000-0000-000000000001', 'viewer')),
  'active: has_org_role() at viewer passes'
);
select ok(
  (select public.has_org_role('9a1a0000-0000-0000-0000-000000000001', 'agent')),
  'active: has_org_role() at agent (write) passes'
);

-- Real table-level proof, not just the predicate function in isolation. Seeded as postgres
-- (service-role posture) -- properties has NO client-facing INSERT policy at all by design
-- (20260101000064_properties_access_cutover.sql: creation goes through create_property(), never a
-- bare client INSERT, since has_property_access() can't be evaluated for a not-yet-existing row);
-- that is a separate, already-enforced restriction unrelated to what this file is testing, so the
-- fixture row is seeded the same way production actually creates one, and this file focuses on the
-- org-status-gated SELECT/UPDATE round trip that DOES vary by status. grant_org_members_property_
-- access_trigger (20260101000063) auto-grants every active org member (property_access_mode='all'
-- by default) an 'administrator' property_access row on insert -- no manual grant needed.
reset role;
insert into public.properties (org_id, nickname, address_line1, city, country, property_type, id) values
  ('9a1a0000-0000-0000-0000-000000000001', 'Grace Matrix Property', '1 Test St', 'Durban', 'ZA', 'apartment', '9a1a0000-0000-0000-0000-000000000201');
set local role authenticated;
set local "request.jwt.claim.sub" = '9a000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.properties where org_id = '9a1a0000-0000-0000-0000-000000000001'),
  1,
  'active: the property row is readable by the org''s own principal'
);
select lives_ok(
  $$ update public.properties set nickname = 'Grace Matrix Property (edited while active)'
     where org_id = '9a1a0000-0000-0000-0000-000000000001' $$,
  'active: a real UPDATE (write) against properties succeeds for the org''s own principal'
);
select is(
  (select nickname from public.properties where org_id = '9a1a0000-0000-0000-0000-000000000001'),
  'Grace Matrix Property (edited while active)',
  'active: the UPDATE genuinely applied'
);

-- === overdue: STILL full read+write access -- this is the commercial-launch requirement Phase 10
-- explicitly calls out ("OVERDUE/GRACE PERIOD customer should generally retain sufficient access...
-- normal business writes should remain enabled during grace per existing documented policy") and
-- the one status the prior pass never actually exercised live. ===
reset role;
update public.organizations set status = 'overdue', overdue_since = now() where id = '9a1a0000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '9a000000-0000-0000-0000-000000000001';

select ok(
  (select public.has_org_role('9a1a0000-0000-0000-0000-000000000001', 'viewer')),
  'overdue (grace period): has_org_role() at viewer passes -- can still view/access billing'
);
select ok(
  (select public.has_org_role('9a1a0000-0000-0000-0000-000000000001', 'agent')),
  'overdue (grace period): has_org_role() at agent (write) ALSO passes -- normal business writes remain enabled during the grace period, not just read access'
);
select lives_ok(
  $$ update public.properties set nickname = 'Grace Matrix Property (edited during grace period)'
     where org_id = '9a1a0000-0000-0000-0000-000000000001' $$,
  'overdue: a real UPDATE (write) against properties succeeds for the org''s own principal -- confirms the has_org_role() result above against the actual RLS-enforced table, not only the predicate function'
);

-- === suspended: read-only (viewer passes, agent/write fails) -- already covered at the
-- has_org_role()-only level by multi_tenant_isolation.test.sql; this adds the real-table proof. ===
reset role;
update public.organizations set status = 'suspended' where id = '9a1a0000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '9a000000-0000-0000-0000-000000000001';

select ok(
  (select public.has_org_role('9a1a0000-0000-0000-0000-000000000001', 'viewer')),
  'suspended: has_org_role() at viewer still passes -- can still view/reach billing to recover'
);
select lives_ok(
  $$ select count(*) from public.properties where org_id = '9a1a0000-0000-0000-0000-000000000001' $$,
  'suspended: a real SELECT against properties still succeeds -- business data is not deleted or hidden, only writes are blocked'
);
select lives_ok(
  $$ update public.properties set nickname = 'Attempted edit while suspended'
     where org_id = '9a1a0000-0000-0000-0000-000000000001' $$,
  'suspended: a real UPDATE against properties runs without a permission error (has_org_role() at agent is baked into the policy''s USING/WITH CHECK, so it silently filters to zero rows rather than throwing -- the same shape already established for other no-write-policy tables in this codebase)'
);
select is(
  (select nickname from public.properties where org_id = '9a1a0000-0000-0000-0000-000000000001'),
  'Grace Matrix Property (edited during grace period)',
  'suspended: the property''s nickname is genuinely UNCHANGED by the attempted edit above -- the suspended-org write really was blocked, not merely unobserved'
);

-- === cancelled: same as suspended -- viewer passes, agent/write fails (has_org_role()'s own
-- status branch treats 'suspended' and 'cancelled' identically: "when o.status in ('suspended',
-- 'cancelled') then min_role = 'viewer'"). Never previously exercised live for 'cancelled'
-- specifically. ===
reset role;
update public.organizations set status = 'cancelled' where id = '9a1a0000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '9a000000-0000-0000-0000-000000000001';

select ok(
  (select public.has_org_role('9a1a0000-0000-0000-0000-000000000001', 'viewer')),
  'cancelled: has_org_role() at viewer still passes -- can still view/reach billing to legitimately reactivate'
);
select is(
  (select public.has_org_role('9a1a0000-0000-0000-0000-000000000001', 'agent')),
  false,
  'cancelled: has_org_role() at agent (write) fails, same as suspended'
);

select * from finish();
rollback;
