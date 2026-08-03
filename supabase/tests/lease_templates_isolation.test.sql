-- RLS isolation tests for `lease_templates` (supabase/migrations/20260101000056,
-- PWA_V1_COMPLETION_PLAN.md #9). Same has_org_role()-gated read/write pattern as every other
-- org-scoped table, plus a dedicated check of set_default_lease_template()'s atomic
-- clear-then-set behavior since that's the one piece of custom logic this table adds.

begin;
select plan(9);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'lt-principal-a@test.propertyvault.example'),
  ('e2000000-0000-0000-0000-000000000001', 'lt-agent-a@test.propertyvault.example'),
  ('e3000000-0000-0000-0000-000000000001', 'lt-principal-b@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Lease Template Test Org A', 'agency'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'Lease Template Test Org B', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('eeeeeeee-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('eeeeeeee-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'agent', 'active', now()),
  ('eeeeeeee-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001', 'principal', 'active', now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

insert into public.lease_templates (id, org_id, name, storage_path, original_file_name, mime_type, file_size_bytes, is_default, created_by)
values (
  'f0000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Standard Lease',
  'eeeeeeee-0000-0000-0000-000000000001/lease-templates/a.pdf', 'a.pdf', 'application/pdf', 1024, true,
  'e1000000-0000-0000-0000-000000000001'
);

select is(
  (select count(*) from public.lease_templates where org_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  1::bigint,
  'Org A principal can SELECT the template they just created'
);

-- === Agent (viewer+) can read but not write ===
set local "request.jwt.claim.sub" = 'e2000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.lease_templates where org_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  1::bigint,
  'Org A agent CAN SELECT the org''s lease template (read floor is viewer)'
);

select throws_ok(
  $$ insert into public.lease_templates (org_id, name, storage_path, original_file_name, mime_type, file_size_bytes, created_by)
     values ('eeeeeeee-0000-0000-0000-000000000001', 'Agent Upload', 'x/y.pdf', 'y.pdf', 'application/pdf', 10, 'e2000000-0000-0000-0000-000000000001') $$,
  'new row violates row-level security policy for table "lease_templates"',
  'Org A agent cannot INSERT a lease template (write floor is manager)'
);

-- === Cross-org isolation ===
set local "request.jwt.claim.sub" = 'e3000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.lease_templates where org_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B principal cannot SELECT Org A''s lease template'
);

select lives_ok(
  $$ update public.lease_templates set name = 'hacked' where id = 'f0000000-0000-0000-0000-000000000001' $$,
  'Org B principal UPDATE against Org A''s template runs without error (RLS silently filters to zero rows, verified next)'
);

select is(
  (select count(*) from public.lease_templates where id = 'f0000000-0000-0000-0000-000000000001' and name = 'hacked'),
  0::bigint,
  'Org B principal''s update did not actually change Org A''s template'
);

-- === set_default_lease_template(): atomic clear-then-set ===
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

insert into public.lease_templates (id, org_id, name, storage_path, original_file_name, mime_type, file_size_bytes, is_default, created_by)
values (
  'f0000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'Alternate Lease',
  'eeeeeeee-0000-0000-0000-000000000001/lease-templates/b.pdf', 'b.pdf', 'application/pdf', 2048, false,
  'e1000000-0000-0000-0000-000000000001'
);

select public.set_default_lease_template('f0000000-0000-0000-0000-000000000002');

select is(
  (select is_default from public.lease_templates where id = 'f0000000-0000-0000-0000-000000000002'),
  true,
  'set_default_lease_template() makes the target template the default'
);

select is(
  (select is_default from public.lease_templates where id = 'f0000000-0000-0000-0000-000000000001'),
  false,
  'set_default_lease_template() clears the org''s previous default'
);

select is(
  (select count(*) from public.lease_templates where org_id = 'eeeeeeee-0000-0000-0000-000000000001' and is_default and status = 'active'),
  1::bigint,
  'exactly one active default remains for the org (partial unique index invariant holds)'
);

select * from finish();
rollback;
