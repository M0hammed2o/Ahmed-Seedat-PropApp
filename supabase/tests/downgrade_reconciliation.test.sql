-- V1 commercial UX pass (this date): downgrade reconciliation -- PRODUCT DECISION coverage.
-- reconcile_plan_limits() keep-lists, RLS write-blocking on restricted_by_plan, owner-portal
-- visibility narrowing, immediate trial downgrade vs scheduled non-trial downgrade, and
-- set_scheduled_downgrade_selection()/apply_due_scheduled_plan_changes() wiring.

begin;
select plan(33);

insert into auth.users (id, email) values
  ('dd000000-0000-0000-0000-000000000001', 'dr-principal@test.propertyvault.example'),
  ('dd000000-0000-0000-0000-000000000002', 'dr-owner-user@test.propertyvault.example');

select set_config('dr.professional_id', (select id::text from public.plans where code = 'professional_monthly'), false);
select set_config('dr.starter_id', (select id::text from public.plans where code = 'starter_monthly'), false);
select set_config('dr.business_id', (select id::text from public.plans where code = 'business_monthly'), false);

-- ============================================================
-- Part 1: keep-list vs deterministic fallback for properties (Professional 15 -> Starter 5).
-- ============================================================
insert into public.organizations (id, legal_name, org_type, status)
values ('dddd0000-0000-0000-0000-000000000001', 'Downgrade Reconciliation Test Org', 'agency', 'active');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('dddd0000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values ('dddd0000-0000-0000-0000-000000000001', current_setting('dr.professional_id')::uuid, 'monthly', current_date, current_date + 30, 'active');

-- 3 properties, oldest to newest.
insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type, created_at) values
  ('dddd0000-0000-0000-0000-000000000101', 'dddd0000-0000-0000-0000-000000000001', 'Prop A (oldest)', '1 A St', 'Cape Town', 'ZA', 'house', now() - interval '3 days'),
  ('dddd0000-0000-0000-0000-000000000102', 'dddd0000-0000-0000-0000-000000000001', 'Prop B', '2 B St', 'Cape Town', 'ZA', 'house', now() - interval '2 days'),
  ('dddd0000-0000-0000-0000-000000000103', 'dddd0000-0000-0000-0000-000000000001', 'Prop C (newest)', '3 C St', 'Cape Town', 'ZA', 'house', now() - interval '1 day');

-- 3 more (6 total) -- genuinely over Starter's real 5-property allowance.
insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type, created_at) values
  ('dddd0000-0000-0000-0000-000000000104', 'dddd0000-0000-0000-0000-000000000001', 'Prop D', '4 D St', 'Cape Town', 'ZA', 'house', now() - interval '20 hours'),
  ('dddd0000-0000-0000-0000-000000000105', 'dddd0000-0000-0000-0000-000000000001', 'Prop E', '5 E St', 'Cape Town', 'ZA', 'house', now() - interval '10 hours'),
  ('dddd0000-0000-0000-0000-000000000106', 'dddd0000-0000-0000-0000-000000000001', 'Prop F (newest)', '6 F St', 'Cape Town', 'ZA', 'house', now());

update public.organization_subscriptions set plan_id = current_setting('dr.starter_id')::uuid
  where org_id = 'dddd0000-0000-0000-0000-000000000001';

-- Explicit keep-list: customer chooses B, D, F (not the deterministic oldest-5).
select public.reconcile_plan_limits(
  'dddd0000-0000-0000-0000-000000000001'::uuid,
  array['dddd0000-0000-0000-0000-000000000102'::uuid, 'dddd0000-0000-0000-0000-000000000104'::uuid, 'dddd0000-0000-0000-0000-000000000106'::uuid,
        'dddd0000-0000-0000-0000-000000000101'::uuid, 'dddd0000-0000-0000-0000-000000000103'::uuid],
  null, null, 'dd000000-0000-0000-0000-000000000001'::uuid, 'test_keep_list'
);

select is(
  (select count(*)::int from public.properties where org_id = 'dddd0000-0000-0000-0000-000000000001'),
  6, 'reconcile_plan_limits() never deletes a property row -- all 6 still exist'
);
select is(
  (select restricted_by_plan from public.properties where id = 'dddd0000-0000-0000-0000-000000000105'),
  true, 'Prop E (not in the explicit 5-item keep-list) is restricted'
);
select is(
  (select restricted_by_plan from public.properties where id = 'dddd0000-0000-0000-0000-000000000102'),
  false, 'Prop B (explicitly kept, even though not the oldest) stays active -- explicit selection honored over deterministic default'
);
select is(
  (select count(*)::int from public.properties where org_id = 'dddd0000-0000-0000-0000-000000000001' and restricted_by_plan = true),
  1, 'exactly 1 property (the one excess beyond Starter''s 5-property allowance) is restricted'
);

-- Audit event for the restriction batch.
select is(
  (select count(*)::int from public.audit_events where org_id = 'dddd0000-0000-0000-0000-000000000001' and action = 'billing.properties_restricted_by_plan'),
  1, 'a billing.properties_restricted_by_plan audit event was written'
);

-- ============================================================
-- Part 2: deterministic fallback (no explicit selection) -- oldest-created stays active.
-- ============================================================
update public.properties set restricted_by_plan = false where org_id = 'dddd0000-0000-0000-0000-000000000001';
select public.reconcile_plan_limits('dddd0000-0000-0000-0000-000000000001'::uuid);
select is(
  (select restricted_by_plan from public.properties where id = 'dddd0000-0000-0000-0000-000000000101'),
  false, 'deterministic fallback: Prop A (oldest) stays active with no explicit selection'
);
select is(
  (select restricted_by_plan from public.properties where id = 'dddd0000-0000-0000-0000-000000000106'),
  true, 'deterministic fallback: Prop F (newest) is the one restricted with no explicit selection'
);

-- ============================================================
-- Part 3: RLS -- a restricted property cannot be UPDATEd by staff, but remains fully SELECTable.
-- ============================================================
set local role authenticated;
set local "request.jwt.claim.sub" = 'dd000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select * from public.properties where id = 'dddd0000-0000-0000-0000-000000000106'$$,
  'staff can still SELECT a restricted property -- read access is never revoked'
);
select throws_ok(
  $$update public.properties set nickname = 'renamed' where id = 'dddd0000-0000-0000-0000-000000000106'$$,
  'new row violates row-level security policy for table "properties"',
  'staff cannot UPDATE a restricted property -- WITH CHECK rejects it explicitly'
);
select lives_ok(
  $$update public.properties set nickname = 'renamed A' where id = 'dddd0000-0000-0000-0000-000000000101'$$,
  'staff CAN still update a NON-restricted property -- the RLS change is scoped to restricted rows only'
);
reset role;

-- ============================================================
-- Part 4: restore on upgrade -- capacity increase lifts restriction without recreating anything.
-- ============================================================
update public.organization_subscriptions set plan_id = current_setting('dr.professional_id')::uuid
  where org_id = 'dddd0000-0000-0000-0000-000000000001';
select public.reconcile_plan_limits('dddd0000-0000-0000-0000-000000000001'::uuid);
select is(
  (select count(*)::int from public.properties where org_id = 'dddd0000-0000-0000-0000-000000000001' and restricted_by_plan = true),
  0, 'upgrading back to Professional (15 allowance) lifts ALL property restriction -- 6 properties all fit'
);
select is(
  (select count(*)::int from public.audit_events where org_id = 'dddd0000-0000-0000-0000-000000000001' and action = 'billing.properties_restored_by_plan'),
  1, 'a billing.properties_restored_by_plan audit event was written'
);

-- ============================================================
-- Part 5: staff seat reconciliation (keep-list + deterministic fallback), never the principal.
-- ============================================================
insert into auth.users (id, email) values
  ('dd000000-0000-0000-0000-000000000010', 'dr-staff-1@test.propertyvault.example'),
  ('dd000000-0000-0000-0000-000000000011', 'dr-staff-2@test.propertyvault.example');
insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('dddd0000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000010', 'agent', 'active', now() - interval '1 day'),
  ('dddd0000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000011', 'agent', 'active', now());

update public.organization_subscriptions set plan_id = current_setting('dr.starter_id')::uuid
  where org_id = 'dddd0000-0000-0000-0000-000000000001';
select public.reconcile_plan_limits('dddd0000-0000-0000-0000-000000000001'::uuid);

select is(
  (select count(*)::int from public.organization_members where org_id = 'dddd0000-0000-0000-0000-000000000001' and role = 'principal' and suspended_by_plan = true),
  0, 'the principal is NEVER suspended_by_plan regardless of staff-seat downgrade'
);
select is(
  (select count(*)::int from public.organization_members where org_id = 'dddd0000-0000-0000-0000-000000000001' and role <> 'principal' and suspended_by_plan = true),
  1, 'exactly 1 staff member (Starter allows 1 seat, 2 exist) is suspended_by_plan'
);
select is(
  (select suspended_by_plan from public.organization_members where user_id = 'dd000000-0000-0000-0000-000000000010'),
  false, 'the OLDER staff member stays active under the deterministic fallback'
);
select is(
  (select count(*)::int from public.organization_members where org_id = 'dddd0000-0000-0000-0000-000000000001'),
  3, 'reconcile_plan_limits() never removes a staff membership row'
);

update public.organization_subscriptions set plan_id = current_setting('dr.professional_id')::uuid
  where org_id = 'dddd0000-0000-0000-0000-000000000001';

-- ============================================================
-- Part 6: owner restriction, RLS write-block, and owner-portal visibility (ownership safety).
-- ============================================================
insert into public.owners (id, org_id, owner_type, name, user_id) values
  ('dddd0000-0000-0000-0000-000000000201', 'dddd0000-0000-0000-0000-000000000001', 'individual', 'Owner Genuine', 'dd000000-0000-0000-0000-000000000002');
insert into public.property_owners (property_id, owner_id, ownership_pct)
values ('dddd0000-0000-0000-0000-000000000101', 'dddd0000-0000-0000-0000-000000000201', 100);

-- Downgrade to Starter (0 included owners) restricts the owner.
update public.organization_subscriptions set plan_id = current_setting('dr.starter_id')::uuid
  where org_id = 'dddd0000-0000-0000-0000-000000000001';
select public.reconcile_plan_limits('dddd0000-0000-0000-0000-000000000001'::uuid);

select is(
  (select restricted_by_plan from public.owners where id = 'dddd0000-0000-0000-0000-000000000201'),
  true, 'the external owner is restricted_by_plan once downgraded to Starter (0 included owners)'
);
select is(
  (select count(*)::int from public.property_owners where owner_id = 'dddd0000-0000-0000-0000-000000000201'),
  1, 'ownership safety: the property_owners share row is completely untouched by restriction'
);
select is(
  (select ownership_pct from public.property_owners where owner_id = 'dddd0000-0000-0000-0000-000000000201'),
  100.00, 'ownership safety: ownership_pct (the factual ownership record) is unchanged'
);

-- Staff cannot UPDATE the restricted owner.
set local role authenticated;
set local "request.jwt.claim.sub" = 'dd000000-0000-0000-0000-000000000001';
select throws_ok(
  $$update public.owners set name = 'renamed' where id = 'dddd0000-0000-0000-0000-000000000201'$$,
  'new row violates row-level security policy for table "owners"',
  'staff cannot UPDATE a restricted owner'
);
select lives_ok(
  $$select * from public.owners where id = 'dddd0000-0000-0000-0000-000000000201'$$,
  'staff can still SELECT a restricted owner -- read access is never revoked'
);
reset role;

-- The owner's OWN portal view of their property is hidden while restricted.
set local role authenticated;
set local "request.jwt.claim.sub" = 'dd000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.properties where id = 'dddd0000-0000-0000-0000-000000000101'),
  0, 'a restricted owner''s OWN portal view no longer shows their property'
);
reset role;

-- Restoring capacity (upgrade) restores the owner's portal visibility.
update public.organization_subscriptions set plan_id = current_setting('dr.professional_id')::uuid
  where org_id = 'dddd0000-0000-0000-0000-000000000001';
select public.reconcile_plan_limits('dddd0000-0000-0000-0000-000000000001'::uuid);

set local role authenticated;
set local "request.jwt.claim.sub" = 'dd000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.properties where id = 'dddd0000-0000-0000-0000-000000000101'),
  1, 'restoring capacity (upgrade) restores the owner''s own portal visibility of their property'
);
reset role;

-- ============================================================
-- Part 7: confirm_plan_change() -- immediate trial downgrade vs scheduled non-trial downgrade.
-- ============================================================
-- 7a. TRIAL org: downgrade takes effect immediately.
insert into public.organizations (id, legal_name, org_type, status)
values ('dddd0000-0000-0000-0000-000000000002', 'Trial Downgrade Org', 'agency', 'trial');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
values ('dddd0000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000001', 'principal', 'active', now());
insert into public.organization_subscriptions (org_id, plan_id, billing_cycle, current_period_start, current_period_end, status)
values ('dddd0000-0000-0000-0000-000000000002', current_setting('dr.business_id')::uuid, 'monthly', current_date, current_date + 30, 'trial');
insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type) values
  ('dddd0000-0000-0000-0000-000000000301', 'dddd0000-0000-0000-0000-000000000002', 'Trial Prop 1', '1 T St', 'Cape Town', 'ZA', 'house');

set local role authenticated;
set local "request.jwt.claim.sub" = 'dd000000-0000-0000-0000-000000000001';
select set_config('dr.trial_quote_id', (select (public.create_plan_change_quote('dddd0000-0000-0000-0000-000000000002'::uuid, current_setting('dr.starter_id')::uuid)).id::text), false);
select set_config('dr.trial_change_id', (select (public.confirm_plan_change(current_setting('dr.trial_quote_id')::uuid)).billing_plan_change_id::text), false);
reset role;

select is(
  (select status from public.billing_plan_changes where id = current_setting('dr.trial_change_id')::uuid),
  'completed', 'a TRIAL org''s downgrade is applied immediately (status=completed, not scheduled)'
);
select is(
  (select plan_id from public.organization_subscriptions where org_id = 'dddd0000-0000-0000-0000-000000000002' order by current_period_start desc limit 1),
  current_setting('dr.starter_id')::uuid, 'the trial org''s plan_id flips to Starter immediately, not at day 30'
);

-- 7b. ACTIVE (non-trial) org: downgrade is still scheduled, unchanged behavior.
set local role authenticated;
set local "request.jwt.claim.sub" = 'dd000000-0000-0000-0000-000000000001';
select set_config('dr.active_quote_id', (select (public.create_plan_change_quote('dddd0000-0000-0000-0000-000000000001'::uuid, current_setting('dr.starter_id')::uuid)).id::text), false);
select set_config('dr.active_change_id', (select (public.confirm_plan_change(
  current_setting('dr.active_quote_id')::uuid,
  array['dddd0000-0000-0000-0000-000000000101'::uuid]
)).billing_plan_change_id::text), false);
reset role;

select is(
  (select status from public.billing_plan_changes where id = current_setting('dr.active_change_id')::uuid),
  'scheduled', 'an ACTIVE (non-trial) org''s downgrade is still scheduled for current_period_end -- unchanged behavior'
);
select is(
  (select plan_id from public.organization_subscriptions where org_id = 'dddd0000-0000-0000-0000-000000000001' order by current_period_start desc limit 1),
  current_setting('dr.professional_id')::uuid, 'an active org''s plan_id does NOT flip until the scheduled downgrade is actually applied'
);
select is(
  (select keep_property_ids from public.billing_plan_changes where id = current_setting('dr.active_change_id')::uuid),
  array['dddd0000-0000-0000-0000-000000000101'::uuid], 'the customer''s explicit keep-list is stored on the scheduled row for later application'
);

-- set_scheduled_downgrade_selection() lets the customer change their mind before the effective date.
set local role authenticated;
set local "request.jwt.claim.sub" = 'dd000000-0000-0000-0000-000000000001';
select public.set_scheduled_downgrade_selection(
  'dddd0000-0000-0000-0000-000000000001'::uuid,
  array['dddd0000-0000-0000-0000-000000000102'::uuid]
);
reset role;
select is(
  (select keep_property_ids from public.billing_plan_changes where org_id = 'dddd0000-0000-0000-0000-000000000001' and status = 'scheduled'),
  array['dddd0000-0000-0000-0000-000000000102'::uuid], 'set_scheduled_downgrade_selection() replaces the stored keep-list before the effective date'
);

-- apply_due_scheduled_plan_changes() applies the stored keep-list once effective_at has arrived.
update public.billing_plan_changes set effective_at = now() - interval '1 minute'
  where org_id = 'dddd0000-0000-0000-0000-000000000001' and status = 'scheduled';
select public.apply_due_scheduled_plan_changes();

select is(
  (select plan_id from public.organization_subscriptions where org_id = 'dddd0000-0000-0000-0000-000000000001' order by current_period_start desc limit 1),
  current_setting('dr.starter_id')::uuid, 'apply_due_scheduled_plan_changes() flips plan_id once effective_at has arrived'
);
select is(
  (select restricted_by_plan from public.properties where id = 'dddd0000-0000-0000-0000-000000000102'),
  false, 'apply_due_scheduled_plan_changes() honors the stored (updated) keep-list -- Prop B stays active'
);
select is(
  (select count(*)::int from public.properties where org_id = 'dddd0000-0000-0000-0000-000000000001' and restricted_by_plan = true),
  5, 'apply_due_scheduled_plan_changes() actually reconciles -- 5 of the 6 properties are now restricted under Starter'
);
select is(
  (select status from public.billing_plan_changes where org_id = 'dddd0000-0000-0000-0000-000000000001' and change_type = 'downgrade' order by requested_at desc limit 1),
  'completed', 'the scheduled downgrade row is marked completed once applied'
);

select * from finish();
rollback;
