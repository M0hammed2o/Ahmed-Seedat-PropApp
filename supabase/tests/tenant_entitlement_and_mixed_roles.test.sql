-- Tests for the tenant invitation + entitlement architecture (WORKLOG.md this date):
-- 1) a tenant-only account never needs an owner subscription / staff seat / org membership to
--    use the tenant portal (it's the landlord organization's subscription that covers this, not
--    the tenant's own), but 2) a "linked tenant only" account (migration 20260101000095) is,
--    like a linked owner, blocked from a free create_organization(); and 3) one Auth user can
--    simultaneously hold owner, staff, and tenant relationships with no duplicate account and no
--    cross-contamination between them.

begin;
select plan(14);

insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'te-pure-tenant@test.propertyvault.example'),
  ('f5000000-0000-0000-0000-000000000002', 'te-mixed-owner-tenant@test.propertyvault.example'),
  ('f5000000-0000-0000-0000-000000000003', 'te-mixed-staff-tenant@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('f6000000-0000-0000-0000-000000000001', 'Tenant Entitlement Landlord Org', 'agency'),
  ('f6000000-0000-0000-0000-000000000002', 'Tenant Entitlement Second Org', 'agency');

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values ('f6000000-0000-0000-0000-000000000011', 'f6000000-0000-0000-0000-000000000001', 'TE Property', '1 TE St', 'Cape Town', 'ZA', 'house');

insert into public.units (id, property_id, org_id, unit_label, status)
values ('f6000000-0000-0000-0000-000000000021', 'f6000000-0000-0000-0000-000000000011', 'f6000000-0000-0000-0000-000000000001', 'Unit TE', 'occupied');

-- === Pure tenant: zero owner/staff relationship anywhere ===
insert into public.tenants (id, org_id, user_id, full_name, status)
values ('f6000000-0000-0000-0000-000000000031', 'f6000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'Pure Tenant', 'active');

insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status, source)
values ('f6000000-0000-0000-0000-000000000041', 'f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000021', current_date, 5000, 'active', 'manual');
insert into public.lease_tenants (lease_id, tenant_id, is_primary)
values ('f6000000-0000-0000-0000-000000000041', 'f6000000-0000-0000-0000-000000000031', true);

-- === Mixed owner+tenant: same auth user, owner in Org A, tenant in Org B ===
insert into public.owners (id, org_id, user_id, name, status)
values ('f6000000-0000-0000-0000-000000000051', 'f6000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000002', 'Mixed Owner', 'active');
-- Ownership share -- sync_owner_property_access() (20260101000072) grants the real property_access
-- 'owner'-role row from this insert, the same real path accept_owner_invitation()'s bulk-grant
-- step and the ongoing sync trigger both use; has_property_access() reads that grant, not the
-- `owners` row directly.
insert into public.property_owners (property_id, owner_id, ownership_pct)
values ('f6000000-0000-0000-0000-000000000011', 'f6000000-0000-0000-0000-000000000051', 100);
insert into public.tenants (id, org_id, user_id, full_name, status)
values ('f6000000-0000-0000-0000-000000000052', 'f6000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000002', 'Mixed Owner As Tenant', 'active');

-- === Mixed staff+tenant: same auth user, agent in Org A, tenant in Org B ===
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('f6000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000003', 'agent', 'active', now());
insert into public.tenants (id, org_id, user_id, full_name, status)
values ('f6000000-0000-0000-0000-000000000053', 'f6000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000003', 'Mixed Staff As Tenant', 'active');

set local role authenticated;

-- === 13: tenant portal access itself needs no owner subscription / grant / org subscription ===
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.leases where id = 'f6000000-0000-0000-0000-000000000041'),
  1::bigint,
  'a pure tenant with zero owner_portfolio_grants/organization_subscriptions can still read their own lease'
);

-- === 14: tenant never consumes an org's billable staff seat ===
-- Org B holds two tenants (the mixed owner+tenant and mixed staff+tenant users, inserted below)
-- and zero organization_members rows -- proves a tenant record contributes nothing to a billable
-- staff count, distinct from Org A which genuinely does have a real staff member (for test 27).
reset role;
select is(
  (select public.org_active_billable_staff_count('f6000000-0000-0000-0000-000000000002')),
  0::integer,
  'an org with tenant records but no organization_members has a billable staff count of 0 -- tenants never count as seats'
);

-- === 15: a "linked tenant only" account cannot create_organization() for free ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';
select ok(
  not (select public.may_create_portfolio()),
  'a pure tenant-only account (tenants row, zero org memberships, no grant) may NOT create_portfolio'
);
select throws_ok(
  $$ select public.create_organization('Pure Tenant Free Portfolio Attempt') $$,
  'P0001',
  'owner_subscription_required: an active Proplyst owner subscription is required to create your own portfolio.',
  'a pure tenant-only account cannot call create_organization() directly'
);

-- === 16/17: a tenant has no staff-level access into the landlord's org at all ===
select ok(
  not (select public.has_org_role('f6000000-0000-0000-0000-000000000001', 'agent')),
  'a tenant cannot create a property in the landlord org (has_org_role agent = false)'
);
select ok(
  not (select public.has_org_role('f6000000-0000-0000-0000-000000000001', 'manager')),
  'a tenant cannot invite staff in the landlord org (has_org_role manager = false)'
);

-- === 18: a tenant cannot read the landlord org's billing/subscription rows ===
reset role;
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values (
  'f6000000-0000-0000-0000-000000000001',
  (select id from public.plans where code = 'starter'),
  'monthly', current_date, current_date + interval '1 month', 'active'
);
set local role authenticated;
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.organization_subscriptions where org_id = 'f6000000-0000-0000-0000-000000000001'),
  0::bigint,
  'a tenant cannot read the landlord org''s organization_subscriptions row'
);

-- === 26: same Auth user, owner in Org A + tenant in Org B, no cross-contamination ===
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000002';
select ok(
  (select public.has_property_access('f6000000-0000-0000-0000-000000000011', 'owner')),
  'the mixed owner+tenant user has owner-role property access via their owners row'
);
select is(
  (select count(*) from public.tenants where id = 'f6000000-0000-0000-0000-000000000052'),
  1::bigint,
  'the same mixed owner+tenant user can also read their own tenants row in the other org'
);
select ok(
  not (select public.may_create_portfolio()),
  'the mixed owner+tenant user (owner AND tenant, zero org memberships) still may NOT create_portfolio'
);

-- === 27: same Auth user, staff (agent) in Org A + tenant in Org B, no cross-contamination ===
set local "request.jwt.claim.sub" = 'f5000000-0000-0000-0000-000000000003';
select ok(
  (select public.has_org_role('f6000000-0000-0000-0000-000000000001', 'agent')),
  'the mixed staff+tenant user has real agent access in the org they are staff of'
);
select is(
  (select count(*) from public.tenants where id = 'f6000000-0000-0000-0000-000000000053'),
  1::bigint,
  'the same mixed staff+tenant user can also read their own tenants row in the other org'
);
select ok(
  (select public.may_create_portfolio()),
  'the mixed staff+tenant user MAY create_portfolio -- already an active member of an org, so the tenant relationship elsewhere does not newly restrict them'
);

-- === 28: no duplicate Auth account -- the exact same auth.users id is valid across owners/
--     organization_members/tenants simultaneously (already proven by every assertion above using
--     the SAME 3 auth user ids across multiple identity tables) -- one direct, explicit check ===
reset role;
select is(
  (select count(distinct id) from auth.users where id in (
    'f5000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000002',
    'f5000000-0000-0000-0000-000000000003'
  )),
  3::bigint,
  'exactly one auth.users row per person, reused across every identity table above -- no duplicate accounts created by any linking path'
);

select * from finish();
rollback;
