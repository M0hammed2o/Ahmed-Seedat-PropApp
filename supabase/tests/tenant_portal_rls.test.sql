-- Negative-access tests for the tenant-portal RLS surface (migration 20260101000049).
-- Overnight platform pass, Phase 12-13 (WORKLOG.md this date): the tenant portal itself
-- (apps/admin/app/(tenant)/) was already built and wired to this RLS in a prior session, but no
-- pgTAP test had ever proved Tenant A cannot read Tenant B's lease/rent-schedule/invoice/
-- maintenance-ticket/document/unit/property data by direct id -- CORE OPERATING RULES' "access-
-- control and tenant-isolation protections" are never-waived, so this closes that specific gap
-- rather than assuming migration 20260101000049's policies work because they look correct.
--
-- Two tenants, SAME org, each with their own property/unit/lease -- deliberately not a cross-org
-- setup (that's already covered generically elsewhere, e.g. multi_tenant_isolation.test.sql).
-- Every tenant-self policy in 20260101000049 is scoped by caller_tenant_ids()/lease_id/unit_id/
-- property_id, never by org_id, so a same-org neighbour is the realistic attack this suite must
-- rule out, not just a different customer's org.

begin;
select plan(18);

insert into auth.users (id, email) values
  ('fa000000-0000-0000-0000-000000000001', 'tp-tenant-a@test.propertyvault.example'),
  ('fa000000-0000-0000-0000-000000000002', 'tp-tenant-b@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values ('fb000000-0000-0000-0000-000000000001', 'Tenant Portal RLS Test Org', 'agency');

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values
  ('fb000000-0000-0000-0000-000000000011', 'fb000000-0000-0000-0000-000000000001', 'Property A', '1 A St', 'Cape Town', 'ZA', 'house'),
  ('fb000000-0000-0000-0000-000000000012', 'fb000000-0000-0000-0000-000000000001', 'Property B', '2 B St', 'Cape Town', 'ZA', 'house');

insert into public.units (id, property_id, org_id, unit_label, status)
values
  ('fb000000-0000-0000-0000-000000000021', 'fb000000-0000-0000-0000-000000000011', 'fb000000-0000-0000-0000-000000000001', 'Unit A', 'occupied'),
  ('fb000000-0000-0000-0000-000000000022', 'fb000000-0000-0000-0000-000000000012', 'fb000000-0000-0000-0000-000000000001', 'Unit B', 'occupied');

insert into public.tenants (id, org_id, user_id, full_name, status)
values
  ('fb000000-0000-0000-0000-000000000031', 'fb000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001', 'Tenant A', 'active'),
  ('fb000000-0000-0000-0000-000000000032', 'fb000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000002', 'Tenant B', 'active');

insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status, source)
values
  ('fb000000-0000-0000-0000-000000000041', 'fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000021', current_date, 5000, 'active', 'manual'),
  ('fb000000-0000-0000-0000-000000000042', 'fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000022', current_date, 6000, 'active', 'manual');

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
values
  ('fb000000-0000-0000-0000-000000000041', 'fb000000-0000-0000-0000-000000000031', true),
  ('fb000000-0000-0000-0000-000000000042', 'fb000000-0000-0000-0000-000000000032', true);

insert into public.rent_schedules (org_id, lease_id, due_date, amount, status)
values
  ('fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000041', current_date, 5000, 'pending'),
  ('fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000042', current_date, 6000, 'pending');

insert into public.invoices (id, org_id, lease_id, tenant_id, period, amount, status)
values
  ('fb000000-0000-0000-0000-000000000051', 'fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000041', 'fb000000-0000-0000-0000-000000000031', current_date, 5000, 'draft'),
  ('fb000000-0000-0000-0000-000000000052', 'fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000042', 'fb000000-0000-0000-0000-000000000032', current_date, 6000, 'draft');

insert into public.maintenance_tickets (id, org_id, property_id, unit_id, tenant_id, submitted_by_tenant_id, summary)
values
  ('fb000000-0000-0000-0000-000000000061', 'fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000011', 'fb000000-0000-0000-0000-000000000021', 'fb000000-0000-0000-0000-000000000031', 'fb000000-0000-0000-0000-000000000031', 'Leaking tap in Unit A'),
  ('fb000000-0000-0000-0000-000000000062', 'fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000012', 'fb000000-0000-0000-0000-000000000022', 'fb000000-0000-0000-0000-000000000032', 'fb000000-0000-0000-0000-000000000032', 'Broken window in Unit B');

-- documents: only lease-tagged documents are ever tenant-visible (migration 20260101000049) --
-- one per lease, matching e.g. a signed lease PDF staff explicitly tagged as tenant-visible.
insert into public.documents (id, org_id, property_id, lease_id, category_id, document_type, storage_path, original_file_name, mime_type, file_size_bytes, checksum_sha256)
values
  ('fb000000-0000-0000-0000-000000000071', 'fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000011', 'fb000000-0000-0000-0000-000000000041',
   (select id from public.document_categories where is_default limit 1), 'lease', 'a/lease-a.pdf', 'lease-a.pdf', 'application/pdf', 1000, 'aaa111'),
  ('fb000000-0000-0000-0000-000000000072', 'fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000012', 'fb000000-0000-0000-0000-000000000042',
   (select id from public.document_categories where is_default limit 1), 'lease', 'b/lease-b.pdf', 'lease-b.pdf', 'application/pdf', 1000, 'bbb222');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001';

-- === Positive: Tenant A can read their own data across every table 20260101000049 touches ===
select is(
  (select count(*) from public.leases where id = 'fb000000-0000-0000-0000-000000000041'),
  1::bigint, 'Tenant A can SELECT their own lease'
);
select is(
  (select count(*) from public.rent_schedules where lease_id = 'fb000000-0000-0000-0000-000000000041'),
  1::bigint, 'Tenant A can SELECT their own rent_schedules row'
);
select is(
  (select count(*) from public.invoices where id = 'fb000000-0000-0000-0000-000000000051'),
  1::bigint, 'Tenant A can SELECT their own invoice'
);
select is(
  (select count(*) from public.maintenance_tickets where id = 'fb000000-0000-0000-0000-000000000061'),
  1::bigint, 'Tenant A can SELECT their own maintenance ticket'
);
select is(
  (select count(*) from public.documents where id = 'fb000000-0000-0000-0000-000000000071'),
  1::bigint, 'Tenant A can SELECT their own lease-tagged document'
);
select is(
  (select count(*) from public.units where id = 'fb000000-0000-0000-0000-000000000021'),
  1::bigint, 'Tenant A can SELECT their own unit'
);
select is(
  (select count(*) from public.properties where id = 'fb000000-0000-0000-0000-000000000011'),
  1::bigint, 'Tenant A can SELECT their own property'
);

-- === Negative: Tenant A gets zero rows for every one of Tenant B's, by direct id ===
select is(
  (select count(*) from public.leases where id = 'fb000000-0000-0000-0000-000000000042'),
  0::bigint, 'Tenant A CANNOT SELECT Tenant B''s lease'
);
select is(
  (select count(*) from public.lease_tenants where tenant_id = 'fb000000-0000-0000-0000-000000000032'),
  0::bigint, 'Tenant A CANNOT SELECT Tenant B''s lease_tenants row'
);
select is(
  (select count(*) from public.rent_schedules where lease_id = 'fb000000-0000-0000-0000-000000000042'),
  0::bigint, 'Tenant A CANNOT SELECT Tenant B''s rent_schedules row'
);
select is(
  (select count(*) from public.invoices where id = 'fb000000-0000-0000-0000-000000000052'),
  0::bigint, 'Tenant A CANNOT SELECT Tenant B''s invoice'
);
select is(
  (select count(*) from public.maintenance_tickets where id = 'fb000000-0000-0000-0000-000000000062'),
  0::bigint, 'Tenant A CANNOT SELECT Tenant B''s maintenance ticket'
);
select is(
  (select count(*) from public.documents where id = 'fb000000-0000-0000-0000-000000000072'),
  0::bigint, 'Tenant A CANNOT SELECT Tenant B''s lease-tagged document'
);
select is(
  (select count(*) from public.units where id = 'fb000000-0000-0000-0000-000000000022'),
  0::bigint, 'Tenant A CANNOT SELECT Tenant B''s unit'
);
select is(
  (select count(*) from public.properties where id = 'fb000000-0000-0000-0000-000000000012'),
  0::bigint, 'Tenant A CANNOT SELECT Tenant B''s property'
);

-- Aggregate sanity check: with RLS applied, Tenant A's total visible row count across the two
-- tenant-scoped tables most likely to leak via a missing WHERE (leases, maintenance_tickets) is
-- exactly 1 each -- not "1 visible + 1 silently-filtered-but-still-summed" or similar.
select is((select count(*) from public.leases), 1::bigint, 'Tenant A sees exactly one lease total (not both)');
select is((select count(*) from public.maintenance_tickets), 1::bigint, 'Tenant A sees exactly one maintenance ticket total (not both)');

-- === Negative: Tenant A cannot submit a maintenance ticket impersonating Tenant B ===
-- maintenance_tickets_insert_tenant_self's WITH CHECK requires submitted_by_tenant_id (and
-- tenant_id) to be one of the caller's OWN tenant ids (caller_tenant_ids()) -- Tenant A is
-- authenticated as fa...001, whose only tenant id is ...031, so a row claiming Tenant B's
-- ...032 id must be rejected by RLS, not merely hidden afterward.
select throws_ok(
  $$ insert into public.maintenance_tickets (org_id, property_id, unit_id, submitted_by_tenant_id, tenant_id, summary)
     values ('fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000012',
             'fb000000-0000-0000-0000-000000000022', 'fb000000-0000-0000-0000-000000000032',
             'fb000000-0000-0000-0000-000000000032', 'Impersonation attempt') $$,
  '42501',
  null,
  'Tenant A cannot INSERT a maintenance ticket submitted_by_tenant_id = Tenant B''s tenant id'
);

select * from finish();
rollback;
