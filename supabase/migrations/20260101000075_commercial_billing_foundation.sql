-- Commercial-launch execution plan, Stage 4 (Phase 2 — Commercial SaaS, WORKLOG.md this date).
-- Schema foundation for real PayFast billing: trial-expiry tracking (currently absent entirely --
-- `organizations.status` defaults to 'trial' with no record of *when* the trial started or should
-- end, so nothing could ever expire one), a place to store PayFast's recurring-billing token
-- (needed for real subscription cancellation, not just checkout), and the three real commercial
-- plans replacing the single `TO_BE_CONFIRMED`-priced placeholder that was never actually seeded.

alter table public.organizations
  add column trial_ends_at timestamptz;

-- Backfill for any org that predates this column (none in this environment -- no production
-- deploy has happened yet, WORKLOG.md's own standing project state -- but written as a real
-- backfill, not skipped, matching this codebase's own established convention for schema changes
-- that add a not-immediately-derivable column).
update public.organizations
set trial_ends_at = created_at + interval '30 days'
where status = 'trial' and trial_ends_at is null;

alter table public.organization_subscriptions
  add column provider_subscription_token text;

comment on column public.organization_subscriptions.provider_subscription_token is
  'The gateway''s own recurring-billing token (PayFast: returned via ITN after the first
   successful subscription payment) -- required to call the gateway''s real cancel-subscription
   API later; null until that first payment webhook arrives.';

-- Real three-tier commercial plans (Starter/Professional/Business), replacing the never-seeded
-- placeholder. feature_limits mirrors the shape `packages/config`'s (dead, zero-usage-anywhere --
-- confirmed by grep before writing this) PlanConfig type used, kept here as the live source of
-- truth instead since `plans`/`organization_subscriptions` (this file, 20260101000019) is the
-- table structure actually wired into checkout/webhook processing (lib/billing.ts), not that
-- unused package.
insert into public.plans (code, name, billing_cycle, base_price, currency, feature_limits, is_active) values
  (
    'starter', 'Starter', 'monthly', 299.00, 'ZAR',
    jsonb_build_object(
      'maxProperties', 5, 'maxStaff', 1, 'ocrEnabled', false, 'ownerPortalEnabled', false,
      'advancedReporting', false, 'bulkCommunications', false
    ),
    true
  ),
  (
    'professional', 'Professional', 'monthly', 699.00, 'ZAR',
    jsonb_build_object(
      'maxProperties', 25, 'maxStaff', null, 'ocrEnabled', true, 'ownerPortalEnabled', true,
      'advancedReporting', true, 'bulkCommunications', true
    ),
    true
  ),
  (
    'business', 'Business', 'monthly', 1499.00, 'ZAR',
    jsonb_build_object(
      'maxProperties', null, 'maxStaff', null, 'ocrEnabled', true, 'ownerPortalEnabled', true,
      'advancedReporting', true, 'bulkCommunications', true, 'apiAccess', true, 'prioritySupport', true
    ),
    true
  )
on conflict (code, version) do nothing;

-- create_organization() (last redefined 20260101000035, adding seed_chart_of_accounts) now also
-- starts the 30-day trial clock -- "every organisation receives a 30-day free trial" per the
-- directive. Every other line is unchanged from the prior version.
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

  insert into public.organizations (legal_name, org_type, trial_ends_at)
  values (p_legal_name, p_org_type, now() + interval '30 days')
  returning id into v_org_id;

  insert into public.organization_members (org_id, user_id, role, status, joined_at)
  values (v_org_id, auth.uid(), 'principal', 'active', now());

  perform public.seed_chart_of_accounts(v_org_id);

  return v_org_id;
end;
$$;
