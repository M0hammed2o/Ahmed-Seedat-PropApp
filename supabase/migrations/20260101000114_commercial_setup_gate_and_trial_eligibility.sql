-- Commercial plan restructure, Part 4 (WORKLOG.md this date): "every new principal must choose a
-- paid plan and register a payment method before using the main system."
--
-- GRANDFATHERING (deliberate, safety-critical): only 1 of 14 organizations currently in this
-- database has ever had an organization_subscriptions row (confirmed live before writing this).
-- Flipping property/staff/owner creation to require completed commercial setup with no
-- grandfathering would immediately lock the other 13 out of resources they already use today --
-- a real, avoidable regression this migration explicitly prevents by backfilling every EXISTING
-- organization as already-set-up. Only organizations created AFTER this migration runs are subject
-- to the new gate.

alter table public.organizations
  add column commercial_setup_completed_at timestamptz;

comment on column public.organizations.commercial_setup_completed_at is
  'Set once a plan is selected, a billing interval is chosen, and a payment method is verified via
   a real gateway confirmation (never client-asserted) -- see activate_trial_after_payment(). NULL
   means "still in mandatory setup": create_organization() no longer starts trial_ends_at itself
   (RELEASE B business-model change), so a null value here also means trial_ends_at is null and
   the org has not yet begun its 30-day clock. Backfilled to created_at for every pre-existing
   organization (grandfathering, see this migration''s own header comment) -- never null for an org
   that predates this column.';

update public.organizations
set commercial_setup_completed_at = created_at
where commercial_setup_completed_at is null;

-- create_organization() no longer starts the trial clock itself -- that now happens in
-- activate_trial_after_payment() below, once commercial setup genuinely completes. Every other
-- line is unchanged from 20260101000094's version (still enforces may_create_portfolio()).
create or replace function public.create_organization(
  p_legal_name text,
  p_org_type public.organization_type default 'owner_managed'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'create_organization requires an authenticated user';
  end if;

  if not public.may_create_portfolio(auth.uid()) then
    raise exception 'owner_subscription_required: an active Proplyst owner subscription is required to create your own portfolio.';
  end if;

  insert into public.organizations (legal_name, org_type, commercial_setup_completed_at, trial_ends_at)
  values (p_legal_name, p_org_type, null, null)
  returning id into v_org_id;

  insert into public.organization_members (org_id, user_id, role, status, joined_at)
  values (v_org_id, auth.uid(), 'principal', 'active', now());

  perform public.seed_chart_of_accounts(v_org_id);

  return v_org_id;
end;
$$;

-- activate_trial_after_payment(): the ONE place commercial_setup_completed_at/trial_ends_at are
-- ever set going forward. security definer + revoked from authenticated -- called exclusively from
-- lib/billing.ts's processBillingWebhookEvent() (service-role), the same trust boundary
-- organization_subscriptions/subscription_payments/payment_methods writes already use. A client
-- cannot call this directly to fabricate its own "trial activated" state.
create or replace function public.activate_trial_after_payment(
  p_org_id uuid,
  p_trial_days integer default 30
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.organizations
  set
    commercial_setup_completed_at = coalesce(commercial_setup_completed_at, now()),
    trial_ends_at = coalesce(trial_ends_at, now() + make_interval(days => p_trial_days)),
    status = case when status = 'trial' then status else status end
  where id = p_org_id;
end;
$$;

comment on function public.activate_trial_after_payment(uuid, integer) is
  'Idempotent (coalesce -- a retried webhook never resets an already-running trial clock). Called
   once, from processBillingWebhookEvent()''s first-activation branch, after a real gateway
   confirmation that a valid payment method is on file -- never from client-reachable code.';

revoke all on function public.activate_trial_after_payment(uuid, integer) from public, authenticated, anon;
grant execute on function public.activate_trial_after_payment(uuid, integer) to service_role;

-- ============================================================
-- Trial eligibility (one introductory trial per genuine principal/payment instrument, not per
-- email address alone). Deliberately NOT IP/device-based -- per this pass's own instruction, those
-- are secondary risk signals at most, never the sole automatic reason to deny a trial, and this
-- migration does not store them at all (no invasive tracking).
-- ============================================================
create table public.trial_usage_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  principal_user_id uuid not null references auth.users(id),
  payment_provider_reference text,
  verified_phone_e164 text,
  company_registration_number text,
  started_at timestamptz not null default now()
);

comment on table public.trial_usage_records is
  'One row per organization that has ever activated a trial (written by
   activate_trial_after_payment()''s caller alongside it). Matched against on a NEW trial attempt
   by principal_user_id, payment_provider_reference, verified_phone_e164, or
   company_registration_number -- any one strong match is sufficient signal, per this pass''s own
   "strong signals" list. IP/device are deliberately never columns here.';

create index trial_usage_records_principal_idx on public.trial_usage_records (principal_user_id);
create index trial_usage_records_payment_ref_idx
  on public.trial_usage_records (payment_provider_reference) where payment_provider_reference is not null;
create index trial_usage_records_phone_idx
  on public.trial_usage_records (verified_phone_e164) where verified_phone_e164 is not null;
create index trial_usage_records_reg_no_idx
  on public.trial_usage_records (company_registration_number) where company_registration_number is not null;

alter table public.trial_usage_records enable row level security;

-- No client policy at all (select or write) -- this is a fraud/risk-signal table; per this pass's
-- own explicit instruction ("do not expose internal fraud/risk signals to users"), nothing here is
-- ever readable by an ordinary authenticated session, only service-role application code.
revoke all on table public.trial_usage_records from anon, authenticated;

create or replace function public.has_used_trial_before(
  p_principal_user_id uuid,
  p_payment_provider_reference text default null,
  p_verified_phone_e164 text default null,
  p_company_registration_number text default null
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.trial_usage_records t
    where t.principal_user_id = p_principal_user_id
       or (p_payment_provider_reference is not null and t.payment_provider_reference = p_payment_provider_reference)
       or (p_verified_phone_e164 is not null and t.verified_phone_e164 = p_verified_phone_e164)
       or (p_company_registration_number is not null and t.company_registration_number = p_company_registration_number)
  );
$$;

comment on function public.has_used_trial_before(uuid, text, text, text) is
  'True if ANY strong identity signal matches a prior trial_usage_records row. A Super Admin manual
   override for a false positive is the existing platform_admin_users super_admin role acting via
   service-role (no new schema needed for that -- an admin can insert a synthetic
   organization_subscriptions row / adjust trial_ends_at directly, matching how every other manual
   billing override already works in this codebase, e.g. POST /api/v1/admin/organizations/:id/credits).';

revoke all on function public.has_used_trial_before(uuid, text, text, text) from public, authenticated, anon;
grant execute on function public.has_used_trial_before(uuid, text, text, text) to service_role;
