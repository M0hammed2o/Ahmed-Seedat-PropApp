-- Local development seed data only. Never applied to a production project (see DEPLOYMENT.md).
-- Assumes two auth.users already exist locally (create them via `supabase auth` or the Studio
-- UI first, e.g. dev1@example.test / dev2@example.test) — this file seeds the domain data
-- around whatever two user ids you substitute below.

-- Updated 2026-07-30 (TASKS.md M5): properties are org-scoped now. Seed data creates an
-- organization + membership directly (not via create_organization()/accept_organization_invite()
-- — those are security-definer RPCs keyed on auth.uid() session context, which a seed script run
-- with full DB privileges doesn't have; direct inserts are the normal, expected pattern for
-- trusted local-dev seed tooling, distinct from the "never insert into organizations directly
-- from a client" application-layer rule in DATABASE.md, which is about the app's own client code).
do $$
declare
  v_user1 uuid;
  v_user2 uuid;
  v_org1 uuid;
  v_org2 uuid;
  v_property1 uuid;
  v_category_water uuid;
  v_category_electricity uuid;
begin
  select id into v_user1 from auth.users order by created_at asc limit 1;
  select id into v_user2 from auth.users order by created_at asc offset 1 limit 1;

  if v_user1 is null then
    raise notice 'No auth.users found — sign up at least one local dev user before seeding.';
    return;
  end if;

  select id into v_category_water from public.document_categories where slug = 'water';
  select id into v_category_electricity from public.document_categories where slug = 'electricity';

  insert into public.organizations (legal_name, org_type)
  values ('Dev User 1''s Organisation', 'owner_managed')
  returning id into v_org1;

  insert into public.organization_members (org_id, user_id, role, status, joined_at)
  values (v_org1, v_user1, 'principal', 'active', now());

  insert into public.properties (org_id, nickname, address_line1, suburb, city, province, postal_code, country, property_type)
  values (v_org1, 'Sea Point Apartment', '12 Beach Road', 'Sea Point', 'Cape Town', 'Western Cape', '8005', 'ZA', 'apartment')
  returning id into v_property1;

  insert into public.property_expected_categories (property_id, category_id, is_expected)
  values
    (v_property1, v_category_water, true),
    (v_property1, v_category_electricity, true);

  if v_user2 is not null then
    insert into public.organizations (legal_name, org_type)
    values ('Dev User 2''s Organisation', 'owner_managed')
    returning id into v_org2;

    insert into public.organization_members (org_id, user_id, role, status, joined_at)
    values (v_org2, v_user2, 'principal', 'active', now());

    insert into public.properties (org_id, nickname, address_line1, city, country, property_type)
    values (v_org2, 'Second Dev Property', '1 Example Street', 'Johannesburg', 'ZA', 'house');
  end if;
end $$;
