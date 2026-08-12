-- Real bug found and fixed via E2E testing (WORKLOG.md this date, Task 8): a tenant created
-- through the ordinary manual staff workflow (POST /api/v1/tenants -> POST /api/v1/leases ->
-- assign tenant -> activate_lease()) is left at tenants.status = 'pending' FOREVER -- confirmed
-- by reading every write path to tenants.status in this codebase: the only place that ever sets
-- it to 'active' is approve_application() (migration 20260101000031, the tenant-screening-
-- application path). activate_lease() (20260101000078) never touches tenants.status at all.
--
-- activate_property_rule_version()'s requirement-assignment query (20260101000097) required
-- `t.status = 'active'` (copied from tenantSession.ts's own pre-existing isActive convention,
-- `row.status === 'active' && lease?.status === 'active'`) -- which meant a real, currently-housed
-- tenant created through the manual (non-application) flow -- the SAME flow this repo's own
-- e2e/property-lease-workflow.spec.ts already exercises as its primary happy path -- would NEVER
-- be assigned a compliance requirement at all, silently. This was caught by this session's own new
-- Playwright E2E coverage going through the real POST /api/v1/tenants route (pgTAP's own fixtures
-- had inserted tenants with status='active' directly, masking the gap).
--
-- Fix: the lease's own status ('active' = currently in force) is the authoritative signal for
-- "is this tenancy current" -- tenants.status only needs to exclude a genuinely 'expired' tenant
-- record (a former occupant whose lease_tenants/leases rows may not have been cleaned up), not
-- also require the separate, largely-unused 'active' tenant-status promotion this manual flow
-- never performs. Scoped narrowly to this one query, not a redesign of tenants.status' own
-- meaning elsewhere (tenantSession.ts's isActive computation is left untouched -- a separate,
-- disclosed, PRE-EXISTING gap outside this compliance-workflow migration's scope, see the
-- completion report).
create or replace function public.activate_property_rule_version(p_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule_id uuid;
  v_org_id uuid;
  v_property_id uuid;
  v_status public.property_rule_version_status;
  v_prior_active_id uuid;
  v_assigned_count integer;
begin
  select prv.rule_id, prv.org_id, pr.property_id, prv.status
    into v_rule_id, v_org_id, v_property_id, v_status
    from public.property_rule_versions prv
    join public.property_rules pr on pr.id = prv.rule_id
    where prv.id = p_version_id;
  if v_rule_id is null then
    raise exception 'Rule version not found';
  end if;
  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Only agent-or-above staff can activate a rule version';
  end if;
  if v_status = 'active' then
    return 0; -- already active, idempotent no-op
  end if;
  if v_status not in ('draft', 'archived') then
    raise exception 'Only a draft or archived version can be activated (current status: %)', v_status;
  end if;

  select id into v_prior_active_id
    from public.property_rule_versions
    where rule_id = v_rule_id and status = 'active';

  if v_prior_active_id is not null then
    update public.property_rule_versions
      set status = 'superseded', superseded_at = now(), superseded_by = p_version_id
      where id = v_prior_active_id;
    update public.compliance_requirements
      set status = 'superseded', superseded_at = now()
      where rule_version_id = v_prior_active_id and status in ('pending', 'viewed');
  end if;

  update public.property_rule_versions
    set status = 'active', activated_at = now()
    where id = p_version_id;

  insert into public.compliance_requirements (org_id, property_id, rule_version_id, tenant_id, lease_id, status)
  select
    v_org_id, v_property_id, p_version_id, t.id, lt.lease_id, 'pending'
  from public.tenants t
  join public.lease_tenants lt on lt.tenant_id = t.id
  join public.leases l on l.id = lt.lease_id
  join public.units u on u.id = l.unit_id
  where u.property_id = v_property_id
    and t.status <> 'expired'
    and l.status = 'active'
  on conflict (rule_version_id, tenant_id) do nothing;

  get diagnostics v_assigned_count = row_count;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_org_id, auth.uid(), 'user', 'property_rule_version.activated', 'property_rule_versions', p_version_id,
    jsonb_build_object('ruleId', v_rule_id, 'propertyId', v_property_id, 'requirementsAssigned', v_assigned_count)
  );

  return v_assigned_count;
end;
$$;

comment on function public.activate_property_rule_version(uuid) is
  'Activates a draft/archived rule version, supersedes the rule''s prior active version (never
   mutating its historical acknowledgements), and assigns a PENDING compliance_requirement to
   every tenancy currently active on the property -- "currently active" means the LEASE is active
   (tenants.status is only checked to exclude an explicitly expired tenant record, not required to
   equal ''active'', since the ordinary manual tenant-creation flow never promotes it there).
   Returns the number of requirements assigned. agent+ only.';
