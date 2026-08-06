-- TASKS.md M9: applications (DATABASE.md §4). Captures a prospective tenant's application against
-- a specific unit, gated by POPIA/screening consent before screening can run, ending in a
-- decision. Approval's atomic tenant+lease+rent_schedule creation is its own function
-- (approve_application(), migration 20260101000031) so it stays testable/observable rather than
-- living in a trigger (DATABASE.md §4's own explicit instruction).

create type public.application_screening_status as enum ('not_started', 'in_progress', 'passed', 'failed');
create type public.application_status as enum ('submitted', 'screening', 'decided');
create type public.application_decision as enum ('approved', 'declined');

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  applicant_name text not null check (char_length(applicant_name) between 1 and 200),
  applicant_email citext,
  applicant_phone text,
  popia_consent_at timestamptz,
  screening_consent_at timestamptz,
  screening_status public.application_screening_status not null default 'not_started',
  status public.application_status not null default 'submitted',
  decision public.application_decision,
  decision_reason text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- decision and its bookkeeping columns are set together or not at all -- prevents a
  -- half-decided row (e.g. decision set but decided_at null) from ever existing.
  check (
    (decision is null and decided_at is null)
    or (decision is not null and decided_at is not null)
  ),
  -- screening cannot start before screening_consent_at is captured -- mirrors the evidenced
  -- POPIA-consent-gated flow (PRODUCT_SPEC.md §5) as a hard DB constraint, not just an API check,
  -- so this invariant holds even against a direct/service-role write.
  check (screening_status = 'not_started' or screening_consent_at is not null)
);

create index applications_org_status_idx on public.applications (org_id, status);
create index applications_unit_idx on public.applications (unit_id);

create trigger set_applications_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

alter table public.applications enable row level security;

create policy "applications_select_org_member"
  on public.applications for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "applications_write_agent_plus"
  on public.applications for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));
