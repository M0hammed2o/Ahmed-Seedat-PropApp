-- Final pre-UAT engineering pass (WORKLOG.md this date), Part 6/7: ai_conversations_all_own
-- (20260101000109) widened to also allow a caller with an active tenancy in the conversation's
-- org, on top of the pre-existing org-staff (has_org_role) branch. Live-tested, not inferred.

begin;
select plan(8);

insert into auth.users (id, email) values
  ('9b000000-0000-0000-0000-000000000001', 'ai-access-staff@test.propertyvault.example'),
  ('9b000000-0000-0000-0000-000000000002', 'ai-access-tenant@test.propertyvault.example'),
  ('9b000000-0000-0000-0000-000000000003', 'ai-access-outsider@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type, status) values
  ('9b1a0000-0000-0000-0000-000000000001', 'AI Access Test Org', 'agency', 'active');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('9b1a0000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000001', 'principal', 'active', now());

insert into public.tenants (id, org_id, user_id, full_name, status) values
  ('9b2a0000-0000-0000-0000-000000000001', '9b1a0000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000002', 'AI Access Tenant', 'active');

-- === Org staff can create and read their own conversation ===
set local role authenticated;
set local "request.jwt.claim.sub" = '9b000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ insert into public.ai_conversations (id, org_id, user_id) values
     ('9b3a0000-0000-0000-0000-000000000001', '9b1a0000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000001') $$,
  'org staff can create a conversation for their own org'
);
select is(
  (select count(*)::int from public.ai_conversations where id = '9b3a0000-0000-0000-0000-000000000001'),
  1,
  'org staff can read the conversation back'
);

-- === Tenant can create and read their own conversation (the fix this migration makes) ===
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '9b000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ insert into public.ai_conversations (id, org_id, user_id) values
     ('9b3a0000-0000-0000-0000-000000000002', '9b1a0000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000002') $$,
  'a tenant (no organization_members row at all) can now create a conversation for their own tenancy''s org'
);
select is(
  (select count(*)::int from public.ai_conversations where id = '9b3a0000-0000-0000-0000-000000000002'),
  1,
  'the tenant can read their own conversation back'
);
select is(
  (select count(*)::int from public.ai_conversations where id = '9b3a0000-0000-0000-0000-000000000001'),
  0,
  'the tenant cannot see the org staff member''s conversation -- user_id = auth.uid() still scopes per-caller'
);

-- === An outsider (no membership, no tenancy) cannot create a conversation for this org at all ===
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '9b000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ insert into public.ai_conversations (id, org_id, user_id) values
     ('9b3a0000-0000-0000-0000-000000000003', '9b1a0000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'an outsider with no org membership and no tenancy cannot create a conversation for this org'
);
select is(
  (select count(*)::int from public.ai_conversations where user_id = '9b000000-0000-0000-0000-000000000003'),
  0,
  'no conversation row was created for the outsider'
);
select is(
  (select count(*)::int from public.ai_conversations where org_id = '9b1a0000-0000-0000-0000-000000000001'),
  0,
  'an outsider reads zero conversations for an org they have no relationship to at all'
);

select * from finish();
rollback;
