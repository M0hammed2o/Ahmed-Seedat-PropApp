-- Configurable subscription plans (master prompt §12.5 — pricing must not be hardcoded).
-- Platform-level, not org-scoped: plans are PropertyVault's own product catalogue.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) between 1 and 40),
  name text not null,
  billing_cycle public.billing_cycle not null default 'monthly',
  base_price numeric(10, 2) not null check (base_price >= 0),
  currency char(3) not null default 'ZAR',
  feature_limits jsonb not null default '{}',
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (code, version)
);

alter table public.plans enable row level security;

-- Plans are public product-catalogue data (needed to render pricing/upgrade screens to any
-- authenticated org member) but never client-writable — only service-role/Super Admin RPCs
-- change pricing.
create policy "plans_select_authenticated"
  on public.plans for select
  to authenticated
  using (true);

create table public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  price_override numeric(10, 2),
  discount_pct numeric(5, 2) check (discount_pct is null or discount_pct between 0 and 100),
  promotional_credit numeric(10, 2) not null default 0,
  billing_cycle public.billing_cycle not null,
  current_period_start date not null,
  current_period_end date not null,
  next_payment_date date,
  status public.organization_status not null default 'trial',
  created_at timestamptz not null default now()
);

-- Append-only history, not updated in place (a plan change is a *new* row covering the new
-- period) — see DATABASE.md §1. organizations.status is kept in sync by the billing service
-- as a fast-read denormalisation; this table is the source of truth for subscription history.
create index organization_subscriptions_org_idx
  on public.organization_subscriptions (org_id, current_period_start desc);

alter table public.organization_subscriptions enable row level security;

create policy "organization_subscriptions_select_same_org"
  on public.organization_subscriptions for select
  using (
    org_id in (
      select om.org_id from public.organization_members om
      where om.user_id = auth.uid() and om.status = 'active'
    )
  );

-- No client write policy: subscription state changes exclusively via the billing
-- service/Super Admin actions (service-role), never a client-initiated status change — a client
-- setting its own org to 'active' would be a straightforward bypass of billing entirely.

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.organization_subscriptions(id),
  amount numeric(10, 2) not null,
  currency char(3) not null default 'ZAR',
  status text not null check (status in ('pending', 'paid', 'failed', 'refunded')),
  payment_method text,
  provider_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index subscription_payments_org_idx on public.subscription_payments (org_id, created_at desc);

alter table public.subscription_payments enable row level security;

create policy "subscription_payments_select_same_org"
  on public.subscription_payments for select
  using (
    org_id in (
      select om.org_id from public.organization_members om
      where om.user_id = auth.uid() and om.status = 'active'
    )
  );
