-- Tests for migration 20260101000106 (WhatsApp V1 completion pass, pre-Meta-template-approval):
-- payment_reports (tenant/staff reporting, accountant-only confirm/reject, no ledger side effects)
-- and phone_verification_challenges (ownership-gated OTP request/confirm/revoke).

begin;
select plan(25);

insert into auth.users (id, email) values
  ('fa000000-0000-0000-0000-000000000001', 'fa-agent@test.propertyvault.example'),
  ('fa000000-0000-0000-0000-000000000002', 'fa-accountant@test.propertyvault.example'),
  ('fa000000-0000-0000-0000-000000000003', 'fa-tenant@test.propertyvault.example'),
  ('fa000000-0000-0000-0000-000000000004', 'fa-other-tenant@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values ('fa111111-0000-0000-0000-000000000001', 'FA Test Org', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('fa111111-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  ('fa111111-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000002', 'accountant', 'active', now());

insert into public.properties (id, org_id, owner_user_id, nickname, address_line1, city, province, postal_code)
values ('fa222222-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001', 'FA Test Property', '1 Test St', 'Cape Town', 'Western Cape', '8001');

insert into public.units (id, property_id, org_id, unit_label)
values ('fa333333-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000001', 'Unit 1');

insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status)
values ('fa444444-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000001', 'fa333333-0000-0000-0000-000000000001', current_date - 30, 5000, 'active');

insert into public.tenants (id, org_id, full_name, status, user_id)
values ('fa555555-0000-0000-0000-000000000001', 'fa111111-0000-0000-0000-000000000001', 'FA Test Tenant', 'active', 'fa000000-0000-0000-0000-000000000003');

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
values ('fa444444-0000-0000-0000-000000000001', 'fa555555-0000-0000-0000-000000000001', true);

-- === payment_reports: tenant self-insert ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000003';

insert into public.payment_reports (org_id, property_id, lease_id, tenant_id, reported_by_tenant, reported_by_user_id, amount, payment_method, payment_date)
values ('fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000001', 'fa444444-0000-0000-0000-000000000001', 'fa555555-0000-0000-0000-000000000001', true, 'fa000000-0000-0000-0000-000000000003', 5000, 'eft', current_date);

select is(
  (select status from public.payment_reports where lease_id = 'fa444444-0000-0000-0000-000000000001'),
  'reported'::public.payment_report_status,
  'tenant-reported payment starts in status reported, never auto-confirmed'
);

select throws_ok(
  $$ insert into public.payment_reports (org_id, property_id, lease_id, tenant_id, reported_by_tenant, reported_by_user_id, amount, payment_method, payment_date)
     values ('fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000001', 'fa444444-0000-0000-0000-000000000001', 'fa555555-0000-0000-0000-000000000001', true, 'fa000000-0000-0000-0000-000000000004', 1000, 'eft', current_date) $$,
  '42501',
  null,
  'a tenant cannot insert a payment report claiming another user reported it'
);

reset role;

-- === payment_reports: staff insert (cash) ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001';

insert into public.payment_reports (org_id, property_id, lease_id, tenant_id, reported_by_tenant, reported_by_user_id, amount, payment_method, payment_date)
values ('fa111111-0000-0000-0000-000000000001', 'fa222222-0000-0000-0000-000000000001', 'fa444444-0000-0000-0000-000000000001', 'fa555555-0000-0000-0000-000000000001', false, 'fa000000-0000-0000-0000-000000000001', 5000, 'cash', current_date);

select is(
  (select count(*) from public.payment_reports where reported_by_tenant = false),
  1::bigint,
  'agent+ staff can report a cash payment on the tenant''s behalf'
);

reset role;

-- === confirm_payment_report: forbidden for non-accountant, allowed for accountant, idempotent ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000001'; -- agent, not accountant

select is(
  (select success from public.confirm_payment_report(
    (select id from public.payment_reports where reported_by_tenant = true limit 1)
  )),
  false,
  'an agent (not accountant+) cannot confirm a payment report'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000002'; -- accountant

select is(
  (select success from public.confirm_payment_report(
    (select id from public.payment_reports where reported_by_tenant = true limit 1)
  )),
  true,
  'an accountant+ can confirm a reported payment'
);

select is(
  (select status from public.payment_reports where reported_by_tenant = true limit 1),
  'confirmed'::public.payment_report_status,
  'confirm_payment_report actually flips status to confirmed'
);

select is(
  (select success from public.confirm_payment_report(
    (select id from public.payment_reports where reported_by_tenant = true limit 1)
  )),
  true,
  'confirming an already-confirmed report is idempotent (no-op success)'
);

-- The core safety property this whole migration exists to preserve: confirming a payment_report
-- must NEVER touch rent_schedules or post to the ledger -- that remains a completely separate,
-- unchanged step (confirm_cash_receipt_deposit/confirm_bank_transaction_match).
select is(
  (select count(*) from public.rent_schedules where lease_id = 'fa444444-0000-0000-0000-000000000001'),
  0::bigint,
  'confirm_payment_report never creates or touches any rent_schedules row'
);

select is(
  (select count(*) from public.cash_receipts where lease_id = 'fa444444-0000-0000-0000-000000000001'),
  0::bigint,
  'confirm_payment_report never creates a cash_receipts row -- no duplicate/parallel accounting path'
);

-- reject_payment_report on the still-'reported' cash report
select is(
  (select success from public.reject_payment_report(
    (select id from public.payment_reports where reported_by_tenant = false limit 1),
    'Duplicate of an already-confirmed EFT payment'
  )),
  true,
  'an accountant+ can reject a reported payment with a reason'
);

select is(
  (select status from public.payment_reports where reported_by_tenant = false limit 1),
  'rejected'::public.payment_report_status,
  'reject_payment_report flips status to rejected'
);

select throws_ok(
  $$ select * from public.reject_payment_report(
       (select id from public.payment_reports where reported_by_tenant = false limit 1), null
     ) $$,
  'P0001',
  null,
  'reject_payment_report requires a non-null reason'
);

reset role;

-- Audit logging for confirm/reject happens at the application layer (writeAuditEvent() with the
-- service-role client), not inside these SECURITY INVOKER RPCs -- audit_events has no client
-- insert policy at all, matching cash_receipts' own confirm RPC's identical posture. Covered by
-- the route-level Vitest tests, not here.

-- === payment_reports: org isolation ===
insert into public.organizations (id, legal_name, org_type)
values ('fa111111-0000-0000-0000-000000000002', 'FA Test Org B', 'agency');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('fa111111-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-000000000004', 'accountant', 'active', now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000004';

select is(
  (select count(*) from public.payment_reports where lease_id = 'fa444444-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B staff cannot see Org A''s payment_reports rows'
);

reset role;

-- === phone_verification_challenges: ownership-gated request/confirm/revoke ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000004'; -- NOT the tenant

select is(
  (select error_code from public.request_phone_verification('tenant', 'fa555555-0000-0000-0000-000000000001', '+27821234567')),
  'forbidden',
  'a caller cannot request phone verification for a tenant that is not their own'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000003'; -- the real tenant

select is(
  (select error_code from public.request_phone_verification('tenant', 'fa555555-0000-0000-0000-000000000001', 'not-a-real-number')),
  'invalid_phone',
  'a malformed phone number is rejected before any challenge is created'
);

select is(
  (select count(*) from public.phone_verification_challenges),
  0::bigint,
  'the malformed-phone request created no challenge row'
);

reset role;
insert into public.phone_verification_challenges (id, entity_type, entity_id, phone_number_e164, otp_hash, expires_at, requested_by_user_id)
values ('fa666666-0000-0000-0000-000000000001', 'tenant', 'fa555555-0000-0000-0000-000000000001', '+27821234567', encode(digest('123456', 'sha256'), 'hex'), now() + interval '10 minutes', 'fa000000-0000-0000-0000-000000000003');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000004'; -- NOT the requester

select is(
  (select error_code from public.confirm_phone_verification('fa666666-0000-0000-0000-000000000001', '123456')),
  'forbidden',
  'only the original requester can confirm their own OTP challenge, even with the correct code'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000003';

select is(
  (select success from public.confirm_phone_verification('fa666666-0000-0000-0000-000000000001', '000000')),
  false,
  'a wrong OTP code is rejected'
);

-- phone_verification_challenges has zero client select policies (deliberate privileged-table
-- pattern, matching verified_phone_numbers) -- must reset to the superuser role to inspect it
-- directly, same as every other privileged-table check in this suite (email_whatsapp_isolation
-- .test.sql's own verified_phone_numbers/whatsapp_conversation_state checks do the same).
reset role;
select is(
  (select attempts_used from public.phone_verification_challenges where id = 'fa666666-0000-0000-0000-000000000001'),
  1,
  'a wrong attempt increments attempts_used (bounded brute-force budget)'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000003';

select is(
  (select success from public.confirm_phone_verification('fa666666-0000-0000-0000-000000000001', '123456')),
  true,
  'the correct OTP code succeeds'
);

reset role;
select is(
  (select count(*) from public.verified_phone_numbers where entity_type = 'tenant' and entity_id = 'fa555555-0000-0000-0000-000000000001' and phone_number_e164 = '+27821234567'),
  1::bigint,
  'a successful confirmation populates verified_phone_numbers'
);

-- revoke, ownership-gated the same way
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000004';

select is(
  (select error_code from public.revoke_verified_phone_number('tenant', 'fa555555-0000-0000-0000-000000000001', '+27821234567')),
  'forbidden',
  'only the entity owner can revoke their own verified phone number'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'fa000000-0000-0000-0000-000000000003';

select is(
  (select success from public.revoke_verified_phone_number('tenant', 'fa555555-0000-0000-0000-000000000001', '+27821234567')),
  true,
  'the entity owner can revoke their own verified phone number'
);

reset role;
select is(
  (select count(*) from public.verified_phone_numbers where entity_type = 'tenant' and entity_id = 'fa555555-0000-0000-0000-000000000001'),
  0::bigint,
  'revocation actually removes the verified_phone_numbers row'
);

-- === anon cannot call any of the SECURITY DEFINER phone-verification RPCs ===
reset role;
set local role anon;

select throws_ok(
  $$ select public.request_phone_verification('tenant', 'fa555555-0000-0000-0000-000000000001', '+27821234567') $$,
  '42501',
  null,
  'anon cannot call request_phone_verification at all -- EXECUTE was explicitly revoked'
);

reset role;

select * from finish();
rollback;
