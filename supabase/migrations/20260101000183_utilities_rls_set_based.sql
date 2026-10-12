-- Utilities RLS at scale (docs/UTILITIES_PHASE3_VALIDATION_REPORT.md §Scalability).
--
-- Found by the scale benchmark (3 orgs, 300 properties, 6 600 meters, 1.25 M readings): every utilities policy
-- called can_read_/can_write_property_utilities(org_id, property_id) PER ROW. A manager listing their meters ran
-- both helpers 6 611 times (~3.7 ms each): 24.6 s, past the API statement timeout — the portfolio page failed.
--
-- Same rule, evaluated per PROPERTY instead of per row: utility_read_property_ids() / utility_write_property_ids()
-- return the (org_id, property_id) pairs the caller passes the UNCHANGED helper for, and every policy tests
-- membership in that set (planned as a hashed subplan, computed once per statement). The helpers are only evaluated
-- for candidate properties: those of organisations the caller belongs to, properties the caller holds a
-- property_access grant on, and organisations under the caller's active platform support session — exactly the
-- three ways has_org_role()/has_property_access() can ever return true, so the candidate set is a superset and the
-- visible rows are identical. Verified by the full pgTAP isolation suite and the utilities integration tests.

create or replace function public.utility_candidate_property_ids()
returns table (org_id uuid, property_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id, p.id
    from public.properties p
   where p.org_id in (select om.org_id from public.organization_members om where om.user_id = auth.uid())
      or p.id in (select pa.property_id from public.property_access pa where pa.user_id = auth.uid())
      or p.org_id in (
        select sas.org_id from public.support_access_sessions sas
         where sas.ended_at is null and sas.platform_admin_id = public.caller_platform_admin_id()
      );
$$;

create or replace function public.utility_read_property_ids()
returns table (org_id uuid, property_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select c.org_id, c.property_id from public.utility_candidate_property_ids() c
   where public.can_read_property_utilities(c.org_id, c.property_id);
$$;

create or replace function public.utility_write_property_ids()
returns table (org_id uuid, property_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select c.org_id, c.property_id from public.utility_candidate_property_ids() c
   where public.can_write_property_utilities(c.org_id, c.property_id);
$$;

revoke all on function public.utility_candidate_property_ids() from public, anon;
revoke all on function public.utility_read_property_ids() from public, anon;
revoke all on function public.utility_write_property_ids() from public, anon;
grant execute on function public.utility_candidate_property_ids() to authenticated, service_role;
grant execute on function public.utility_read_property_ids() to authenticated, service_role;
grant execute on function public.utility_write_property_ids() to authenticated, service_role;

-- Rewrite every policy that calls a helper per row. The helper call `can_X_property_utilities(a, b)` becomes
-- `((a, b) IN (SELECT r.org_id, r.property_id FROM utility_{read|write}_property_ids() r))` — same arguments, same meaning.
do $$
declare
  pol record;
  q text;
  c text;
  sql text;
begin
  for pol in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual ~ 'can_(read|write)_property_utilities\(' or with_check ~ 'can_(read|write)_property_utilities\(')
  loop
    q := regexp_replace(pol.qual, 'can_(read|write)_property_utilities\(([^,()]+), ([^,()]+)\)',
                        '((\2, \3) IN (SELECT r.org_id, r.property_id FROM public.utility_\1_property_ids() r))', 'g');
    c := regexp_replace(pol.with_check, 'can_(read|write)_property_utilities\(([^,()]+), ([^,()]+)\)',
                        '((\2, \3) IN (SELECT r.org_id, r.property_id FROM public.utility_\1_property_ids() r))', 'g');
    sql := format('alter policy %I on public.%I', pol.policyname, pol.tablename);
    if q is not null then sql := sql || format(' using (%s)', q); end if;
    if c is not null then sql := sql || format(' with check (%s)', c); end if;
    execute sql;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and (qual ~ 'can_(read|write)_property_utilities\(' or with_check ~ 'can_(read|write)_property_utilities\(')) then
    raise exception 'utilities RLS rewrite incomplete';
  end if;
end $$;
