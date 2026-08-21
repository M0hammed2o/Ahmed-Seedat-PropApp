-- Tests for 20260101000074_governance_audit_triggers.sql: log_audit_event_trigger() correctly
-- captures actor/action/before/after on insert and update, and the owner-facing audit_events
-- visibility policy shows an owner exactly their own cash_receipts/maintenance_tickets/
-- owner_statements events, never another owner's or an unrelated entity_type.

begin;
select plan(10);

insert into auth.users (id, email) values
  ('fc000000-0000-0000-0000-000000000001', 'gat-principal@test.propertyvault.example'),
  ('fc000000-0000-0000-0000-000000000002', 'gat-owner@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Governance Audit Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Governance Audit Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000001';

select set_config(
  'pgtap.gat_test.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Governance Audit Test Org'),
    'Governance Audit Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

-- ==== INSERT is captured: a maintenance ticket, with a real before=null/after=row diff ====

insert into public.maintenance_tickets (org_id, property_id, submitted_by_user_id, summary, priority, status)
select id, current_setting('pgtap.gat_test.property_id')::uuid,
  'fc000000-0000-0000-0000-000000000001'::uuid, 'Broken window', 'high', 'to_do'
from public.organizations where legal_name = 'Governance Audit Test Org';

select set_config('pgtap.gat_test.ticket_id', (select id::text from public.maintenance_tickets limit 1), false);

select is(
  (select count(*)::int from public.audit_events
     where entity_type = 'maintenance_tickets' and entity_id = current_setting('pgtap.gat_test.ticket_id')::uuid),
  1,
  'creating a maintenance ticket produces exactly one audit_events row'
);

select is(
  (select actor_user_id from public.audit_events
     where entity_type = 'maintenance_tickets' and entity_id = current_setting('pgtap.gat_test.ticket_id')::uuid),
  'fc000000-0000-0000-0000-000000000001'::uuid,
  'the audit row correctly attributes the real acting user, not a system/null actor'
);

select is(
  (select before from public.audit_events
     where entity_type = 'maintenance_tickets' and entity_id = current_setting('pgtap.gat_test.ticket_id')::uuid),
  null,
  'an INSERT has no before-state'
);

select is(
  (select after->>'status' from public.audit_events
     where entity_type = 'maintenance_tickets' and entity_id = current_setting('pgtap.gat_test.ticket_id')::uuid),
  'to_do',
  'the after-state captures the real inserted row, not a placeholder'
);

-- ==== UPDATE captures a genuine before/after diff ====

update public.maintenance_tickets set status = 'in_progress' where id = current_setting('pgtap.gat_test.ticket_id')::uuid;

select is(
  (select count(*)::int from public.audit_events
     where entity_type = 'maintenance_tickets' and entity_id = current_setting('pgtap.gat_test.ticket_id')::uuid),
  2,
  'the update produces a second audit row (one per mutation, not just on create)'
);

-- created_at is the transaction start time (Postgres now()), identical for both the insert and
-- update rows within this one test transaction -- ordering by it can't disambiguate them.
-- `before is not null` unambiguously identifies the UPDATE row instead (the INSERT row always
-- has before = null).
select is(
  (select before->>'status' from public.audit_events
     where entity_type = 'maintenance_tickets' and entity_id = current_setting('pgtap.gat_test.ticket_id')::uuid
       and before is not null),
  'to_do',
  'the update''s audit row shows the real before status (to_do)'
);

select is(
  (select after->>'status' from public.audit_events
     where entity_type = 'maintenance_tickets' and entity_id = current_setting('pgtap.gat_test.ticket_id')::uuid
       and before is not null),
  'in_progress',
  'the update''s audit row shows the real after status (in_progress)'
);

-- ==== Owner visibility: a real owner sees exactly their own property''s ticket event ====

insert into public.owners (org_id, user_id, name)
select id, 'fc000000-0000-0000-0000-000000000002', 'Governance Test Owner'
from public.organizations where legal_name = 'Governance Audit Test Org';

select public.grant_property_access(
  current_setting('pgtap.gat_test.property_id')::uuid,
  'fc000000-0000-0000-0000-000000000002'::uuid,
  'owner'::public.property_role
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.audit_events
     where entity_type = 'maintenance_tickets' and entity_id = current_setting('pgtap.gat_test.ticket_id')::uuid),
  2,
  'the owner (no org membership) sees both audit events for their own property''s maintenance ticket'
);

-- A generic org-lifecycle audit event (unrelated entity_type, e.g. an organization action) must
-- stay invisible to this owner -- the policy is narrow, not a blanket "any audit_events row."
select is(
  (select count(*)::int from public.audit_events where entity_type not in ('cash_receipts', 'maintenance_tickets', 'owner_statements')),
  0,
  'the owner sees zero audit_events rows of any entity_type outside the three explicitly granted'
);

select * from finish();
rollback;
