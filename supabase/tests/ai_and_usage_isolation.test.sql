-- RLS isolation tests for ai_conversations, ai_messages, portfolio_insights, usage_events,
-- usage_snapshots (TASKS.md M18, migration 20260101000042), plus a schema-shape regression check
-- for the audit_events TD-14 cutover (migration 20260101000043) -- confirmed live via
-- information_schema rather than assumed, matching this session's established verification
-- discipline for schema changes.

begin;
select plan(19);

insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000001', 'ai-org-a-principal@test.propertyvault.example'),
  ('ad000000-0000-0000-0000-000000000002', 'ai-org-a-agent@test.propertyvault.example'),
  ('ad000000-0000-0000-0000-000000000003', 'ai-org-b-principal@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('ae000000-1111-0000-0000-000000000001', 'AI Test Org A', 'agency'),
  ('ae000000-1111-0000-0000-000000000002', 'AI Test Org B', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('ae000000-1111-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('ae000000-1111-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000002', 'agent', 'active', now()),
  ('ae000000-1111-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000003', 'principal', 'active', now());

-- === ai_conversations / ai_messages: owner-only, not org-shared ===
set local role authenticated;
set local "request.jwt.claim.sub" = 'ad000000-0000-0000-0000-000000000001';

insert into public.ai_conversations (id, org_id, user_id)
values ('af000000-0000-0000-0000-000000000001', 'ae000000-1111-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000001');

select is(
  (select count(*) from public.ai_conversations where id = 'af000000-0000-0000-0000-000000000001'),
  1::bigint,
  'the conversation owner can select their own conversation'
);

insert into public.ai_messages (id, conversation_id, role, content)
values ('af000000-0000-0000-0000-000000000002', 'af000000-0000-0000-0000-000000000001', 'user', 'What is overdue?');

select is(
  (select count(*) from public.ai_messages where id = 'af000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the conversation owner can insert/select their own message'
);

set local "request.jwt.claim.sub" = 'ad000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.ai_conversations where id = 'af000000-0000-0000-0000-000000000001'),
  0::bigint,
  'a different member of the SAME org cannot see another member''s conversation'
);

select is(
  (select count(*) from public.ai_messages where id = 'af000000-0000-0000-0000-000000000002'),
  0::bigint,
  'a different member of the SAME org cannot see another member''s message'
);

select throws_ok(
  $$ insert into public.ai_messages (conversation_id, role, content)
     values ('af000000-0000-0000-0000-000000000001', 'user', 'trying to inject into someone else''s conversation') $$,
  '42501'
);

set local "request.jwt.claim.sub" = 'ad000000-0000-0000-0000-000000000003';

select is(
  (select count(*) from public.ai_conversations where id = 'af000000-0000-0000-0000-000000000001'),
  0::bigint,
  'a member of a DIFFERENT org cannot see the conversation either'
);

-- === portfolio_insights: rules-engine-only insert, org-shared select, viewer+ dismiss ===
reset role;
insert into public.portfolio_insights (id, org_id, insight_type, message, data_source, severity)
values (
  'af000000-0000-0000-0000-000000000003',
  'ae000000-1111-0000-0000-000000000001',
  'rent_overdue',
  'Rent of 1000 is 5 days overdue.',
  '{"insight_type": "rent_overdue", "triggering_records": [{"table": "rent_schedules", "id": "af000000-0000-0000-0000-000000000004"}]}'::jsonb,
  'warning'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'ad000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.portfolio_insights where id = 'af000000-0000-0000-0000-000000000003'),
  1::bigint,
  'org staff can select a portfolio insight for their own org'
);

select throws_ok(
  $$ insert into public.portfolio_insights (org_id, insight_type, message, data_source, severity)
     values ('ae000000-1111-0000-0000-000000000001', 'rent_overdue', 'forged', '{}'::jsonb, 'info') $$,
  '42501'
);

select lives_ok(
  $$ update public.portfolio_insights set dismissed_at = now() where id = 'af000000-0000-0000-0000-000000000003' $$,
  'org staff (viewer+) can dismiss an insight for their own org'
);

set local "request.jwt.claim.sub" = 'ad000000-0000-0000-0000-000000000003';

select is(
  (select count(*) from public.portfolio_insights where id = 'af000000-0000-0000-0000-000000000003'),
  0::bigint,
  'a member of a different org cannot see the insight'
);

-- === usage_events: server-only insert, org-scoped select ===
reset role;
insert into public.usage_events (id, org_id, usage_type, quantity, related_entity_type, related_entity_id)
values (
  'af000000-0000-0000-0000-000000000005',
  'ae000000-1111-0000-0000-000000000001',
  'ai_token',
  120,
  'ai_conversation',
  'af000000-0000-0000-0000-000000000001'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'ad000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.usage_events where id = 'af000000-0000-0000-0000-000000000005'),
  1::bigint,
  'org staff can select their own org''s usage_events row'
);

select throws_ok(
  $$ insert into public.usage_events (org_id, usage_type, quantity)
     values ('ae000000-1111-0000-0000-000000000001', 'ai_token', 1) $$,
  '42501'
);

set local "request.jwt.claim.sub" = 'ad000000-0000-0000-0000-000000000003';

select is(
  (select count(*) from public.usage_events where id = 'af000000-0000-0000-0000-000000000005'),
  0::bigint,
  'a member of a different org cannot see the usage_events row'
);

-- === usage_snapshots: server-only insert, org-scoped select ===
reset role;
insert into public.usage_snapshots (id, org_id, period, usage_type, total_quantity)
values (
  'af000000-0000-0000-0000-000000000006',
  'ae000000-1111-0000-0000-000000000001',
  date_trunc('month', current_date)::date,
  'ai_token',
  120
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'ad000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.usage_snapshots where id = 'af000000-0000-0000-0000-000000000006'),
  1::bigint,
  'org staff can select their own org''s usage_snapshots row'
);

select throws_ok(
  $$ insert into public.usage_snapshots (org_id, period, usage_type, total_quantity)
     values ('ae000000-1111-0000-0000-000000000001', current_date, 'ai_token', 1) $$,
  '42501'
);

-- === audit_events TD-14 cutover: schema-shape regression check, confirmed live not assumed ===
reset role;

select is(
  (select count(*)::int from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_events' and column_name = 'owner_user_id'),
  0,
  'audit_events.owner_user_id was dropped by the TD-14 cutover'
);

select is(
  (select count(*)::int from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_events' and column_name = 'target_type'),
  0,
  'audit_events.target_type was renamed away (no longer exists)'
);

select is(
  (select count(*)::int from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_events' and column_name in ('entity_type', 'entity_id', 'before', 'after', 'ip_address', 'ai_conversation_id', 'ai_message_id')),
  7,
  'audit_events has all seven DATABASE.md §10 target-shape columns'
);

insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, ai_conversation_id, ai_message_id)
values (
  'ae000000-1111-0000-0000-000000000001',
  'ad000000-0000-0000-0000-000000000001',
  'ai_assisted',
  'expense.create',
  'expenses',
  gen_random_uuid(),
  'af000000-0000-0000-0000-000000000001',
  'af000000-0000-0000-0000-000000000002'
);

select is(
  (select count(*) from public.audit_events where actor_type = 'ai_assisted' and ai_conversation_id = 'af000000-0000-0000-0000-000000000001'),
  1::bigint,
  'audit_events accepts the new ai_assisted actor_type with ai_conversation_id/ai_message_id pointers'
);

select * from finish();
rollback;
