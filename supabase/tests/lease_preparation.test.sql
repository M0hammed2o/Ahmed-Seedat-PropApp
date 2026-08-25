-- Applicant->tenant->lease V1 continuation (WORKLOG.md 2026-08-25), Phases L/N/R/S/V/W/X: proves
-- the review-gate/send/acceptance chain (migration 20260101000134) end to end -- staff-only
-- read/write on lease_preparations/lease_documents, the review gate's own precondition checks, the
-- explicit-send idempotency guarantee, and the tenant-can-only-acknowledge guard.
-- activate_lease()'s own new gate (sent + acknowledged/signed) is covered in
-- leasing_isolation.test.sql; this file focuses on the new RPCs and tables themselves.

begin;
select plan(25);

insert into auth.users (id, email) values
  ('c6000000-0000-0000-0000-000000000001', 'lp-manager@test.propertyvault.example'),
  ('c6000000-0000-0000-0000-000000000002', 'lp-unassigned-agent@test.propertyvault.example'),
  ('c6000000-0000-0000-0000-000000000003', 'lp-tenant@test.propertyvault.example'),
  ('c6000000-0000-0000-0000-000000000004', 'lp-other-org-manager@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000001';
select isnt((select public.create_organization('Lease Prep Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Lease Prep Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000001';
select set_config('pgtap.lp.org_id', (select id::text from public.organizations where legal_name = 'Lease Prep Test Org'), false);

select set_config(
  'pgtap.lp.property_id',
  (select public.create_property(current_setting('pgtap.lp.org_id')::uuid, 'Lease Prep Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type)::text),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
select current_setting('pgtap.lp.property_id')::uuid, current_setting('pgtap.lp.org_id')::uuid, 'U1', 'vacant';
select set_config('pgtap.lp.unit_id', (select id::text from public.units where property_id = current_setting('pgtap.lp.property_id')::uuid), false);

set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000004';
select isnt((select public.create_organization('Lease Prep Other Org', 'agency')), null, 'other org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Lease Prep Other Org'));

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode)
values (current_setting('pgtap.lp.org_id')::uuid, 'c6000000-0000-0000-0000-000000000002', 'agent', 'active', now(), 'selected');
-- deliberately no property_access grant for the unassigned agent

insert into public.tenants (org_id, user_id, full_name, status)
select current_setting('pgtap.lp.org_id')::uuid, 'c6000000-0000-0000-0000-000000000003', 'Lease Prep Tenant', 'active';
select set_config('pgtap.lp.tenant_id', (select id::text from public.tenants where full_name = 'Lease Prep Tenant'), false);

set local role authenticated;
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000001';

insert into public.leases (org_id, unit_id, start_date, rent_amount, deposit_amount, status, source)
select current_setting('pgtap.lp.org_id')::uuid, current_setting('pgtap.lp.unit_id')::uuid, current_date, 0, 0, 'draft', 'application_approved';
select set_config('pgtap.lp.lease_id', (select id::text from public.leases where unit_id = current_setting('pgtap.lp.unit_id')::uuid), false);

-- === Unassigned agent cannot review this lease at all ===
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.acknowledge_lease_review(current_setting('pgtap.lp.lease_id')::uuid) $$,
  null, null,
  'an agent with no property access cannot review this lease'
);

-- === Review gate refuses: no tenant assigned yet ===
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select public.acknowledge_lease_review(current_setting('pgtap.lp.lease_id')::uuid) $$,
  'P0001', 'Assign a tenant before reviewing this lease',
  'the review gate refuses without a tenant assigned'
);

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
values (current_setting('pgtap.lp.lease_id')::uuid, current_setting('pgtap.lp.tenant_id')::uuid, true);

-- === Review gate refuses: rent still zero ===
select throws_ok(
  $$ select public.acknowledge_lease_review(current_setting('pgtap.lp.lease_id')::uuid) $$,
  'P0001', 'Set a rent amount greater than zero before reviewing this lease',
  'the review gate refuses with a zero rent amount'
);

update public.leases set rent_amount = 9000, start_date = '2026-09-01'::date where id = current_setting('pgtap.lp.lease_id')::uuid;

-- === Review gate refuses: no document yet ===
select throws_ok(
  $$ select public.acknowledge_lease_review(current_setting('pgtap.lp.lease_id')::uuid) $$,
  'P0001', 'Generate or upload a lease document before reviewing this lease',
  'the review gate refuses without a lease document'
);

insert into public.lease_documents (lease_id, org_id, kind, status, version, storage_path, mime_type, file_size_bytes)
values (
  current_setting('pgtap.lp.lease_id')::uuid, current_setting('pgtap.lp.org_id')::uuid,
  'generated', 'draft', 1, current_setting('pgtap.lp.org_id') || '/' || current_setting('pgtap.lp.property_id') || '/lease-v1.docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 2048
);

-- === send_lease refuses before review ===
select throws_ok(
  $$ select public.send_lease(current_setting('pgtap.lp.lease_id')::uuid) $$,
  'P0001', 'Complete the review acknowledgement before sending this lease',
  'send_lease refuses before the review acknowledgement'
);

-- === Now the review gate passes ===
select lives_ok(
  $$ select public.acknowledge_lease_review(current_setting('pgtap.lp.lease_id')::uuid) $$,
  'the review gate passes once tenant/rent/dates/document all exist'
);

select is(
  (select status::text from public.lease_preparations where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  'reviewed',
  'lease_preparations.status is reviewed'
);

select isnt(
  (select reviewed_at from public.lease_documents where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  null,
  'the lease_documents row itself was also stamped reviewed'
);

-- === Security fix (migration 20260101000136): a tenant assigned to a draft lease cannot read the
-- leases row itself until it has actually been sent -- reviewed-but-not-sent is still not enough.
-- This gap was a direct, real consequence of approve_application() (this pass's own Phase 15/16
-- change) assigning the tenant to a draft lease immediately -- leases_select_tenant_self predates
-- that and had no status filter at all.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.leases where id = current_setting('pgtap.lp.lease_id')::uuid),
  0,
  'the tenant cannot read the draft lease row itself before it has been sent, even once reviewed'
);
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000001';

-- === Send succeeds, marks the document issued ===
select lives_ok(
  $$ select public.send_lease(current_setting('pgtap.lp.lease_id')::uuid) $$,
  'send_lease succeeds once reviewed'
);

select is(
  (select status::text from public.lease_documents where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  'issued',
  'the lease document is now issued'
);

select is(
  (select status::text from public.lease_preparations where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  'sent',
  'lease_preparations.status is sent'
);

-- === Idempotent resend: no new document row, no error ===
select lives_ok(
  $$ select public.send_lease(current_setting('pgtap.lp.lease_id')::uuid) $$,
  'resending an already-sent lease with no new draft document is a no-op success'
);

select is(
  (select count(*)::int from public.lease_documents where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  1,
  'resending never creates a duplicate lease_documents row'
);

-- === Tenant can read and acknowledge, but not edit anything else ===
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.leases where id = current_setting('pgtap.lp.lease_id')::uuid),
  1,
  'the tenant CAN now read the lease row itself, once it has actually been sent'
);

select is(
  (select count(*)::int from public.lease_preparations where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  1,
  'the tenant can read their own lease_preparations row'
);

select is(
  (select count(*)::int from public.lease_documents where lease_id = current_setting('pgtap.lp.lease_id')::uuid and status = 'issued'),
  1,
  'the tenant can read their own ISSUED lease document'
);

select throws_ok(
  $$ update public.lease_preparations set special_conditions = 'tenant tampering attempt' where lease_id = current_setting('pgtap.lp.lease_id')::uuid $$,
  'P0001', 'A tenant may only acknowledge a lease, not edit it',
  'the tenant cannot edit any field other than their own acknowledgement'
);

select lives_ok(
  $$ update public.lease_preparations set tenant_acknowledged_at = now() where lease_id = current_setting('pgtap.lp.lease_id')::uuid $$,
  'the tenant CAN set their own acknowledgement'
);

select set_config(
  'pgtap.lp.first_ack_at',
  (select tenant_acknowledged_at::text from public.lease_preparations where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  false
);

-- A second attempt is a silent no-op, not an error: the RLS USING clause itself
-- (tenant_acknowledged_at is null) already excludes an already-acknowledged row from the tenant's
-- UPDATE grant, so this affects zero rows rather than reaching the trigger at all -- confirmed by
-- asserting the timestamp is unchanged, not by expecting an exception.
select lives_ok(
  $$ update public.lease_preparations set tenant_acknowledged_at = now() where lease_id = current_setting('pgtap.lp.lease_id')::uuid $$,
  'a second acknowledgement attempt runs without error (RLS silently excludes the row, verified next)'
);

select is(
  (select tenant_acknowledged_at::text from public.lease_preparations where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  current_setting('pgtap.lp.first_ack_at'),
  'the acknowledgement timestamp is unchanged by the second attempt -- not re-acknowledged, not cleared'
);

-- === Cross-org staff sees nothing ===
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c6000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.lease_preparations where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  0,
  'a principal of a different org cannot read this lease_preparations row'
);
select is(
  (select count(*)::int from public.lease_documents where lease_id = current_setting('pgtap.lp.lease_id')::uuid),
  0,
  'a principal of a different org cannot read this lease_documents row'
);

select * from finish();
rollback;
