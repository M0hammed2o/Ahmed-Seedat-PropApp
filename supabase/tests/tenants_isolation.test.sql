-- RLS isolation tests for `tenants` (TASKS.md M8, supabase/migrations/20260101000028) and
-- `encrypted_secrets` (20260101000027). Mirrors the owners_isolation coverage already exercised
-- indirectly in multi_tenant_isolation.test.sql, but focused specifically on tenants' self-access
-- carve-out (a tenant with a portal identity can see their own record even outside org membership)
-- since that's the one behavior genuinely new to this table, not shared with owners/units/properties.

begin;
select plan(10);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'tenant-agent-a@test.propertyvault.example'),
  ('f2000000-0000-0000-0000-000000000001', 'tenant-agent-b@test.propertyvault.example'),
  ('f3000000-0000-0000-0000-000000000001', 'tenant-self@test.propertyvault.example'),
  ('f4000000-0000-0000-0000-000000000001', 'tenant-viewer-a@test.propertyvault.example');

insert into public.organizations (id, legal_name, org_type)
values
  ('cccccccc-0000-0000-0000-000000000001', 'Tenant Test Org A', 'agency'),
  ('dddddddd-0000-0000-0000-000000000001', 'Tenant Test Org B', 'agency');

insert into public.organization_members (org_id, user_id, role, status, joined_at)
values
  ('cccccccc-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('dddddddd-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'principal', 'active', now()),
  ('cccccccc-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'viewer', 'active', now());

-- A tenant with a portal identity (user_id set), belonging to Org A, but holding NO
-- organization_members row anywhere -- proves the self-access carve-out is independent of org
-- membership, exactly like owners_select_org_or_self.
insert into public.tenants (id, org_id, user_id, full_name, status)
values ('55550000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        'f3000000-0000-0000-0000-000000000001', 'Self-Access Test Tenant', 'active');

set local role authenticated;

-- === Cross-org isolation ===
set local "request.jwt.claim.sub" = 'f2000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.tenants where org_id = 'cccccccc-0000-0000-0000-000000000001'),
  0::bigint,
  'Org B principal cannot SELECT Org A''s tenants'
);

select lives_ok(
  $$ update public.tenants set full_name = 'hacked'
     where id = '55550000-0000-0000-0000-000000000001' $$,
  'Org B principal UPDATE against Org A''s tenant runs without error (RLS silently filters to zero rows, verified next)'
);

select is(
  (select count(*) from public.tenants where id = '55550000-0000-0000-0000-000000000001' and full_name = 'hacked'),
  0::bigint,
  'Org B principal''s update did not actually change Org A''s tenant'
);

-- === Role-scoped write denial: Org A's viewer can read but not write, even within their own org ===
set local "request.jwt.claim.sub" = 'f4000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.tenants where org_id = 'cccccccc-0000-0000-0000-000000000001'),
  1::bigint,
  'Org A viewer CAN SELECT their own org''s tenant (viewer has read access)'
);

select lives_ok(
  $$ update public.tenants set full_name = 'viewer-write-attempt'
     where id = '55550000-0000-0000-0000-000000000001' $$,
  'Org A viewer UPDATE against their own org''s tenant runs without error (has_org_role requires agent+, silently filters to zero rows, verified next)'
);

select is(
  (select count(*) from public.tenants where id = '55550000-0000-0000-0000-000000000001' and full_name = 'viewer-write-attempt'),
  0::bigint,
  'Org A viewer''s write attempt did not change the tenant (role-gated, not just org-gated)'
);

-- === Self-access carve-out: the tenant themselves can SELECT their own record despite holding
--     zero organization_members rows anywhere ===
set local "request.jwt.claim.sub" = 'f3000000-0000-0000-0000-000000000001';

select is(
  (select full_name from public.tenants where id = '55550000-0000-0000-0000-000000000001'),
  'Self-Access Test Tenant',
  'the tenant themselves (user_id match, zero org memberships) can SELECT their own tenant record'
);

-- No self-write policy exists (deliberate -- no tenant portal in V1); confirm the tenant cannot
-- edit their own record either, same lives_ok-then-verify pattern.
select lives_ok(
  $$ update public.tenants set full_name = 'self-edit-attempt'
     where id = '55550000-0000-0000-0000-000000000001' $$,
  'the tenant''s own UPDATE attempt against their own record runs without error (no self-write policy exists, silently filtered, verified next)'
);

select is(
  (select full_name from public.tenants where id = '55550000-0000-0000-0000-000000000001'),
  'Self-Access Test Tenant',
  'the tenant''s self-edit attempt did not apply -- read-only self-access, matching the "no tenant portal in V1" decision'
);

-- === encrypted_secrets: zero client policies means deny-by-default to every authenticated user,
--     including the org staff member who could otherwise see the referencing tenant row. Same
--     pattern/reasoning as support_access_sessions in multi_tenant_isolation.test.sql. ===
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.encrypted_secrets),
  0::bigint,
  'An ordinary authenticated org principal reads zero rows from encrypted_secrets (no policy grants access -- service-role/application-layer-encryption only)'
);

select * from finish();
rollback;
