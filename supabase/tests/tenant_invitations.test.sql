-- Adversarial tests for tenant_invitations / create_tenant_invitation() / accept_tenant_invitation()
-- (migration 20260101000059, PRODUCT DECISION 2 2026-08-03). Covers every case named in the
-- instruction: link acceptance, short-code acceptance, expired/revoked/already-used, invalid
-- code, failed-attempt lockout, replay prevention, email mismatch, cross-org attack, tenant
-- already linked, idempotent retry, archived/suspended org, audit event, RLS isolation.
--
-- accept_tenant_invitation() returns a (success, error_code, tenant_id) row rather than raising
-- for expected failures (see the function's own comment: raising rolls back writes made earlier
-- in the same call, e.g. the failed_attempt_count increment -- caught by actually running this
-- suite, not assumed). Every failure-path assertion below reads error_code via
-- `select error_code from accept_tenant_invitation(...)`, never throws_ok.
--
-- Captures RPC-returned plaintext tokens/codes into temp tables rather than psql \gset --
-- accounting_posting_operations.test.sql's own comment documents that \gset values don't
-- interpolate correctly inside $$ ... $$ blocks; a temp table is a real subquery target instead.

begin;
select plan(26);

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'ti-staff-a@test.propertyvault.example'),
  ('b2000000-0000-0000-0000-000000000001', 'ti-staff-b@test.propertyvault.example'),
  ('b3000000-0000-0000-0000-000000000001', 'ti-tenant-alice@test.propertyvault.example'),
  ('b4000000-0000-0000-0000-000000000001', 'ti-tenant-carol@test.propertyvault.example'),
  ('b5000000-0000-0000-0000-000000000001', 'ti-outsider@test.propertyvault.example'),
  ('b6000000-0000-0000-0000-000000000001', 'ti-already-linked@test.propertyvault.example'),
  ('b9000000-0000-0000-0000-000000000001', 'ti-wrong-email-user@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type, status)
values
  ('b7000000-0000-0000-0000-000000000001', 'Tenant Invite Test Org A', 'agency', 'active'),
  ('b7000000-0000-0000-0000-000000000002', 'Tenant Invite Test Org B', 'agency', 'active'),
  ('b7000000-0000-0000-0000-000000000003', 'Tenant Invite Test Org Archived', 'agency', 'archived'),
  ('b7000000-0000-0000-0000-000000000004', 'Tenant Invite Test Org Suspended', 'agency', 'suspended');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('b7000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  ('b7000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  -- Same staff member also holds an (unrelated) agent role in the suspended-org fixture, purely
  -- so the suspended-org test case below has someone authorised to create that invitation --
  -- real orgs are independent; this is a fixture convenience, not a modeled real-world overlap.
  ('b7000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000001', 'agent', 'active', now());

insert into public.tenants (id, org_id, full_name, email, status) values
  ('b8000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'Alice Tenant', 'ti-tenant-alice@test.propertyvault.example', 'active'),
  ('b8000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'Carol Tenant', 'ti-tenant-carol@test.propertyvault.example', 'active'),
  ('b8000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000001', 'Already Linked Tenant', null, 'active'),
  ('b8000000-0000-0000-0000-000000000004', 'b7000000-0000-0000-0000-000000000003', 'Archived Org Tenant', null, 'active'),
  ('b8000000-0000-0000-0000-000000000005', 'b7000000-0000-0000-0000-000000000004', 'Suspended Org Tenant', null, 'active'),
  ('b8000000-0000-0000-0000-000000000006', 'b7000000-0000-0000-0000-000000000001', 'David Tenant', null, 'active'),
  ('b8000000-0000-0000-0000-000000000007', 'b7000000-0000-0000-0000-000000000001', 'Eve Tenant', 'ti-tenant-eve@test.propertyvault.example', 'active');

update public.tenants set user_id = 'b6000000-0000-0000-0000-000000000001' where id = 'b8000000-0000-0000-0000-000000000003';

set local role authenticated;

-- === RLS + creation ===
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

create temp table alice_invite as
select * from public.create_tenant_invitation('b8000000-0000-0000-0000-000000000001', 'email', false, 'a***@example.com');

select isnt((select token from alice_invite), null, 'Org A agent can create a link-based invitation for their own org''s tenant');

set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select public.create_tenant_invitation('b8000000-0000-0000-0000-000000000001', 'email', false, null) $$,
  'Only agent-or-above staff can create a tenant invitation',
  'Org B agent cannot create an invitation for Org A''s tenant (cross-org attack surface)'
);

set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.tenant_invitations where tenant_id = 'b8000000-0000-0000-0000-000000000001'),
  1::bigint,
  'exactly one invitation exists for Alice after the failed cross-org attempt (no partial row created)'
);

select is(
  (select count(*) from public.tenant_invitations where org_id = 'b7000000-0000-0000-0000-000000000001'),
  1::bigint,
  'Org A agent can SELECT the invitation they created'
);

set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.tenant_invitations where org_id = 'b7000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B agent cannot SELECT Org A''s invitation (RLS isolation)'
);

-- === Valid link-based acceptance ===
set local "request.jwt.claim.sub" = 'b3000000-0000-0000-0000-000000000001';

select is(
  (select tenant_id from public.accept_tenant_invitation((select token from alice_invite), null, null)),
  'b8000000-0000-0000-0000-000000000001'::uuid,
  'Alice accepts her link-based invitation and gets her own tenant_id back'
);

select is(
  (select user_id from public.tenants where id = 'b8000000-0000-0000-0000-000000000001'),
  'b3000000-0000-0000-0000-000000000001'::uuid,
  'tenants.user_id is now linked to Alice''s auth user id'
);

-- Idempotent retry: same user, same token, already accepted -> succeeds again, no error.
select is(
  (select success from public.accept_tenant_invitation((select token from alice_invite), null, null)),
  true,
  'idempotent retry: Alice re-submitting the same already-accepted token succeeds (no-op)'
);

-- Replay prevention: a different user attempts the same now-accepted token.
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select is(
  (select error_code from public.accept_tenant_invitation((select token from alice_invite), null, null)),
  'already_used',
  'a different user cannot replay Alice''s already-accepted token'
);

reset role;
select is(
  (select count(*) from public.audit_events where entity_type = 'tenant_invitations' and action = 'tenant_invitation.accepted'),
  1::bigint,
  'exactly one audit_events row was written for the real acceptance (the replay attempt never reached the audit-write line)'
);
set local role authenticated;

-- === Short-code acceptance (Carol, email on file) ===
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';
create temp table carol_invite as
select * from public.create_tenant_invitation('b8000000-0000-0000-0000-000000000002', 'manual', true, null);

select isnt((select short_code from carol_invite), null, 'a short code was generated when requested');

set local "request.jwt.claim.sub" = 'b9000000-0000-0000-0000-000000000001'; -- wrong-email user, but supplies Carol's real email as p_email
select is(
  (select error_code from public.accept_tenant_invitation(null, 'WRONGCODE', 'ti-tenant-carol@test.propertyvault.example')),
  'invalid_code',
  'a wrong short code (right email) is rejected'
);

set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';
select is(
  (select failed_attempt_count from public.tenant_invitations where id = (select invitation_id from carol_invite)),
  1,
  'the wrong-code attempt incremented failed_attempt_count on the correct row -- the return-a-row (not raise) design makes this persist'
);

set local "request.jwt.claim.sub" = 'b4000000-0000-0000-0000-000000000001';
select is(
  (select tenant_id from public.accept_tenant_invitation(null, (select short_code from carol_invite), 'ti-tenant-carol@test.propertyvault.example')),
  'b8000000-0000-0000-0000-000000000002'::uuid,
  'the correct short code + matching email succeeds'
);

-- === Failed-attempt lockout (a fresh invitation for the same tenant) ===
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';
create temp table lockout_invite as
select * from public.create_tenant_invitation('b8000000-0000-0000-0000-000000000002', 'manual', true, null);

set local "request.jwt.claim.sub" = 'b9000000-0000-0000-0000-000000000001';
select is((select error_code from public.accept_tenant_invitation(null, 'WRONG001', 'ti-tenant-carol@test.propertyvault.example')), 'invalid_code', 'lockout attempt 1/5');
select is((select error_code from public.accept_tenant_invitation(null, 'WRONG002', 'ti-tenant-carol@test.propertyvault.example')), 'invalid_code', 'lockout attempt 2/5');
select is((select error_code from public.accept_tenant_invitation(null, 'WRONG003', 'ti-tenant-carol@test.propertyvault.example')), 'invalid_code', 'lockout attempt 3/5');
select is((select error_code from public.accept_tenant_invitation(null, 'WRONG004', 'ti-tenant-carol@test.propertyvault.example')), 'invalid_code', 'lockout attempt 4/5');
select is((select error_code from public.accept_tenant_invitation(null, 'WRONG005', 'ti-tenant-carol@test.propertyvault.example')), 'invalid_code', 'lockout attempt 5/5');
select is(
  (select error_code from public.accept_tenant_invitation(null, (select short_code from lockout_invite), 'ti-tenant-carol@test.propertyvault.example')),
  'locked_out',
  'the 6th attempt is locked out even with the CORRECT code'
);

-- === Expired / revoked ===
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';
create temp table expired_invite as
select * from public.create_tenant_invitation('b8000000-0000-0000-0000-000000000003', 'email', false, null);
reset role;
update public.tenant_invitations set expires_at = now() - interval '1 hour' where id = (select invitation_id from expired_invite);
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select is(
  (select error_code from public.accept_tenant_invitation((select token from expired_invite), null, null)),
  'expired',
  'an expired invitation is rejected'
);

set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';
create temp table revoked_invite as
select * from public.create_tenant_invitation('b8000000-0000-0000-0000-000000000006', 'email', false, null);
update public.tenant_invitations set revoked_at = now() where id = (select invitation_id from revoked_invite);
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select is(
  (select error_code from public.accept_tenant_invitation((select token from revoked_invite), null, null)),
  'revoked',
  'a revoked (but otherwise valid, active-org) invitation is rejected'
);

-- Archived org, invitation itself NOT revoked -- proves the org-status check independently.
-- create_tenant_invitation() can never be used here in the first place: has_org_role()'s
-- real-membership branch excludes archived orgs entirely (TD-17), so no staff member could ever
-- pass its own role check to create this invitation via the normal path -- inserted directly
-- (superuser bypasses RLS) to isolate testing the ACCEPTANCE-side archived-org check specifically.
reset role;
insert into public.tenant_invitations (org_id, tenant_id, token_hash, delivery_channel, created_by_user_id)
values (
  'b7000000-0000-0000-0000-000000000003', 'b8000000-0000-0000-0000-000000000004',
  encode(digest('archived-org-test-token', 'sha256'), 'hex'), 'email', 'b1000000-0000-0000-0000-000000000001'
);
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select is(
  (select error_code from public.accept_tenant_invitation('archived-org-test-token', null, null)),
  'org_inactive',
  'an archived org''s tenant invitation is rejected even when the invitation itself is still valid'
);

-- === Tenant already linked to a different account ===
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';
create temp table already_linked_invite as
select * from public.create_tenant_invitation('b8000000-0000-0000-0000-000000000003', 'email', false, null);
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001'; -- outsider, NOT the b6 user already linked
select is(
  (select error_code from public.accept_tenant_invitation((select token from already_linked_invite), null, null)),
  'already_linked',
  'a tenant already linked to a different auth user cannot be re-linked by someone else'
);

-- === Email mismatch (link-based, tenant has email on file) ===
-- Uses a fresh, still-unlinked tenant (Eve) -- Carol (tenant 002) is already linked to b4 by this
-- point in the suite, which would trip the "already linked to a different account" check first.
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';
create temp table mismatch_invite as
select * from public.create_tenant_invitation('b8000000-0000-0000-0000-000000000007', 'email', false, null);
set local "request.jwt.claim.sub" = 'b9000000-0000-0000-0000-000000000001'; -- wrong-email-user, email does not match Eve's on-file email
select is(
  (select error_code from public.accept_tenant_invitation((select token from mismatch_invite), null, null)),
  'email_mismatch',
  'a caller whose auth email does not match the tenant''s on-file email is rejected'
);

-- === Suspended org: linking still succeeds (deliberate design -- tenant portal access is never
--     status-gated the way staff access is, per has_org_role()'s own suspended-branch semantics).
--     Realistic sequence: the invitation is created while the org is still active (staff can't
--     create one at all once suspended -- has_org_role('agent') requires min_role='viewer' for a
--     suspended org, same TD-17 restriction as archived), then the org is suspended afterward,
--     matching the real scenario this design decision targets (a tenant who was already invited
--     before a billing suspension shouldn't lose portal access because of it). ===
reset role;
update public.organizations set status = 'active' where id = 'b7000000-0000-0000-0000-000000000004';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';
create temp table suspended_org_invite as
select * from public.create_tenant_invitation('b8000000-0000-0000-0000-000000000005', 'email', false, null);

reset role;
update public.organizations set status = 'suspended' where id = 'b7000000-0000-0000-0000-000000000004';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-0000-0000-000000000001';
select is(
  (select tenant_id from public.accept_tenant_invitation((select token from suspended_org_invite), null, null)),
  'b8000000-0000-0000-0000-000000000005'::uuid,
  'a suspended (not archived) org''s tenant invitation still links successfully'
);

select * from finish();
rollback;
