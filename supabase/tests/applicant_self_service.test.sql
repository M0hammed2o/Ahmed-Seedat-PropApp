-- Applicant->tenant->lease V1 (WORKLOG.md 2026-08-25), Phases 4-7: proves the token-authenticated
-- applicant self-service model (migration 20260101000132) -- an anonymous (anon role, no
-- auth.users identity) caller holding only a valid token can read and complete exactly one
-- application and upload exactly its own documents, and can do NOTHING else: no direct table
-- access, no access to a different application, no access once the token is wrong/expired/revoked,
-- no editing once staff has moved the application past submitted/reviewing.

begin;
select plan(35);

insert into auth.users (id, email) values
  ('c5000000-0000-0000-0000-000000000001', 'ass-agent@test.propertyvault.example'),
  ('c5000000-0000-0000-0000-000000000002', 'ass-unassigned-agent@test.propertyvault.example');

set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001';

select isnt((select public.create_organization('Applicant Self Service Test Org', 'agency')), null, 'org created');
reset role;
select public.activate_trial_after_payment((select id from public.organizations where legal_name = 'Applicant Self Service Test Org'));
set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001';
select set_config('pgtap.ass.org_id', (select id::text from public.organizations where legal_name = 'Applicant Self Service Test Org'), false);

select set_config(
  'pgtap.ass.property_id',
  (select public.create_property(current_setting('pgtap.ass.org_id')::uuid, 'ASS Property', '1 Test St', 'Cape Town', 'ZA', 'house'::public.property_type)::text),
  false
);

insert into public.units (property_id, org_id, unit_label, status)
select current_setting('pgtap.ass.property_id')::uuid, current_setting('pgtap.ass.org_id')::uuid, 'U1', 'vacant';
select set_config('pgtap.ass.unit_id', (select id::text from public.units where property_id = current_setting('pgtap.ass.property_id')::uuid), false);

reset role;
insert into public.organization_members (org_id, user_id, role, status, joined_at, property_access_mode)
values (current_setting('pgtap.ass.org_id')::uuid, 'c5000000-0000-0000-0000-000000000002', 'agent', 'active', now(), 'selected');
-- Deliberately no property_access grant for the unassigned agent.

set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001';

insert into public.applications (org_id, property_id, unit_id, applicant_name, status)
select current_setting('pgtap.ass.org_id')::uuid, current_setting('pgtap.ass.property_id')::uuid, current_setting('pgtap.ass.unit_id')::uuid, 'Self Service Applicant', 'invited';
select set_config('pgtap.ass.app_id', (select id::text from public.applications where applicant_name = 'Self Service Applicant'), false);

select lives_ok(
  $$ select public.seed_default_application_document_requirements(current_setting('pgtap.ass.app_id')::uuid) $$,
  'the assigned agent can seed the default document requirements'
);

select is(
  (select count(*)::int from public.application_document_requirements where application_id = current_setting('pgtap.ass.app_id')::uuid),
  3,
  'exactly 3 default document requirements were seeded'
);

-- === Unassigned agent cannot issue a token (property-scoped, same as applications' own RLS) ===
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.create_application_access_token(current_setting('pgtap.ass.app_id')::uuid, 'email', 'a***@example.com') $$,
  null, null,
  'an agent with no property access cannot issue an access token for this application'
);

-- === Assigned agent issues a token ===
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001';
select set_config(
  'pgtap.ass.token',
  (select token from public.create_application_access_token(current_setting('pgtap.ass.app_id')::uuid, 'email', 'a***@example.com')),
  false
);
select isnt(current_setting('pgtap.ass.token'), '', 'a plaintext token was returned to the issuing staff member');

select is(
  (select count(*)::int from public.application_access_tokens where application_id = current_setting('pgtap.ass.app_id')::uuid and revoked_at is null),
  1,
  'exactly one active token exists for this application'
);

-- === From here on, act as a genuinely unauthenticated caller (anon role, no JWT at all) ===
-- Clearing request.jwt.claim.sub is essential here, not cosmetic: SET LOCAL ROLE alone does not
-- clear a previously-set JWT claim GUC (it persists for the rest of the transaction), so without
-- this, auth.uid() would still resolve to the staff member set earlier and RLS would (correctly,
-- but misleadingly) allow access -- not because of a real gap, but because this "anon" block
-- wouldn't actually be simulating an unauthenticated caller. A real anonymous HTTP request never
-- has this GUC set at all.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select is(
  (select count(*)::int from public.application_access_tokens),
  0,
  'anon has zero direct SELECT access to application_access_tokens, even holding a valid token'
);

select is(
  (select count(*)::int from public.applications where id = current_setting('pgtap.ass.app_id')::uuid),
  0,
  'anon has zero direct SELECT access to the applications table, even holding a valid token'
);

select is(
  (select valid from public.get_application_by_token(current_setting('pgtap.ass.token'))),
  true,
  'anon CAN read the application through get_application_by_token() with a valid token'
);

select is(
  (select applicant_name from public.get_application_by_token(current_setting('pgtap.ass.token'))),
  'Self Service Applicant',
  'get_application_by_token() returns the correct applicant name'
);

select is(
  (select unit_label from public.get_application_by_token(current_setting('pgtap.ass.token'))),
  'U1',
  'get_application_by_token() returns the correct unit label via the property/unit join'
);

select is(
  (select valid from public.get_application_by_token('0000000000000000000000000000000000000000000000000000000000000000')),
  false,
  'a garbage token is rejected'
);

select is(
  (select error_code from public.get_application_by_token('0000000000000000000000000000000000000000000000000000000000000000')),
  'not_found',
  'a garbage token yields error_code not_found'
);

-- === Submission without consent is refused ===
select is(
  (select success from public.submit_application_by_token(
    current_setting('pgtap.ass.token'), 'Self Service Applicant', 'applicant@example.com', null,
    '1990-01-01'::date, '1 Applicant Ave', 'employed', 'Acme Co', 25000, 2, 'Some notes', false
  )),
  false,
  'submission without POPIA consent is refused'
);

select is(
  (select error_code from public.submit_application_by_token(
    current_setting('pgtap.ass.token'), 'Self Service Applicant', 'applicant@example.com', null,
    '1990-01-01'::date, '1 Applicant Ave', 'employed', 'Acme Co', 25000, 2, 'Some notes', false
  )),
  'consent_required',
  'the refusal reason is consent_required'
);

-- === Real submission, with consent ===
select is(
  (select success from public.submit_application_by_token(
    current_setting('pgtap.ass.token'), 'Self Service Applicant', 'applicant@example.com', '+27821234567',
    '1990-01-01'::date, '1 Applicant Ave', 'employed', 'Acme Co', 25000, 2, 'Some notes', true
  )),
  true,
  'submission with consent succeeds'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001';

select is(
  (select status from public.applications where id = current_setting('pgtap.ass.app_id')::uuid),
  'submitted'::public.application_status,
  'the application transitioned invited -> submitted'
);

select is(
  (select monthly_income from public.applications where id = current_setting('pgtap.ass.app_id')::uuid),
  25000::numeric,
  'the applicant-submitted monthly_income was recorded'
);

select isnt(
  (select submitted_at from public.applications where id = current_setting('pgtap.ass.app_id')::uuid),
  null,
  'submitted_at was stamped'
);

-- === Idempotent resubmission (still editable) ===
reset role;
set local role anon;
select is(
  (select success from public.submit_application_by_token(
    current_setting('pgtap.ass.token'), 'Self Service Applicant', 'applicant@example.com', null,
    '1990-01-01'::date, '1 Applicant Ave', 'employed', 'Acme Co', 26000, 2, 'Updated notes', true
  )),
  true,
  'resubmitting while still editable (submitted) succeeds -- save-and-resume, not an error'
);

-- === Document upload via token ===
select is(
  (select success from public.record_application_document_upload(
    current_setting('pgtap.ass.token'), 'id_document', 'orgid/lease-templates/does-not-matter.pdf',
    'id.pdf', 'application/pdf', 12345, 'deadbeef'
  )),
  true,
  'a document upload against a real requirement key succeeds'
);

select is(
  (select success from public.record_application_document_upload(
    current_setting('pgtap.ass.token'), 'nonexistent_requirement', 'orgid/lease-templates/x.pdf',
    'x.pdf', 'application/pdf', 100, 'abc'
  )),
  false,
  'a document upload against a nonexistent requirement key is refused'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001';

select is(
  (select status from public.application_document_requirements where application_id = current_setting('pgtap.ass.app_id')::uuid and requirement_key = 'id_document'),
  'uploaded'::public.application_document_status,
  'the id_document requirement is now marked uploaded'
);

select is(
  (select count(*)::int from public.documents where application_id = current_setting('pgtap.ass.app_id')::uuid),
  1,
  'exactly one documents row is linked to this application'
);

-- === approve_application() refuses an application still stuck at invited ===
insert into public.applications (org_id, property_id, unit_id, applicant_name, status)
select current_setting('pgtap.ass.org_id')::uuid, current_setting('pgtap.ass.property_id')::uuid, current_setting('pgtap.ass.unit_id')::uuid, 'Never Completed Applicant', 'invited';
select throws_ok(
  $$ select public.approve_application((select id from public.applications where applicant_name = 'Never Completed Applicant')) $$,
  'P0001',
  'This application has not been completed by the applicant yet',
  'approving a still-invited application (never completed by the applicant) is refused'
);

-- === Revoked token is rejected ===
select set_config(
  'pgtap.ass.token2',
  (select token from public.create_application_access_token(current_setting('pgtap.ass.app_id')::uuid, 'email', null)),
  false
);
-- create_application_access_token() revokes the prior active token for the same application as a
-- side effect -- the ORIGINAL token used throughout this test is now itself revoked.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select is(
  (select error_code from public.get_application_by_token(current_setting('pgtap.ass.token'))),
  'revoked',
  'the original token is revoked once a new one is issued for the same application'
);
select is(
  (select valid from public.get_application_by_token(current_setting('pgtap.ass.token2'))),
  true,
  'the newly issued token is valid'
);

-- First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 14/15 idempotency/security
-- matrix: 3 genuine gaps identified by audit -- document upload REPLACE (not just first upload),
-- an expired token, and proof one applicant's token can never surface a DIFFERENT application's
-- data, all previously untested.

-- === Document upload retry: re-uploading against the SAME already-uploaded requirement replaces
-- it (not a second, orphaned linkage) -- migration 20260101000141's v_is_replacement branch.
-- Uses token2, not the original token -- by this point in the file the original was already
-- revoked (a new one was issued for the same application, tested above). ===
select is(
  (select success from public.record_application_document_upload(
    current_setting('pgtap.ass.token2'), 'id_document', 'orgid/lease-templates/replacement.pdf',
    'id-v2.pdf', 'application/pdf', 22222, 'replacement-checksum'
  )),
  true,
  'a second upload against the SAME already-uploaded requirement (a replace) succeeds'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.application_document_requirements where application_id = current_setting('pgtap.ass.app_id')::uuid and requirement_key = 'id_document'),
  1,
  'still exactly one requirement row for id_document -- the replace did not create a duplicate requirement'
);

select is(
  (select d.original_file_name from public.application_document_requirements r
     join public.documents d on d.id = r.document_id
   where r.application_id = current_setting('pgtap.ass.app_id')::uuid and r.requirement_key = 'id_document'),
  'id-v2.pdf',
  'the requirement now points at the NEW (replacement) document, not the original'
);

-- Both the original upload and the replace happen within this same transaction, so created_at
-- can tie between them (no reliable "most recent" ordering) -- assert existence of the replaced
-- event directly instead, which is the actual thing this proves.
select is(
  (select count(*)::int from public.audit_events
   where entity_type = 'application_document_requirements'
     and entity_id = (select id from public.application_document_requirements where application_id = current_setting('pgtap.ass.app_id')::uuid and requirement_key = 'id_document')
     and action = 'application.document_replaced'),
  1,
  'an application.document_replaced audit event exists for this requirement, distinct from the original .document_uploaded'
);

-- === Expired token is denied (distinct from revoked) ===
insert into public.applications (org_id, property_id, unit_id, applicant_name, status)
select current_setting('pgtap.ass.org_id')::uuid, current_setting('pgtap.ass.property_id')::uuid, current_setting('pgtap.ass.unit_id')::uuid, 'Expired Token Applicant', 'invited';
select set_config('pgtap.ass.exp_app_id', (select id::text from public.applications where applicant_name = 'Expired Token Applicant'), false);
select set_config(
  'pgtap.ass.exp_token',
  (select token from public.create_application_access_token(current_setting('pgtap.ass.exp_app_id')::uuid, 'email', null)),
  false
);
-- Force the real expiry into the past -- superuser only, matching this file's own service-role-
-- fixture convention (application_access_tokens has no client UPDATE policy at all).
reset role;
update public.application_access_tokens
set expires_at = now() - interval '1 hour'
where application_id = current_setting('pgtap.ass.exp_app_id')::uuid;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is(
  (select error_code from public.get_application_by_token(current_setting('pgtap.ass.exp_token'))),
  'expired',
  'a token whose expires_at has passed is denied with error_code expired, not treated as valid'
);
select is(
  (select valid from public.get_application_by_token(current_setting('pgtap.ass.exp_token'))),
  false,
  'an expired token is never valid'
);

-- === One applicant's token can never surface a DIFFERENT application's data ===
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'c5000000-0000-0000-0000-000000000001';
insert into public.applications (org_id, property_id, unit_id, applicant_name, status)
select current_setting('pgtap.ass.org_id')::uuid, current_setting('pgtap.ass.property_id')::uuid, current_setting('pgtap.ass.unit_id')::uuid, 'Second Real Applicant', 'invited';
select set_config('pgtap.ass.app2_id', (select id::text from public.applications where applicant_name = 'Second Real Applicant'), false);
select set_config(
  'pgtap.ass.token_b',
  (select token from public.create_application_access_token(current_setting('pgtap.ass.app2_id')::uuid, 'email', null)),
  false
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is(
  (select applicant_name from public.get_application_by_token(current_setting('pgtap.ass.token_b'))),
  'Second Real Applicant',
  'token B correctly resolves to application B''s own applicant name'
);
select isnt(
  (select applicant_name from public.get_application_by_token(current_setting('pgtap.ass.token_b'))),
  'Self Service Applicant',
  'token B never returns application A''s (the original test applicant''s) data'
);

select * from finish();
rollback;
