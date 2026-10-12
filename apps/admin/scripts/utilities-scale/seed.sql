-- Smart Utilities SCALE dataset — DISPOSABLE databases only (docs/UTILITIES_PHASE3_VALIDATION_REPORT.md §Scalability).
-- Synthetic: 3 organisations × 100 properties × 10 units; per unit an electricity and a water submeter, per property
-- a main electricity and a main water meter (6 600 meters); 180 days of daily readings for every meter (~1.19 M rows)
-- plus 20 meters at 15-minute resolution for 30 days (57 600 rows); a fictional tariff and metered arrangements.
-- Run:  psql -v ON_ERROR_STOP=1 -1 -f seed.sql   (refuses on any database holding 200+ organisations)

do $$
begin
  if (select count(*) from public.organizations) >= 200 then
    raise exception 'Refusing: this database has 200+ organisations — scale data is for disposable databases only';
  end if;
end $$;

create temp table scale_orgs as
  select gen_random_uuid() as id, 'SCALE Org ' || g as name from generate_series(1, 3) g;
insert into public.organizations (id, legal_name, org_type, utilities_enabled) select id, name, 'agency', true from scale_orgs;

create temp table scale_props as
  select gen_random_uuid() as id, o.id as org_id, row_number() over () as n
    from scale_orgs o cross join generate_series(1, 100);
insert into public.properties (id, org_id, nickname, address_line1, city, province, postal_code)
  select id, org_id, 'SCALE Property ' || n, n || ' Scale Rd', 'Durban', 'KwaZulu-Natal', '4001' from scale_props;

create temp table scale_units as
  select gen_random_uuid() as id, p.id as property_id, p.org_id, g as n from scale_props p cross join generate_series(1, 10) g;
insert into public.units (id, property_id, org_id, unit_label) select id, property_id, org_id, 'U' || n from scale_units;

create temp table scale_meters as
  select gen_random_uuid() as id, u.org_id, u.property_id, u.id as unit_id, t.utility_type, 'submeter' as meter_role
    from scale_units u cross join (values ('electricity'), ('water')) t(utility_type)
  union all
  select gen_random_uuid(), p.org_id, p.id, null, t.utility_type, 'main'
    from scale_props p cross join (values ('electricity'), ('water')) t(utility_type);
-- Connected (http_push, daily) so the daily anomaly/health rules actually evaluate them; manual meters are skipped.
insert into public.utility_meters (id, org_id, property_id, unit_id, utility_type, responsibility_mode, meter_role, measurement_kind,
                                   connectivity, expected_interval_minutes, last_reading_at, health_status)
  select id, org_id, property_id, unit_id, utility_type::public.utility_type, 'owner_paid'::public.utility_responsibility_mode, meter_role, 'consumption',
         'http_push', 1440, now() - interval '2 hours', 'online' from scale_meters;

-- 180 days of daily cumulative readings (electricity ~8 kWh/day, water ~400 L/day, with variation), ending today.
insert into public.meter_telemetry_readings (org_id, property_id, meter_id, read_at, raw_value, multiplier, value, source, status)
  select m.org_id, m.property_id, m.id,
         date_trunc('day', now()) - make_interval(days => 180 - d) - interval '2 hours',
         v, 1, v, 'simulator', 'valid'
    from scale_meters m
    cross join generate_series(0, 180) d
    cross join lateral (select round((d * (case when m.utility_type = 'water' then 400 else 8 end) * (1 + (abs(hashtext(m.id::text)) % 50) / 100.0))::numeric, 3) as v) x;

-- 20 high-frequency meters (15-minute readings, 30 days).
insert into public.meter_telemetry_readings (org_id, property_id, meter_id, read_at, raw_value, multiplier, value, source, status)
  select m.org_id, m.property_id, m.id, now() - make_interval(mins => 15 * q) - interval '1 day', 100000 - q, 1, 100000 - q, 'simulator', 'valid'
    from (select * from scale_meters where meter_role = 'submeter' and utility_type = 'electricity' limit 20) m
    cross join generate_series(1, 2880) q;

insert into public.utility_tariffs (org_id, property_id, utility_type, name, tariff_kind, fixed_charge, blocks, vat_inclusive, vat_rate, effective_from)
  select p.org_id, p.id, 'electricity'::public.utility_type, 'SCALE FICTIONAL R3', 'flat', 60, '[{"upTo":null,"rate":3}]', true, 15, '2025-01-01' from scale_props p;

-- Leases + metered arrangements for every unit (electricity), so scheduled billing has real work to do.
create temp table scale_tenants as select gen_random_uuid() as id, u.id as unit_id, u.org_id from scale_units u;
insert into public.tenants (id, org_id, full_name, status) select id, org_id, 'SCALE Tenant', 'active'::public.tenant_status from scale_tenants;
create temp table scale_leases as select gen_random_uuid() as id, t.unit_id, t.org_id, t.id as tenant_id from scale_tenants t;
insert into public.leases (id, org_id, unit_id, start_date, rent_amount, status) select id, org_id, unit_id, '2025-01-01', 5000, 'active'::public.lease_status from scale_leases;
insert into public.lease_tenants (lease_id, tenant_id, is_primary) select id, tenant_id, true from scale_leases;
insert into public.utility_billing_arrangements (org_id, property_id, unit_id, utility_type, arrangement, effective_from)
  select u.org_id, u.property_id, u.id, 'electricity'::public.utility_type, 'metered_recharge', '2025-01-01' from scale_units u;

select (select count(*) from scale_props) as properties, (select count(*) from scale_units) as units,
       (select count(*) from scale_meters) as meters, (select count(*) from public.meter_telemetry_readings) as telemetry_rows;
