-- Tests for 20260101000069_journal_lines_access_cutover.sql: journal_lines gated on
-- has_property_access() only when property_id is set -- journal_entries itself is deliberately
-- left unchanged (no natural per-property scope). Posts a real, balanced two-line entry via
-- post_journal_entry() (one property-tagged line, one not) and confirms revocation hides exactly
-- the property-tagged line while the org-level (no property_id) line stays visible.

begin;
select plan(6);

insert into auth.users (id, email) values
  ('f7000000-0000-0000-0000-000000000001', 'jlc-principal@test.propertyvault.example'),
  ('f7000000-0000-0000-0000-000000000002', 'jlc-coworker@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'f7000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Journal Lines Cutover Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Journal Lines Cutover Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'f7000000-0000-0000-0000-000000000001';

select set_config(
  'pgtap.jlc_test.property_id',
  (select public.create_property(
    (select id from public.organizations where legal_name = 'Journal Lines Cutover Test Org'),
    'Journal Lines Cutover Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type
  )::text),
  false
);

-- A real, balanced entry: Dr Maintenance Expense (property-tagged) / Cr Business Bank (not
-- property-tagged) -- exactly the shape a real expense-recording flow produces.
select set_config(
  'pgtap.jlc_test.entry_id',
  (select public.post_journal_entry(
    (select id from public.organizations where legal_name = 'Journal Lines Cutover Test Org'),
    current_date, 'Cutover test entry', 'adjustment', null,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Journal Lines Cutover Test Org') and code = '5000'),
        'debit', 500, 'property_id', current_setting('pgtap.jlc_test.property_id')
      ),
      jsonb_build_object(
        'account_id', (select id from public.chart_of_accounts where org_id = (select id from public.organizations where legal_name = 'Journal Lines Cutover Test Org') and code = '1000'),
        'credit', 500
      )
    )
  )::text),
  false
);

select is(
  (select count(*)::int from public.journal_lines where journal_entry_id = current_setting('pgtap.jlc_test.entry_id')::uuid),
  2,
  'the creator (already property_access administrator) sees both lines -- the property-tagged one and the org-level one'
);

-- A coworker joins the org (auto-granted access) then has it revoked -- they should still see
-- the org-level line (no property_id) but lose the property-tagged one specifically.
reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at)
select id, 'f7000000-0000-0000-0000-000000000002', 'accountant', 'active', now()
from public.organizations where legal_name = 'Journal Lines Cutover Test Org';
set local role authenticated;
set local "request.jwt.claim.sub" = 'f7000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.journal_lines where journal_entry_id = current_setting('pgtap.jlc_test.entry_id')::uuid),
  2,
  'a coworker who joins the org (auto-granted) sees both lines too, before any revocation'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f7000000-0000-0000-0000-000000000001';

select public.revoke_property_access(
  current_setting('pgtap.jlc_test.property_id')::uuid,
  'f7000000-0000-0000-0000-000000000002'::uuid
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f7000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.journal_lines where journal_entry_id = current_setting('pgtap.jlc_test.entry_id')::uuid),
  1,
  'after revocation, exactly one line remains visible -- the property-tagged one is gone, the org-level one is not'
);

select is(
  (select property_id is null from public.journal_lines where journal_entry_id = current_setting('pgtap.jlc_test.entry_id')::uuid),
  true,
  'the one remaining visible line is confirmed to be the non-property-tagged one, not a coincidence'
);

select is(
  (select count(*)::int from public.journal_entries where id = current_setting('pgtap.jlc_test.entry_id')::uuid),
  1,
  'journal_entries itself is unaffected by this cutover -- the entry row stays visible to any org viewer, by design'
);

select * from finish();
rollback;
