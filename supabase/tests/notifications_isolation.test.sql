-- RLS isolation tests for notifications, notification_preferences, device_push_tokens,
-- announcements, announcement_reads (TASKS.md M15, migration 20260101000039). Focused specifically
-- on the two behaviors genuinely new to this milestone: user-scoped-not-org-scoped tables
-- (notifications/preferences/push-tokens), and the tenant self-access carve-out for announcements
-- being scoped by which property a tenant actually leases (portfolio-wide vs. property-specific).

begin;
select plan(13);

insert into auth.users (id, email) values
  ('ab000000-0000-0000-0000-000000000001', 'notif-agent-a@test.propertyvault.example'),
  ('ab000000-0000-0000-0000-000000000002', 'notif-agent-b@test.propertyvault.example'),
  ('ab000000-0000-0000-0000-000000000003', 'notif-tenant-leased@test.propertyvault.example'),
  ('ab000000-0000-0000-0000-000000000004', 'notif-tenant-other-property@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values ('ac000000-1111-0000-0000-000000000001', 'Notif Test Org A', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('ac000000-1111-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001', 'agent', 'active', now());

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values
  ('ac000000-2222-0000-0000-000000000001', 'ac000000-1111-0000-0000-000000000001', 'Notif Property A', '1 Test St', 'Cape Town', 'ZA', 'house'),
  ('ac000000-2222-0000-0000-000000000002', 'ac000000-1111-0000-0000-000000000001', 'Notif Property B', '2 Test St', 'Cape Town', 'ZA', 'house');

insert into public.units (id, property_id, org_id, unit_label, status)
values
  ('ac000000-3333-0000-0000-000000000001', 'ac000000-2222-0000-0000-000000000001', 'ac000000-1111-0000-0000-000000000001', 'Unit A', 'occupied'),
  ('ac000000-3333-0000-0000-000000000002', 'ac000000-2222-0000-0000-000000000002', 'ac000000-1111-0000-0000-000000000001', 'Unit B', 'occupied');

insert into public.tenants (id, org_id, user_id, full_name, status)
values
  ('ac000000-4444-0000-0000-000000000001', 'ac000000-1111-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000003', 'Tenant Leased', 'active'),
  ('ac000000-4444-0000-0000-000000000002', 'ac000000-1111-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000004', 'Tenant Other Property', 'active');

insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status, source)
values
  ('ac000000-5555-0000-0000-000000000001', 'ac000000-1111-0000-0000-000000000001', 'ac000000-3333-0000-0000-000000000001', current_date, 5000, 'active', 'manual'),
  ('ac000000-5555-0000-0000-000000000002', 'ac000000-1111-0000-0000-000000000001', 'ac000000-3333-0000-0000-000000000002', current_date, 5000, 'active', 'manual');

insert into public.lease_tenants (lease_id, tenant_id, is_primary)
values
  ('ac000000-5555-0000-0000-000000000001', 'ac000000-4444-0000-0000-000000000001', true),
  ('ac000000-5555-0000-0000-000000000002', 'ac000000-4444-0000-0000-000000000002', true);

-- === notifications: user-scoped, no client insert policy at all ===
insert into public.notifications (id, user_id, type, title)
values ('ac000000-6666-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001', 'test', 'Test Notification');

set local role authenticated;
set local "request.jwt.claim.sub" = 'ab000000-0000-0000-0000-000000000001';

select is(
  (select title from public.notifications where id = 'ac000000-6666-0000-0000-000000000001'),
  'Test Notification',
  'a user can select their own notification'
);

set local "request.jwt.claim.sub" = 'ab000000-0000-0000-0000-000000000002';
select is(
  (select count(*) from public.notifications where id = 'ac000000-6666-0000-0000-000000000001'),
  0::bigint,
  'a different user cannot see someone else''s notification'
);

select throws_ok(
  $$ insert into public.notifications (user_id, type, title)
     values ('ab000000-0000-0000-0000-000000000002', 'test', 'Self-inserted notification') $$,
  '42501'
);

set local "request.jwt.claim.sub" = 'ab000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ update public.notifications set read_at = now() where id = 'ac000000-6666-0000-0000-000000000001' $$,
  'a user can mark their own notification read'
);

-- === notification_preferences / device_push_tokens: user-scoped, self-managed ===
select lives_ok(
  $$ insert into public.notification_preferences (user_id, category, whatsapp_enabled)
     values ('ab000000-0000-0000-0000-000000000001', 'rent', false) $$,
  'a user can set their own notification preference'
);

select lives_ok(
  $$ insert into public.device_push_tokens (user_id, platform, token)
     values ('ab000000-0000-0000-0000-000000000001', 'ios', 'test-device-token') $$,
  'a user can register their own push token'
);

select lives_ok(
  $$ delete from public.device_push_tokens where token = 'test-device-token' $$,
  'a user can delete their own push token (the one legitimate client DELETE in this migration)'
);

-- === announcements: portfolio-wide vs property-scoped tenant visibility ===
set local "request.jwt.claim.sub" = 'ab000000-0000-0000-0000-000000000001';

insert into public.announcements (id, org_id, property_id, title, body)
values ('ac000000-7777-0000-0000-000000000001', 'ac000000-1111-0000-0000-000000000001', null, 'Portfolio-wide notice', 'Applies to everyone');

insert into public.announcements (id, org_id, property_id, title, body)
values ('ac000000-7777-0000-0000-000000000002', 'ac000000-1111-0000-0000-000000000001', 'ac000000-2222-0000-0000-000000000001', 'Property A only notice', 'Applies to Property A tenants only');

set local "request.jwt.claim.sub" = 'ab000000-0000-0000-0000-000000000003';

select is(
  (select count(*) from public.announcements where id = 'ac000000-7777-0000-0000-000000000001'),
  1::bigint,
  'the tenant leasing Property A can see the portfolio-wide announcement'
);

select is(
  (select count(*) from public.announcements where id = 'ac000000-7777-0000-0000-000000000002'),
  1::bigint,
  'the tenant leasing Property A can see the Property-A-scoped announcement'
);

set local "request.jwt.claim.sub" = 'ab000000-0000-0000-0000-000000000004';

select is(
  (select count(*) from public.announcements where id = 'ac000000-7777-0000-0000-000000000001'),
  1::bigint,
  'the tenant leasing Property B can still see the portfolio-wide announcement'
);

select is(
  (select count(*) from public.announcements where id = 'ac000000-7777-0000-0000-000000000002'),
  0::bigint,
  'the tenant leasing Property B (not A) cannot see the Property-A-scoped announcement'
);

-- === announcement_reads: tenant writes their own acknowledgement ===
select lives_ok(
  $$ insert into public.announcement_reads (announcement_id, tenant_id, read_at, acknowledged_at)
     values ('ac000000-7777-0000-0000-000000000001', 'ac000000-4444-0000-0000-000000000002', now(), now()) $$,
  'a tenant can write their own read/acknowledgement receipt'
);

set local "request.jwt.claim.sub" = 'ab000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.announcement_reads where announcement_id = 'ac000000-7777-0000-0000-000000000001'),
  1::bigint,
  'org staff can see the tenant''s acknowledgement receipt'
);

select * from finish();
rollback;
