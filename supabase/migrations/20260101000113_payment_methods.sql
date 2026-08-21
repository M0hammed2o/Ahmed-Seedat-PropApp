-- Commercial plan restructure, Part 3 (WORKLOG.md this date): payment-method-on-file storage.
-- Never raw card number/CVV/full card details -- only safe, non-sensitive provider references and
-- metadata PayFast's own ITN/subscription-token flow already returns. One row per organization's
-- current payment method (a new checkout replaces it, never appends a second live row) -- history
-- of REPLACED methods is preserved via status, not deleted, for audit purposes.

create type public.payment_method_status as enum ('active', 'expired', 'failed', 'replaced');

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  -- PayFast's own recurring-billing token (organization_subscriptions.provider_subscription_token
  -- already stores this for cancellation; duplicated here deliberately -- this table's job is "what
  -- does the customer see on the billing page", organization_subscriptions' job is "what does the
  -- gateway need to cancel/charge" -- two different callers, kept in sync by the same webhook
  -- write, not merged into one column with two meanings).
  provider_reference text,
  card_brand text,
  card_last4 text check (card_last4 is null or char_length(card_last4) = 4),
  card_expiry_month smallint check (card_expiry_month is null or card_expiry_month between 1 and 12),
  card_expiry_year smallint,
  status public.payment_method_status not null default 'active',
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payment_methods is
  'Safe, tokenized payment-method metadata only -- provider, provider_reference (PayFast''s own
   token), card brand/last4/expiry (all non-sensitive display metadata PayFast''s ITN may return),
   status. Never a raw card number, CVV, or full card details -- those never reach this application
   at all (PayFast''s own hosted checkout page collects them directly).';

create index payment_methods_org_idx on public.payment_methods (org_id, status);

create trigger set_payment_methods_updated_at
  before update on public.payment_methods
  for each row execute function public.set_updated_at();

alter table public.payment_methods enable row level security;

create policy "payment_methods_select_same_org"
  on public.payment_methods for select
  using (public.has_org_role(org_id, 'viewer'));

-- No client write policy at all -- written exclusively by the billing webhook / checkout
-- confirmation path (service-role), matching organization_subscriptions/subscription_payments'
-- own established "server-side subsystems only" posture. A client cannot fabricate its own
-- "verified" payment method by inserting a row directly.

revoke all on table public.payment_methods from anon, authenticated;
grant select on table public.payment_methods to authenticated;
