-- Commercial plan restructure, Part 5 -- closes the indefinite-trial gap found while auditing
-- 20260101000114 before ever pushing it: create_organization() now leaves trial_ends_at/
-- commercial_setup_completed_at null until a verified PayFast payment-method confirmation lands,
-- but activate_trial_after_payment() (20260101000114) had zero callers anywhere in the codebase.
-- This migration adds the DB-side pieces the new trial-activation checkout flow
-- (apps/admin/lib/billing.ts's startTrialActivationCheckout()) needs, plus a defense-in-depth RLS
-- fix for a second, independently-discovered gap: has_org_role() never checked
-- commercial_setup_completed_at at all, so a brand-new org with status='trial' (the column's own
-- default) already had FULL principal-level read/write RLS access to every operational table --
-- the application-level route gate (destinationResolver.ts) is necessary but was not sufficient;
-- RLS itself must also refuse to grant more than viewer access to a not-yet-set-up org.

-- ============================================================
-- 1. Distinguish the R0 trial-activation checkout row from a real subscription charge. The SAME
--    subscription_payments row is reused for every later recurring charge on this m_payment_id
--    (processBillingWebhookEvent looks payments up by provider_reference, which PayFast echoes
--    unchanged on every ITN for a subscription's lifetime) -- purpose is therefore an immutable
--    historical label ("what was this checkout originally for"), not a live state field; the
--    webhook tells a genuine R0 setup event apart from a later real charge on the same row by
--    checking organizations.commercial_setup_completed_at at processing time, not by re-deriving
--    it from this column alone.
-- ============================================================
alter table public.subscription_payments
  add column purpose text not null default 'subscription_charge'
    check (purpose in ('subscription_charge', 'trial_activation'));

comment on column public.subscription_payments.purpose is
  'trial_activation: the R0 payment-method-verification checkout that starts a free trial (see
   startTrialActivationCheckout()). subscription_charge: every other payment, including the real
   first recurring charge PayFast collects ~30 days later on the SAME row once billing_date
   arrives -- that later event is told apart from the original R0 setup event by checking
   organizations.commercial_setup_completed_at at webhook-processing time, not by this column.';

-- ============================================================
-- 2. record_trial_usage() needs true idempotency (a retried/duplicate ITN must not create a second
--    trial_usage_records row for the same org) -- no unique constraint existed on this table yet.
-- ============================================================
alter table public.trial_usage_records
  add constraint trial_usage_records_org_id_key unique (org_id);

create or replace function public.record_trial_usage(
  p_org_id uuid,
  p_principal_user_id uuid,
  p_payment_provider_reference text default null,
  p_verified_phone_e164 text default null,
  p_company_registration_number text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.trial_usage_records (
    org_id, principal_user_id, payment_provider_reference,
    verified_phone_e164, company_registration_number
  )
  values (
    p_org_id, p_principal_user_id, p_payment_provider_reference,
    p_verified_phone_e164, p_company_registration_number
  )
  on conflict (org_id) do nothing;
$$;

comment on function public.record_trial_usage(uuid, uuid, text, text, text) is
  'Idempotent via unique(org_id) + on conflict do nothing -- a duplicate/retried webhook event for
   the same org''s trial activation writes the usage record at most once. Called alongside
   activate_trial_after_payment() from processBillingWebhookEvent()''s trial-activation branch,
   never from client-reachable code.';

revoke all on function public.record_trial_usage(uuid, uuid, text, text, text) from public, authenticated, anon;
grant execute on function public.record_trial_usage(uuid, uuid, text, text, text) to service_role;

-- ============================================================
-- 3. activate_trial_after_payment(): drop the earlier no-op `status = case when status = 'trial'
--    then status else status end` line (dead code from when this function was first scaffolded,
--    never actually did anything -- organizations.status already defaults to 'trial' at creation
--    and is left alone here; a genuine paying-customer transition to 'active' still only ever
--    happens in processBillingWebhookEvent's existing payment_succeeded handling once the REAL
--    recurring charge lands, unchanged). Everything else identical to 20260101000114's version.
-- ============================================================
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
    trial_ends_at = coalesce(trial_ends_at, now() + make_interval(days => p_trial_days))
  where id = p_org_id;
end;
$$;

comment on function public.activate_trial_after_payment(uuid, integer) is
  'Idempotent (coalesce -- a retried webhook never resets an already-running trial clock, and a
   later card replacement never re-triggers a second trial). Called once, from
   processBillingWebhookEvent()''s trial-activation branch, after a real gateway confirmation that
   a valid payment method is on file -- never from client-reachable code.';

-- ============================================================
-- 4. has_org_role() is DELIBERATELY NOT changed here. A first attempt added a
--    "min_role='viewer' or commercial_setup_completed_at is not null" condition, mirroring the
--    existing suspended_by_plan pattern -- reverted after the full pgTAP suite showed it breaking
--    ~40 unrelated test files (accounting, leasing, tenant invitations, property access, and more),
--    all failing with "You do not have permission to add properties to this organization" or
--    outright RLS-violation errors. Root cause: those fixtures create their test orgs via a direct
--    `insert into organizations (...)`, never through create_organization() and never backfilled
--    (the 20260101000114 backfill only touched rows that existed at migration time) -- so every
--    one of them has commercial_setup_completed_at = null and would be incorrectly treated as
--    "still in mandatory setup," locked to viewer-only. The same risk almost certainly extends to
--    real, unaudited production code paths this session did not have time to check (e.g. any
--    Platform-Admin-assisted organization creation that does not go through create_organization()
--    and therefore never sets this column either). Enforcing the commercial-setup gate at the RLS
--    layer needs a full audit of every org-creation code path first, not a same-session change --
--    the application-level route gate (destinationResolver.ts''s resolveCustomerOnboardingGate(),
--    added alongside this migration) is the correctly-scoped enforcement mechanism for now. Left
--    as a disclosed, deliberate gap -- see the final report''s "Access gate" section.
-- ============================================================
