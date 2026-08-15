-- Tests for TASKS.md M16/M17 schema (migration 20260101000040), focused specifically on
-- resolve_whatsapp_sender() -- WHATSAPP.md §1.2's resolution algorithm and "the hard problem this
-- entire document designs around." Proves all three branches (0/1/2+ matches ->
-- UNAUTHENTICATED/RESOLVED/AMBIGUOUS) with real data, plus the "zero client access" guarantee on
-- verified_phone_numbers/whatsapp_conversation_state and org isolation on email_messages/
-- whatsapp_messages.

begin;
select plan(15);

insert into auth.users (id, email) values
  ('ea000000-0000-0000-0000-000000000001', 'ew-agent-a@test.propertyvault.example'),
  ('ea000000-0000-0000-0000-000000000002', 'ew-agent-b@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('ea111111-0000-0000-0000-000000000001', 'EW Test Org A', 'agency'),
  ('ea111111-0000-0000-0000-000000000002', 'EW Test Org B', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('ea111111-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  ('ea111111-0000-0000-0000-000000000002', 'ea000000-0000-0000-0000-000000000002', 'agent', 'active', now());

insert into public.tenants (id, org_id, full_name, status)
values ('ea222222-0000-0000-0000-000000000001', 'ea111111-0000-0000-0000-000000000001', 'EW Test Tenant', 'active');

insert into public.owners (id, org_id, name, owner_type, status)
values ('ea222222-0000-0000-0000-000000000002', 'ea111111-0000-0000-0000-000000000001', 'EW Test Owner', 'individual', 'active');

-- Fixtures inserted directly (superuser context, before any role switch) since
-- verified_phone_numbers has zero client policies by design -- matching every other
-- privileged-table fixture pattern in this test suite.
insert into public.verified_phone_numbers (org_id, entity_type, entity_id, phone_number_e164)
values
  -- Unregistered number: +27000000001 (used in test 1, no row for it at all)
  -- Resolves to exactly one entity:
  ('ea111111-0000-0000-0000-000000000001', 'tenant', 'ea222222-0000-0000-0000-000000000001', '+27000000002'),
  -- Ambiguous: the same number is verified to BOTH a tenant and an owner record (a real,
  -- expected case per WHATSAPP.md §1.2 -- "the same person can legitimately be both").
  ('ea111111-0000-0000-0000-000000000001', 'tenant', 'ea222222-0000-0000-0000-000000000001', '+27000000003'),
  ('ea111111-0000-0000-0000-000000000001', 'owner', 'ea222222-0000-0000-0000-000000000002', '+27000000003');

-- === resolve_whatsapp_sender(): all three branches ===
select is(
  (select count(*) from public.resolve_whatsapp_sender('+27000000001')),
  0::bigint,
  'UNAUTHENTICATED: an unregistered number resolves to zero matches'
);

select is(
  (select count(*) from public.resolve_whatsapp_sender('+27000000002')),
  1::bigint,
  'RESOLVED: a number verified to exactly one entity resolves to exactly one match'
);

select is(
  (select entity_type from public.resolve_whatsapp_sender('+27000000002')),
  'tenant'::public.verified_phone_entity_type,
  'RESOLVED: the single match correctly identifies the entity_type'
);

select is(
  (select count(*) from public.resolve_whatsapp_sender('+27000000003')),
  2::bigint,
  'AMBIGUOUS: a number verified to two different entities resolves to two matches, never picked automatically'
);

select is(
  (select count(distinct entity_type) from public.resolve_whatsapp_sender('+27000000003')),
  2::bigint,
  'AMBIGUOUS: the two matches are genuinely distinct entity types (tenant and owner), not a duplicate row'
);

-- === resolve_whatsapp_sender(): the real, serious access-control fix. Tests 1-5 above ran as the
--     postgres superuser (this file's default context, before any role switch) -- superuser
--     bypasses GRANT/REVOKE entirely, so those tests prove the function's *logic* but say nothing
--     about who is allowed to call it. This is the actual regression guard for the fix: a blanket
--     `alter default privileges ... grant execute ... to anon, authenticated` (20260101000024)
--     meant this function -- which discloses which org/entity owns ANY phone number, unscoped --
--     was callable by every authenticated user, and even fully-unauthenticated anon, before the
--     explicit REVOKE in 20260101000040. ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'ea000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select public.resolve_whatsapp_sender('+27000000002') $$,
  '42501',
  'permission denied for function resolve_whatsapp_sender',
  'an ordinary authenticated user (not the service role) cannot call resolve_whatsapp_sender() at all -- EXECUTE was explicitly revoked, closing a real cross-tenant information-disclosure vector'
);

-- === verified_phone_numbers / whatsapp_conversation_state: zero client access, by design ===
select is(
  (select count(*) from public.verified_phone_numbers),
  0::bigint,
  'an ordinary authenticated org member reads zero rows from verified_phone_numbers (no policy grants access, even for their own org)'
);

reset role;
insert into public.whatsapp_conversation_state (phone_number_e164, state)
values ('+27000000099', 'awaiting_context_selection');
set local role authenticated;
set local "request.jwt.claim.sub" = 'ea000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.whatsapp_conversation_state),
  0::bigint,
  'an ordinary authenticated org member reads zero rows from whatsapp_conversation_state'
);

-- === email_messages / whatsapp_messages: org-scoped read, zero client write ===
reset role;
insert into public.email_messages (id, org_id, to_address, subject, template_name, status)
values ('ea333333-0000-0000-0000-000000000001', 'ea111111-0000-0000-0000-000000000001', 'tenant@example.com', 'Your invoice is ready', 'invoice_issued', 'queued');

insert into public.whatsapp_messages (id, org_id, direction, to_number, from_number, status)
values ('ea333333-0000-0000-0000-000000000002', 'ea111111-0000-0000-0000-000000000001', 'outbound', '+27000000002', '+27000000000', 'queued');

set local role authenticated;
set local "request.jwt.claim.sub" = 'ea000000-0000-0000-0000-000000000001';

select is(
  (select subject from public.email_messages where id = 'ea333333-0000-0000-0000-000000000001'),
  'Your invoice is ready',
  'org staff can read their own org''s email_messages row'
);

select throws_ok(
  $$ insert into public.email_messages (org_id, to_address, subject, template_name)
     values ('ea111111-0000-0000-0000-000000000001', 'x@example.com', 'x', 'x') $$,
  '42501'
);

set local "request.jwt.claim.sub" = 'ea000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.email_messages where id = 'ea333333-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B cannot see Org A''s email_messages row'
);

select is(
  (select count(*) from public.whatsapp_messages where id = 'ea333333-0000-0000-0000-000000000002'),
  0::bigint,
  'Org B cannot see Org A''s whatsapp_messages row'
);

-- === whatsapp_webhook_events (migration 20260101000105, V1 communications productionisation):
--     same org-scoped-read/zero-client-write posture as email_messages/whatsapp_messages above.
reset role;
insert into public.whatsapp_webhook_events (id, org_id, provider_name, provider_event_id, event_type)
values ('ea333333-0000-0000-0000-000000000003', 'ea111111-0000-0000-0000-000000000001', 'meta', 'wamid-test-1:delivered', 'status:delivered');

set local role authenticated;
set local "request.jwt.claim.sub" = 'ea000000-0000-0000-0000-000000000001';

select is(
  (select event_type from public.whatsapp_webhook_events where id = 'ea333333-0000-0000-0000-000000000003'),
  'status:delivered',
  'org staff can read their own org''s whatsapp_webhook_events row'
);

select throws_ok(
  $$ insert into public.whatsapp_webhook_events (org_id, provider_name, provider_event_id, event_type)
     values ('ea111111-0000-0000-0000-000000000001', 'meta', 'x', 'x') $$,
  '42501'
);

set local "request.jwt.claim.sub" = 'ea000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.whatsapp_webhook_events where id = 'ea333333-0000-0000-0000-000000000003'),
  0::bigint,
  'Org B cannot see Org A''s whatsapp_webhook_events row'
);

select * from finish();
rollback;
