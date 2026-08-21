-- V1 commercial onboarding pass, Phases 16-19: payment method update + failed-payment recovery.
--
-- An already-set-up organization currently has NO way to add/replace a payment method --
-- startTrialActivationCheckout() explicitly refuses to run again once commercial_setup_completed_at
-- is set (correct -- it must never restart a trial or grant a second one). This adds a genuinely
-- separate purpose for that distinct, later flow: a card-replacement checkout that verifies a new
-- payment method via the same R0 PayFast mechanism, but never touches trial_ends_at,
-- commercial_setup_completed_at, or trial_usage_records.
alter table public.subscription_payments
  drop constraint subscription_payments_purpose_check;
alter table public.subscription_payments
  add constraint subscription_payments_purpose_check
  check (purpose = any (array['subscription_charge', 'trial_activation', 'payment_method_update']));

comment on column public.subscription_payments.purpose is
  'trial_activation: the R0 payment-method-verification checkout that starts a free trial (see
   startTrialActivationCheckout()). payment_method_update: a LATER R0 checkout that replaces an
   existing payment method on an already-set-up org (startPaymentMethodUpdateCheckout()) -- never
   touches trial state. subscription_charge: every real recurring charge, including the first one
   PayFast collects on billing_date, which reuses the same provider_reference as whichever of the
   two R0 rows above started that subscription but is always recorded as its OWN new row (see
   processBillingWebhookEvent()''s own comment for why).';
