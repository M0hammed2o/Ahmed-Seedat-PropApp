-- Overnight platform pass (WORKLOG.md this date), Phase 15: accept_organization_invite(),
-- revoke_organization_invite(), update_organization_member_role(), and revoke_organization_member()
-- shipped with zero audit_events coverage (20260101000089/090) -- confirmed by grep, closed in
-- 20260101000092. Proves each RPC actually writes the expected audit_events row, not just that it
-- performs its primary effect (already covered by owner_self_link_and_staff_invitations.test.sql).

begin;
select plan(5);

insert into auth.users (id, email) values
  ('e5000000-0000-0000-0000-000000000001', 'sial-principal@test.propertyvault.example'),
  ('e5000000-0000-0000-0000-000000000002', 'sial-staff@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'e5000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Staff Audit Test Org', 'agency')), null, 'org created');
select set_config('pgtap.sial.org_id', (select id::text from public.organizations where legal_name = 'Staff Audit Test Org'), false);

insert into public.organization_invites (org_id, email, role, invited_by)
values (current_setting('pgtap.sial.org_id')::uuid, 'sial-staff@test.propertyvault.example', 'agent', 'e5000000-0000-0000-0000-000000000001')
returning id;
select set_config('pgtap.sial.invite_id', (select id::text from public.organization_invites where email = 'sial-staff@test.propertyvault.example'), false);
select set_config('pgtap.sial.invite_token', (select token::text from public.organization_invites where id = current_setting('pgtap.sial.invite_id')::uuid), false);

set local "request.jwt.claim.sub" = 'e5000000-0000-0000-0000-000000000002';
select public.accept_organization_invite(current_setting('pgtap.sial.invite_token')::uuid);

select is(
  (select count(*)::int from public.audit_events where action = 'organization_invite.accepted' and entity_id = current_setting('pgtap.sial.invite_id')::uuid),
  1,
  'accept_organization_invite() writes an organization_invite.accepted audit event'
);

set local "request.jwt.claim.sub" = 'e5000000-0000-0000-0000-000000000001';
select public.update_organization_member_role(current_setting('pgtap.sial.org_id')::uuid, 'e5000000-0000-0000-0000-000000000002', 'accountant');
select is(
  (select count(*)::int from public.audit_events where action = 'staff.role_changed' and entity_id = 'e5000000-0000-0000-0000-000000000002'),
  1,
  'update_organization_member_role() writes a staff.role_changed audit event'
);

select public.revoke_organization_member(current_setting('pgtap.sial.org_id')::uuid, 'e5000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.audit_events where action = 'staff.removed' and entity_id = 'e5000000-0000-0000-0000-000000000002'),
  1,
  'revoke_organization_member() writes a staff.removed audit event'
);

insert into public.organization_invites (org_id, email, role, invited_by)
values (current_setting('pgtap.sial.org_id')::uuid, 'sial-second@test.propertyvault.example', 'viewer', 'e5000000-0000-0000-0000-000000000001')
returning id;
select set_config('pgtap.sial.invite2_id', (select id::text from public.organization_invites where email = 'sial-second@test.propertyvault.example'), false);
select public.revoke_organization_invite(current_setting('pgtap.sial.invite2_id')::uuid);
select is(
  (select count(*)::int from public.audit_events where action = 'organization_invite.revoked' and entity_id = current_setting('pgtap.sial.invite2_id')::uuid),
  1,
  'revoke_organization_invite() writes an organization_invite.revoked audit event'
);

select * from finish();
rollback;
