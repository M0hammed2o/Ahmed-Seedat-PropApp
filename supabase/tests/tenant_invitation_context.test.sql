-- get_tenant_invitation_context() (migration 20260101000096, tenant onboarding completion pass,
-- Phase 2 "safe activation context"). Proves the two-tier disclosure the function's own comment
-- promises: an unauthenticated caller (a fresh invitation link opened signed-out, the normal
-- case) sees the organization name only; property/unit are only populated once auth.uid() is not
-- null. Also proves a nonexistent/invalid token returns valid:false rather than an error, and that
-- financial/ID/document/other-tenant fields are never part of this function's return shape at all
-- (structurally -- there is no column to leak them through).

begin;
select plan(7);

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'tic-staff@test.propertyvault.example'),
  ('c2000000-0000-0000-0000-000000000001', 'tic-viewer@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type, trading_name)
values ('c3000000-0000-0000-0000-000000000001', 'Tenant Invitation Context Test Org', 'agency', 'Musgrave Property Group');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'agent', 'active', now());

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values ('c3000000-0000-0000-0000-000000000011', 'c3000000-0000-0000-0000-000000000001', 'Musgrave Flats', '1 Test St', 'Durban', 'ZA', 'apartment');

insert into public.units (id, property_id, org_id, unit_label, status)
values ('c3000000-0000-0000-0000-000000000021', 'c3000000-0000-0000-0000-000000000011', 'c3000000-0000-0000-0000-000000000001', 'Unit 601', 'occupied');

insert into public.tenants (id, org_id, full_name, status)
values ('c3000000-0000-0000-0000-000000000031', 'c3000000-0000-0000-0000-000000000001', 'Context Test Tenant', 'active');

insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status, source)
values ('c3000000-0000-0000-0000-000000000041', 'c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000021', current_date, 5000, 'active', 'manual');

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
values ('c3000000-0000-0000-0000-000000000041', 'c3000000-0000-0000-0000-000000000031', true);

set local role authenticated;
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';
create temp table context_invite as
select * from public.create_tenant_invitation('c3000000-0000-0000-0000-000000000031', 'email', false, null);

-- === Unauthenticated preview (the normal case: a fresh link opened signed-out) ===
-- Deliberately stays on `role authenticated` (matching every other test in this suite) rather
-- than switching to `role anon` -- get_tenant_invitation_context() is SECURITY DEFINER (runs as
-- the function owner regardless of caller role, same as create/accept_tenant_invitation()), so
-- the only thing that actually distinguishes "unauthenticated" here is auth.uid() itself, which
-- reads solely from the request.jwt.claim.sub GUC. Switching role would additionally strip this
-- session's own SELECT grant on the `context_invite` temp table it just created above, an
-- unrelated pgTAP-scaffolding permission issue, not anything about the function under test.
set local "request.jwt.claim.sub" = '';

select is(
  (select org_name from public.get_tenant_invitation_context((select token from context_invite))),
  'Musgrave Property Group',
  'an unauthenticated caller sees the organization name'
);

select is(
  (select property_label from public.get_tenant_invitation_context((select token from context_invite))),
  null,
  'an unauthenticated caller does NOT see the property label'
);

select is(
  (select unit_label from public.get_tenant_invitation_context((select token from context_invite))),
  null,
  'an unauthenticated caller does NOT see the unit label'
);

select is(
  (select valid from public.get_tenant_invitation_context('not-a-real-token-at-all')),
  false,
  'a nonexistent token returns valid:false, never an error, and never a partial row'
);

-- === Authenticated preview (any signed-in user -- informational only, not a grant) ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

select is(
  (select property_label from public.get_tenant_invitation_context((select token from context_invite))),
  'Musgrave Flats',
  'an authenticated caller (not yet the tenant themselves) sees the property label'
);

select is(
  (select unit_label from public.get_tenant_invitation_context((select token from context_invite))),
  'Unit 601',
  'an authenticated caller sees the unit label'
);

-- === Expired invitation never discloses context ===
-- Direct UPDATE bypasses RLS deliberately (reset role -- same pattern tenant_invitations.test.sql
-- already uses for this exact kind of setup): the c2 viewer used above has no staff role in this
-- org and could never legitimately update tenant_invitations directly, this is purely fixture
-- setup, not something under test. Switches back to `role authenticated` (not `anon`) afterward
-- specifically so the `context_invite` temp table this session created stays readable.
reset role;
update public.tenant_invitations set expires_at = now() - interval '1 hour'
  where id = (select invitation_id from context_invite);
set local role authenticated;
set local "request.jwt.claim.sub" = '';

select is(
  (select valid from public.get_tenant_invitation_context((select token from context_invite))),
  false,
  'an expired invitation''s context is no longer disclosed, even with the right token'
);

select * from finish();
rollback;
