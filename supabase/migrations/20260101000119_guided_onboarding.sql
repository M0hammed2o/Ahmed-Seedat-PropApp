-- V1 commercial onboarding pass, Phase 4: guided onboarding architecture.
--
-- Deliberately NOT one big "onboarding_completed" boolean or a rigid stored step-machine. Almost
-- every step in the guided sequence (email confirmed, plan chosen, payment method added, trial
-- active, first property/unit/tenant/lease) is already fully derivable from real, existing tables
-- -- storing a REDUNDANT "completed" flag for any of those risks drifting out of sync with reality
-- (e.g. a property created through some other path never flipping the flag). This table exists
-- ONLY for the handful of facts that are NOT inferrable from system state at all: an explicit
-- skip, and "has this customer already seen the interactive walkthrough." Everything else is
-- computed live by resolveOnboardingProgress() (apps/admin/lib/onboarding.ts) querying
-- properties/units/tenants/leases/organization_invites/organization_members directly.
create table public.organization_onboarding_state (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  staff_step_skipped_at timestamptz,
  viewed_payments_intro_at timestamptz,
  viewed_documents_intro_at timestamptz,
  walkthrough_dismissed_at timestamptz,
  walkthrough_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organization_onboarding_state is
  'One row per organization, created lazily on first read/write (not at organization creation --
   an org that never engages with onboarding simply never gets a row, and every column here is
   individually optional/nullable so a missing row means exactly the same thing as a row with
   everything null: nothing has been explicitly skipped, viewed, or dismissed yet). Every OTHER
   onboarding fact (property/unit/tenant/lease/staff existence, plan chosen, payment method added,
   trial active) is deliberately NOT duplicated here -- see resolveOnboardingProgress().';

create trigger set_organization_onboarding_state_updated_at
  before update on public.organization_onboarding_state
  for each row execute function public.set_updated_at();

alter table public.organization_onboarding_state enable row level security;

-- Read: any active org member (viewer+) can see onboarding progress -- it's informational, not
-- sensitive, matching e.g. organizations' own select policy shape.
create policy organization_onboarding_state_select_same_org
  on public.organization_onboarding_state for select
  using (has_org_role(org_id, 'viewer'::organization_member_role));

-- Write: agent+ can mark steps skipped/viewed/dismissed -- deliberately not principal-only, since
-- any staff member using the app can legitimately dismiss the walkthrough or mark a section
-- viewed for themselves; this table is per-ORG (shared UI progress), not per-user, matching how
-- the checklist is meant to reflect the org's overall setup state to everyone on the team.
create policy organization_onboarding_state_write_agent_plus
  on public.organization_onboarding_state for all
  using (has_org_role(org_id, 'agent'::organization_member_role))
  with check (has_org_role(org_id, 'agent'::organization_member_role));
