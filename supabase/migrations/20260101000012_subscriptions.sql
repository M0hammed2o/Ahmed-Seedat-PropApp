-- Written only by the service-role webhook path (see SUBSCRIPTIONS.md, SECURITY.md). No
-- insert/update policy exists for authenticated clients — a customer can only ever SELECT
-- their own row. This is the schema-level enforcement of "never trust a client-submitted
-- subscription status."
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  plan_id text not null default 'propvault_base',
  status public.subscription_status not null default 'unknown',
  platform public.subscription_platform not null default 'mock',
  product_identifier text,
  revenuecat_customer_id text,
  original_purchase_date timestamptz,
  renewal_or_expiry_date timestamptz,
  cancellation_reason text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_status_idx on public.subscriptions (status);

create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (owner_user_id = auth.uid());

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  idempotency_key text not null unique,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index subscription_events_owner_idx on public.subscription_events (owner_user_id);

alter table public.subscription_events enable row level security;

create policy "subscription_events_select_own"
  on public.subscription_events for select
  using (owner_user_id = auth.uid());

comment on column public.subscription_events.idempotency_key is
  'RevenueCat event id. Unique constraint makes a redelivered webhook a no-op — see SECURITY.md.';
