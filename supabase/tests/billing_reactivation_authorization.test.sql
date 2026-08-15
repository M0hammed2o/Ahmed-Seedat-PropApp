-- Tests for 20260101000103_billing_reactivation_authorization.sql: a suspended/cancelled org's
-- own principal can now pass has_billing_principal_access() (the billing-route-only exception),
-- while has_org_role() -- the real enforcement for every ordinary org mutation -- remains
-- completely unaffected: still forces suspended/cancelled orgs to viewer-only. Also proves the
-- exception cannot be used by a non-principal, cannot be used cross-org, and does not apply to an
-- archived org.

begin;
select plan(11);

insert into auth.users (id, email) values
  ('fb000000-0000-0000-0000-000000000001', 'br-principal@test.propertyvault.example'),
  ('fb000000-0000-0000-0000-000000000002', 'br-manager@test.propertyvault.example'),
  ('fb000000-0000-0000-0000-000000000003', 'br-other-org-principal@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type, status)
values ('fc000000-0000-0000-0000-000000000001', 'Billing Reactivation Test Org (suspended)', 'agency', 'suspended');
insert into public.organizations (id, legal_name, org_type, status)
values ('fc000000-0000-0000-0000-000000000002', 'Billing Reactivation Test Org (cancelled)', 'agency', 'cancelled');
insert into public.organizations (id, legal_name, org_type, status)
values ('fc000000-0000-0000-0000-000000000003', 'Billing Reactivation Test Org (archived)', 'agency', 'archived');
insert into public.organizations (id, legal_name, org_type, status)
values ('fc000000-0000-0000-0000-000000000004', 'Billing Reactivation Test Org (attacker''s own, active)', 'agency', 'active');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('fc000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('fc000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000002', 'manager', 'active', now()),
  ('fc000000-0000-0000-0000-000000000002', 'fb000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('fc000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('fc000000-0000-0000-0000-000000000004', 'fb000000-0000-0000-0000-000000000003', 'principal', 'active', now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000001';

-- === The actual fix: a suspended/cancelled org's own principal CAN pass the new exception ===
select ok(
  (select public.has_billing_principal_access('fc000000-0000-0000-0000-000000000001'::uuid)),
  'RELEASE A FIX: a SUSPENDED org''s own principal passes has_billing_principal_access()'
);
select ok(
  (select public.has_billing_principal_access('fc000000-0000-0000-0000-000000000002'::uuid)),
  'RELEASE A FIX: a CANCELLED org''s own principal passes has_billing_principal_access()'
);

-- === Preserved: the underlying bug still reproduces via ordinary has_org_role() ===
select ok(
  not (select public.has_org_role('fc000000-0000-0000-0000-000000000001'::uuid, 'principal')),
  'has_org_role(...,''principal'') is UNCHANGED -- still false for a suspended org''s principal (the original bug, still correctly enforced everywhere else)'
);
select throws_ok(
  $$ select public.create_property('fc000000-0000-0000-0000-000000000001'::uuid, 'Should Not Create', '1 St', 'Cape Town', 'ZA', 'apartment'::public.property_type) $$,
  null, null,
  'a suspended org''s principal STILL cannot create a property -- the billing exception does not leak into ordinary org mutations'
);

-- === Archived orgs are still excluded from the exception (Super-Admin-only territory) ===
select ok(
  not (select public.has_billing_principal_access('fc000000-0000-0000-0000-000000000003'::uuid)),
  'an ARCHIVED org''s principal does NOT get the billing exception (archiving is a more severe, Super-Admin-only state)'
);

-- === Cannot be used by a non-principal ===
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000002';
select ok(
  not (select public.has_billing_principal_access('fc000000-0000-0000-0000-000000000001'::uuid)),
  'a MANAGER (non-principal) of the suspended org does NOT get the billing exception'
);

-- === Cannot be used cross-org ===
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000003';
select ok(
  not (select public.has_billing_principal_access('fc000000-0000-0000-0000-000000000001'::uuid)),
  'a principal of a DIFFERENT org cannot reactivate the suspended org''s billing'
);
select ok(
  (select public.has_billing_principal_access('fc000000-0000-0000-0000-000000000004'::uuid)),
  'sanity: that same user DOES pass the exception for their OWN (active) org'
);

-- === Unauthenticated caller ===
reset role;
select ok(
  not (select public.has_billing_principal_access('fc000000-0000-0000-0000-000000000001'::uuid)),
  'an unauthenticated (no auth.uid()) caller does not get the billing exception'
);

-- === Revoked/inactive membership ===
update public.organization_members
  set status = 'revoked'
  where org_id = 'fc000000-0000-0000-0000-000000000001' and user_id = 'fb000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = 'fb000000-0000-0000-0000-000000000001';
select ok(
  not (select public.has_billing_principal_access('fc000000-0000-0000-0000-000000000001'::uuid)),
  'a REVOKED principal membership does not get the billing exception, even though the row still says role=principal'
);

-- === Still principal on the second (cancelled) org -- membership revocation is per-org ===
select ok(
  (select public.has_billing_principal_access('fc000000-0000-0000-0000-000000000002'::uuid)),
  'sanity: the same user''s still-active principal membership on the cancelled org is unaffected by the other org''s revocation'
);

select * from finish();
rollback;
