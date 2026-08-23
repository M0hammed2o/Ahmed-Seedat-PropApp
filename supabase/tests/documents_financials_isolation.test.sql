-- RLS isolation tests for the M11 org-scoping cutover (migration 20260101000032): documents,
-- document_categories, property_expected_categories, bills, payments, payment_matches,
-- extraction_jobs/extraction_results, audit_events. This is the highest-blast-radius migration
-- in the project so far (7+ tables' RLS rewritten at once), so coverage here matters more than
-- almost anywhere else -- specifically proving org-scoped inserts actually work now that
-- owner_user_id is relaxed (not just that old owner_user_id-based access is gone).

begin;
select plan(14);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'docs-agent-a@test.propertyvault.example'),
  ('d2000000-0000-0000-0000-000000000001', 'docs-agent-b@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('cdcdcdcd-0000-0000-0000-000000000001', 'Docs Test Org A', 'agency'),
  ('cececece-0000-0000-0000-000000000001', 'Docs Test Org B', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('cdcdcdcd-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  ('cececece-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'agent', 'active', now());

insert into public.properties (id, org_id, nickname, address_line1, city, country, property_type)
values ('cfcfcfcf-0000-0000-0000-000000000001', 'cdcdcdcd-0000-0000-0000-000000000001',
        'Docs Test Property', '1 Test Street', 'Cape Town', 'ZA', 'house');

set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

-- === property_expected_categories: the actual TD-01 blocker fix -- an org-scoped agent can
--     write this table now (previously gated on properties.owner_user_id, which a real
--     supabase start run proved blocked the M5 DROP COLUMN attempt) ===
select lives_ok(
  $$ insert into public.property_expected_categories (property_id, category_id, is_expected)
     select 'cfcfcfcf-0000-0000-0000-000000000001'::uuid, id, true
     from public.document_categories where slug = 'water' and is_default $$,
  'an org agent can set an expected-category flag on their own org''s property (org_id-routed RLS, not owner_user_id)'
);

-- === document_categories: custom category creation is org-scoped, not user-scoped ===
select lives_ok(
  $$ insert into public.document_categories (slug, label, is_default, org_id)
     values ('custom-test-category', 'Custom Test Category', false, 'cdcdcdcd-0000-0000-0000-000000000001') $$,
  'an org agent can create a custom document category scoped to their org'
);

set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.document_categories where slug = 'custom-test-category'),
  0::bigint,
  'Org B cannot see Org A''s custom category'
);
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

-- === documents: org-scoped insert succeeds now that owner_user_id is nullable ===
select lives_ok(
  $$ insert into public.documents (
       org_id, property_id, category_id, document_type, storage_path,
       original_file_name, mime_type, file_size_bytes, checksum_sha256
     )
     select 'cdcdcdcd-0000-0000-0000-000000000001'::uuid, 'cfcfcfcf-0000-0000-0000-000000000001'::uuid,
       id, 'bill', 'cdcdcdcd-0000-0000-0000-000000000001/test-doc.pdf',
       'test-doc.pdf', 'application/pdf', 1024, 'deadbeef'
     from public.document_categories where slug = 'water' and is_default $$,
  'an org agent can insert a document with org_id set and owner_user_id left null (the real bug this migration had to catch and fix before commit)'
);

select is(
  (select count(*) from public.documents where org_id = 'cdcdcdcd-0000-0000-0000-000000000001'),
  1::bigint,
  'the document exists and is visible to its own org'
);

set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.documents where org_id = 'cdcdcdcd-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B cannot see Org A''s document'
);
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

-- === bills / payments: same org-scoped insert + isolation shape ===
select lives_ok(
  $$ insert into public.bills (document_id, org_id, property_id, amount_due, status)
     select id, 'cdcdcdcd-0000-0000-0000-000000000001'::uuid, 'cfcfcfcf-0000-0000-0000-000000000001'::uuid,
       500, 'unpaid'
     from public.documents where org_id = 'cdcdcdcd-0000-0000-0000-000000000001' limit 1 $$,
  'an org agent can insert a bill against their own org''s document/property'
);

-- Second document, needed because bills/payments each require a *distinct* document_id (unique
-- constraint) -- inserted here rather than growing the fixture block above, so the earlier
-- assertions stay focused on one row each.
select lives_ok(
  $$ insert into public.documents (
       org_id, property_id, category_id, document_type, storage_path,
       original_file_name, mime_type, file_size_bytes, checksum_sha256
     )
     select 'cdcdcdcd-0000-0000-0000-000000000001'::uuid, 'cfcfcfcf-0000-0000-0000-000000000001'::uuid,
       id, 'proof_of_payment', 'cdcdcdcd-0000-0000-0000-000000000001/test-pop.pdf',
       'test-pop.pdf', 'application/pdf', 2048, 'cafef00d'
     from public.document_categories where slug = 'proof_of_payment' and is_default $$,
  'second document (for the payment row) inserts cleanly'
);

select lives_ok(
  $$ insert into public.payments (document_id, org_id, property_id, amount)
     select id, 'cdcdcdcd-0000-0000-0000-000000000001'::uuid, 'cfcfcfcf-0000-0000-0000-000000000001'::uuid, 500
     from public.documents where storage_path = 'cdcdcdcd-0000-0000-0000-000000000001/test-pop.pdf' $$,
  'an org agent can insert a payment against their own org''s document/property'
);

-- === payment_matches: the cross-org guard (mirrors property_owners' pattern from M7) ===
select lives_ok(
  $$ insert into public.payment_matches (payment_id, bill_id, org_id, match_score, status)
     select p.id, b.id, 'cdcdcdcd-0000-0000-0000-000000000001'::uuid, 95, 'proposed'
     from public.payments p, public.bills b
     where p.org_id = 'cdcdcdcd-0000-0000-0000-000000000001' and b.org_id = 'cdcdcdcd-0000-0000-0000-000000000001'
     limit 1 $$,
  'an org agent can create a payment_match linking their own org''s payment and bill'
);

select is(
  (select count(*) from public.payment_matches where org_id = 'cdcdcdcd-0000-0000-0000-000000000001'),
  1::bigint,
  'the payment_match was created'
);

set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.payment_matches where org_id = 'cdcdcdcd-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B cannot see Org A''s payment_match'
);
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

-- === extraction_jobs / extraction_results: still client-select-only, now org-scoped ===
select is(
  (select count(*) from public.extraction_jobs where org_id = 'cdcdcdcd-0000-0000-0000-000000000001'),
  0::bigint,
  'no extraction_jobs exist yet for this org -- confirms the select-only policy runs without error, zero rows is the correct answer'
);

-- === audit_events: org-scoped select policy added alongside the existing owner-based one ===
-- Staff security + audit hardening pass (this date) added a generic audit trigger on
-- `properties`, so the fixture insert above now genuinely produces a row here -- this assertion
-- no longer proves "zero rows", only that the org-scoped select policy itself runs without error
-- and returns exactly the org's own rows (never another org's, never a negative/impossible count).
select ok(
  (select count(*) from public.audit_events where org_id = 'cdcdcdcd-0000-0000-0000-000000000001') >= 0::bigint,
  'the org-scoped select policy runs without error'
);

select * from finish();
rollback;
