-- Cemetery Management (migration 184): module switch, role-based RLS, cross-organisation isolation, the sale /
-- payment / reservation / burial invariants (double-sale and overpayment prevention), idempotent site generation.

begin;
select plan(68);

insert into auth.users (id, email) values
  ('ce000000-0000-0000-0000-000000000001', 'cem-a-principal@test.propertyvault.example'),
  ('ce000000-0000-0000-0000-000000000002', 'cem-a-manager@test.propertyvault.example'),
  ('ce000000-0000-0000-0000-000000000003', 'cem-a-accountant@test.propertyvault.example'),
  ('ce000000-0000-0000-0000-000000000004', 'cem-a-agent@test.propertyvault.example'),
  ('ce000000-0000-0000-0000-000000000005', 'cem-a-viewer@test.propertyvault.example'),
  ('ce000000-0000-0000-0000-000000000006', 'cem-b-principal@test.propertyvault.example'),
  ('ce000000-0000-0000-0000-000000000007', 'cem-c-principal@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type, status) values
  ('cece0000-0000-0000-0000-00000000000a', 'Cemetery Test A', 'agency', 'active'),
  ('cece0000-0000-0000-0000-00000000000b', 'Cemetery Test B', 'agency', 'active'),
  ('cece0000-0000-0000-0000-00000000000c', 'Cemetery Test C (module off)', 'agency', 'active');

select is(
  (select count(*)::int from public.organizations where id::text like 'cece0000%' and cemetery_enabled),
  0,
  'new organisations default to cemetery_enabled = false'
);

update public.organizations set cemetery_enabled = true
 where id in ('cece0000-0000-0000-0000-00000000000a', 'cece0000-0000-0000-0000-00000000000b');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('cece0000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('cece0000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000002', 'manager', 'active', now()),
  ('cece0000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000003', 'accountant', 'active', now()),
  ('cece0000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000004', 'agent', 'active', now()),
  ('cece0000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000005', 'viewer', 'active', now()),
  ('cece0000-0000-0000-0000-00000000000b', 'ce000000-0000-0000-0000-000000000006', 'principal', 'active', now()),
  ('cece0000-0000-0000-0000-00000000000c', 'ce000000-0000-0000-0000-000000000007', 'principal', 'active', now());

-- ============ Org A manager builds the structure through RLS ============
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000002';

insert into public.cemeteries (id, org_id, name, is_demo) values
  ('cece1000-0000-0000-0000-000000000001', 'cece0000-0000-0000-0000-00000000000a', 'Test Memorial Park', true);
insert into public.cemetery_sections (id, org_id, cemetery_id, code, name, sites_per_row) values
  ('cece2000-0000-0000-0000-000000000001', 'cece0000-0000-0000-0000-00000000000a', 'cece1000-0000-0000-0000-000000000001', 'A', 'Section A', 5);
insert into public.cemetery_purchasers (id, org_id, full_name) values
  ('cece3000-0000-0000-0000-000000000001', 'cece0000-0000-0000-0000-00000000000a', 'Purchaser One'),
  ('cece3000-0000-0000-0000-000000000002', 'cece0000-0000-0000-0000-00000000000a', 'Purchaser Two');

select is(public.cemetery_generate_sites('cece2000-0000-0000-0000-000000000001', 10, 9500, 2.5, 1.2), 10, 'generate_sites creates 10 sites');
select is(public.cemetery_generate_sites('cece2000-0000-0000-0000-000000000001', 10, 9500, 2.5, 1.2), 0, 'generate_sites is idempotent (re-run creates nothing)');
select is(public.cemetery_generate_sites('cece2000-0000-0000-0000-000000000001', 12, 9500), 2, 'generate_sites only adds the missing sites when the count grows');
select is(
  (select string_agg(reference, ',' order by site_number) from public.cemetery_sites where site_number in (1, 10, 12)),
  'A-001,A-010,A-012',
  'site references are section code + zero-padded number'
);
select is(
  (select row_label || '/' || plot_position from public.cemetery_sites where reference = 'A-007'),
  'Row 2/2',
  'schematic row/position follows sites_per_row'
);

-- ============ read access by role ============
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.cemetery_sites), 12, 'org A principal reads its sites');

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.cemetery_sites), 12, 'org A accountant reads its sites');
select throws_ok(
  $$insert into public.cemetery_purchasers (org_id, full_name) values ('cece0000-0000-0000-0000-00000000000a', 'X')$$,
  '42501', null, 'an accountant cannot create purchasers'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000004';
select is((select count(*)::int from public.cemetery_sites), 0, 'an agent sees no cemetery records (personal information)');
select is((select count(*)::int from public.cemetery_purchasers), 0, 'an agent sees no purchasers');

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000005';
select is((select count(*)::int from public.cemetery_sites), 0, 'a viewer sees no cemetery records');

-- ============ cross-organisation isolation ============
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000006';
select is((select count(*)::int from public.cemeteries where org_id = 'cece0000-0000-0000-0000-00000000000a'), 0, 'org B principal cannot see org A cemeteries');
select is((select count(*)::int from public.cemetery_sites where org_id = 'cece0000-0000-0000-0000-00000000000a'), 0, 'org B principal cannot see org A sites');
select is((select count(*)::int from public.cemetery_purchasers where org_id = 'cece0000-0000-0000-0000-00000000000a'), 0, 'org B principal cannot see org A purchasers');
select throws_ok(
  $$insert into public.cemetery_purchasers (org_id, full_name) values ('cece0000-0000-0000-0000-00000000000a', 'Intruder')$$,
  '42501', null, 'org B principal cannot write into org A'
);
select throws_like(
  $$select public.cemetery_record_sale((select id from public.cemetery_sites limit 1), 'cece3000-0000-0000-0000-000000000001', 1000)$$,
  'cemetery_site_not_found%', 'org B principal cannot sell an org A site through the workflow function'
);

-- ============ module switch: org C has it off ============
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000007';
select throws_ok(
  $$insert into public.cemeteries (org_id, name) values ('cece0000-0000-0000-0000-00000000000c', 'Not allowed')$$,
  '42501', null, 'an organisation with the module off cannot create cemetery records, even as principal'
);

-- ============ sales workflow (org A manager) ============
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000002';

select ok(
  (public.cemetery_record_sale(
     (select id from public.cemetery_sites where reference = 'A-001'), 'cece3000-0000-0000-0000-000000000001',
     12000, current_date, 3000, 'eft', 'DEP-1') ->> 'receipt_number') like 'GR-%',
  'record_sale with a deposit returns a receipt number'
);
select is((select sale_status::text from public.cemetery_sites where reference = 'A-001'), 'sold', 'the sold site is marked sold');
select is((select burial_status::text from public.cemetery_sites where reference = 'A-001'), 'unused', 'sale status and burial status are separate: sold but unused');
select is(
  (select balance_due from public.cemetery_sale_balances b join public.cemetery_sales s on s.id = b.sale_id
     join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-001'),
  9000.00::numeric(12, 2),
  'outstanding balance = price - deposit'
);
select ok(
  (select is_demo from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-001')
  and (select bool_and(p.is_demo) from public.cemetery_payments p),
  'sales and payments under a demo cemetery are flagged as demonstration transactions'
);
select throws_like(
  $$select public.cemetery_record_sale((select id from public.cemetery_sites where reference = 'A-001'), 'cece3000-0000-0000-0000-000000000002', 5000)$$,
  'cemetery_site_already_sold%', 'the same grave site cannot be sold twice'
);
select throws_like(
  $$insert into public.cemetery_sales (org_id, cemetery_id, site_id, purchaser_id, tenure_model, price)
    select org_id, cemetery_id, id, 'cece3000-0000-0000-0000-000000000002', 'burial_rights', 5000 from public.cemetery_sites where reference = 'A-001'$$,
  'cemetery_site_already_sold%', 'a direct second sale insert is refused too'
);
select throws_like(
  $$select public.cemetery_record_payment((select s.id from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-001'), 9000.01)$$,
  'cemetery_payment_exceeds_balance%', 'a payment above the balance due is refused'
);
select lives_ok(
  $$select public.cemetery_record_payment((select s.id from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-001'), 4000, current_date, 'cash')$$,
  'a part payment is accepted'
);
select throws_ok(
  $$update public.cemetery_payments set amount = 1 where amount = 4000$$,
  '42501', null, 'signed-in users have no UPDATE privilege on payments'
);
select throws_ok(
  $$delete from public.cemetery_sites where reference = 'A-012'$$,
  '42501', null, 'signed-in users have no DELETE privilege on cemetery records'
);
select throws_like(
  $$update public.cemetery_sites set sale_status = 'sold' where reference = 'A-002'$$,
  'cemetery_site_requires_sale%', 'a site cannot be marked sold without a sale'
);
select throws_like(
  $$update public.cemetery_sites set sale_status = 'available' where reference = 'A-001'$$,
  'cemetery_site_has_active_sale%', 'a sold site cannot be freed while its sale is active'
);
select throws_like(
  $$update public.cemetery_sales set price = 1 where site_id = (select id from public.cemetery_sites where reference = 'A-001')$$,
  'cemetery_sale_immutable%', 'a recorded sale cannot be re-priced'
);

-- reservations
select lives_ok(
  $$select public.cemetery_reserve_site((select id from public.cemetery_sites where reference = 'A-003'), 'cece3000-0000-0000-0000-000000000001', current_date + 30)$$,
  'an available site can be reserved'
);
select throws_like(
  $$select public.cemetery_record_sale((select id from public.cemetery_sites where reference = 'A-003'), 'cece3000-0000-0000-0000-000000000002', 9000)$$,
  'cemetery_site_reserved_for_other%', 'a site reserved for one purchaser cannot be sold to another'
);
select lives_ok(
  $$select public.cemetery_record_sale((select id from public.cemetery_sites where reference = 'A-003'), 'cece3000-0000-0000-0000-000000000001', 9000, current_date, 9000, 'card')$$,
  'the reserved site can be sold to its own purchaser, fully paid'
);
select is(
  (select sale_status::text || '/' || coalesce(reserved_for_purchaser_id::text, 'none') from public.cemetery_sites where reference = 'A-003'),
  'sold/none', 'selling clears the reservation'
);
select is(
  (select count(distinct s.site_id)::int from public.cemetery_sales s where s.purchaser_id = 'cece3000-0000-0000-0000-000000000001'),
  2, 'one purchaser can hold rights to multiple grave sites'
);

-- burials
select throws_like(
  $$select public.cemetery_record_burial((select id from public.cemetery_sites where reference = 'A-002'), 'Test Person', current_date)$$,
  'cemetery_site_not_sold%', 'no burial on a site without granted rights'
);
select lives_ok(
  $$select public.cemetery_record_burial((select id from public.cemetery_sites where reference = 'A-001'), 'Test Person', current_date, current_date - 4)$$,
  'a burial is recorded on a sold site'
);
select is((select burial_status::text from public.cemetery_sites where reference = 'A-001'), 'occupied', 'the burial marks the site occupied');
select throws_like(
  $$select public.cemetery_record_burial((select id from public.cemetery_sites where reference = 'A-001'), 'Second Person', current_date)$$,
  'cemetery_site_full%', 'max_interments is enforced'
);

-- availability
select throws_like(
  $$select public.cemetery_set_site_unavailable((select id from public.cemetery_sites where reference = 'A-004'), true, '')$$,
  'cemetery_reason_required%', 'withdrawing a site needs a reason'
);
select lives_ok(
  $$select public.cemetery_set_site_unavailable((select id from public.cemetery_sites where reference = 'A-004'), true, 'Drainage easement')$$,
  'an available site can be withdrawn with a reason'
);

-- accountant can receipt payments
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000003';
select lives_ok(
  $$select public.cemetery_record_payment((select s.id from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-001'), 5000, current_date, 'eft')$$,
  'an accountant can record a payment (settles the balance)'
);

-- ============ site history, chronology and cancellation (org A manager) ============
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000002';
select is(
  (select string_agg(e.event_type, ',' order by e.event_date, e.created_at) from public.cemetery_site_events e
     join public.cemetery_sites t on t.id = e.site_id where t.reference = 'A-001'),
  'sold,burial', 'site history records the sale and the burial'
);
select is(
  (select string_agg(e.event_type, ',' order by e.event_date, e.created_at) from public.cemetery_site_events e
     join public.cemetery_sites t on t.id = e.site_id where t.reference = 'A-003'),
  'reserved,sold', 'a reservation followed by its sale is recorded in order'
);
select throws_like(
  $$select public.cemetery_record_sale((select id from public.cemetery_sites where reference = 'A-005'), 'cece3000-0000-0000-0000-000000000001', 9000, current_date + 5)$$,
  'cemetery_future_date%', 'a sale cannot be dated in the future'
);
select lives_ok(
  $$select public.cemetery_reserve_site((select id from public.cemetery_sites where reference = 'A-006'), 'cece3000-0000-0000-0000-000000000001', null, null, current_date - 3)$$,
  'a reservation can be recorded with the date it was made'
);
select is(
  (select e.event_date from public.cemetery_site_events e join public.cemetery_sites t on t.id = e.site_id
    where t.reference = 'A-006' and e.event_type = 'reserved'),
  current_date - 3, 'the history carries the reservation''s effective date'
);
select throws_like(
  $$select public.cemetery_record_sale((select id from public.cemetery_sites where reference = 'A-006'), 'cece3000-0000-0000-0000-000000000001', 9000, current_date - 10)$$,
  'cemetery_out_of_order%', 'a sale cannot be dated before the site''s reservation'
);
select throws_like(
  $$select public.cemetery_release_reservation((select id from public.cemetery_sites where reference = 'A-006'), current_date - 4)$$,
  'cemetery_out_of_order%', 'a reservation cannot be released before it was made'
);
select lives_ok(
  $$select public.cemetery_record_sale((select id from public.cemetery_sites where reference = 'A-007'), 'cece3000-0000-0000-0000-000000000001', 8000, current_date - 5, 2000)$$,
  'a back-dated sale with a deposit is accepted'
);
select throws_like(
  $$select public.cemetery_record_payment((select s.id from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-007'), 100, current_date - 6)$$,
  'cemetery_payment_before_sale%', 'a payment cannot be dated before its sale'
);
select throws_like(
  $$select public.cemetery_record_payment((select s.id from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-007'), 100, current_date + 2)$$,
  'cemetery_future_date%', 'a payment cannot be dated in the future'
);
select throws_like(
  $$select public.cemetery_cancel_sale((select s.id from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-001'), 'test')$$,
  'cemetery_sale_has_burial%', 'a sale with a burial cannot be cancelled'
);
select throws_like(
  $$select public.cemetery_cancel_sale((select s.id from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-007'), '')$$,
  'cemetery_reason_required%', 'a cancellation needs a reason'
);
select lives_ok(
  $$select public.cemetery_cancel_sale((select s.id from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-007'), 'Purchaser emigrated; deposit retained', current_date - 1)$$,
  'an active sale without burials can be cancelled'
);
select is(
  (select sale_status::text from public.cemetery_sites where reference = 'A-007'), 'available', 'the cancelled site is available again'
);
select is(
  (select b.balance_due::text || '/' || b.amount_paid::text || '/' || b.status::text from public.cemetery_sale_balances b
     join public.cemetery_sales s on s.id = b.sale_id join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-007'),
  '0.00/2000.00/cancelled', 'a cancelled sale owes nothing and keeps the deposit received'
);
select lives_ok(
  $$select public.cemetery_record_sale((select id from public.cemetery_sites where reference = 'A-007'), 'cece3000-0000-0000-0000-000000000002', 8500)$$,
  'a cancelled site can be sold again'
);
select is(
  (select string_agg(e.event_type, ',' order by e.event_date, e.created_at) from public.cemetery_site_events e
     join public.cemetery_sites t on t.id = e.site_id where t.reference = 'A-007'),
  'sold,sale_cancelled,sold', 'the history shows sale, cancellation and resale'
);
select throws_ok(
  $$insert into public.cemetery_site_events (org_id, site_id, event_type, event_date)
    select org_id, id, 'sold', current_date from public.cemetery_sites where reference = 'A-008'$$,
  '42501', null, 'users cannot write site history directly'
);

-- audit trail without personal information: a viewer can read the org's audit_events, but no cemetery name in them
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000005';
select ok(
  (select count(*) from public.audit_events where entity_type like 'cemetery%') > 0,
  'cemetery changes are audited (visible to org members)'
);
select is(
  (select count(*)::int from public.audit_events
    where entity_type like 'cemetery%'
      and (coalesce(before::text, '') || coalesce(after::text, '')) ~ '(Purchaser One|Purchaser Two|Test Person)'),
  0,
  'cemetery audit rows carry no purchaser or deceased names'
);

-- org B cannot receipt a payment against org A's sale, even by a direct insert naming its own org
reset role;
select set_config('pgtap.cem.sale_a1', (select s.id::text from public.cemetery_sales s join public.cemetery_sites t on t.id = s.site_id where t.reference = 'A-003'), true);
set local role authenticated;
set local "request.jwt.claim.sub" = 'ce000000-0000-0000-0000-000000000006';
select throws_like(
  $$insert into public.cemetery_payments (org_id, sale_id, amount, method)
    values ('cece0000-0000-0000-0000-00000000000b', current_setting('pgtap.cem.sale_a1')::uuid, 1, 'cash')$$,
  'cemetery_sale_not_found%', 'org B cannot pay into (or learn the balance of) org A''s sale'
);

-- ============ structural isolation (even the service role cannot cross organisations) ============
reset role;
select throws_like(
  $$update public.cemetery_payments set amount = 1 where amount = 4000$$,
  'cemetery_payment_immutable%', 'recorded payments cannot be edited by any writer'
);
select throws_ok(
  $$insert into public.cemetery_sales (org_id, cemetery_id, site_id, purchaser_id, tenure_model, price)
    select 'cece0000-0000-0000-0000-00000000000b', cemetery_id, id, 'cece3000-0000-0000-0000-000000000002', 'burial_rights', 100
      from public.cemetery_sites where reference = 'A-005'$$,
  '23503', null, 'a sale row cannot point at another organisation''s site (composite foreign key)'
);

set local role anon;
select throws_ok($$select count(*) from public.cemetery_sites$$, '42501', null, 'anon has no access to cemetery tables');

select * from finish();
rollback;
