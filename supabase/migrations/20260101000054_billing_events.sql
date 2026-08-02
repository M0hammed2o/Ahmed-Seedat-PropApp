-- Payment gateway abstraction (SUBSCRIPTIONS.md's "organization-level web billing" section,
-- distinct from the mobile app's RevenueCat entitlement flow documented above it). billing_events
-- is the idempotency + audit-trail table a webhook receiver needs: a real gateway will retry a
-- webhook delivery on any non-2xx response, so processing must be safe to run twice for the same
-- event -- the unique constraint below is what makes a retried delivery a no-op rather than a
-- double-processed payment.

create type public.billing_event_type as enum (
  'payment_succeeded', 'payment_failed', 'subscription_cancelled', 'refund_processed'
);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider_name text not null,
  provider_event_id text not null,
  event_type public.billing_event_type not null,
  payload jsonb not null default '{}',
  processed_at timestamptz not null default now(),
  -- The actual idempotency guard: a webhook retried by the gateway (same provider_name +
  -- provider_event_id) fails this insert with 23505, which the webhook handler treats as
  -- "already processed" rather than an error -- never a second payment/status transition.
  unique (provider_name, provider_event_id)
);

create index billing_events_org_idx on public.billing_events (org_id, processed_at desc);

alter table public.billing_events enable row level security;

create policy "billing_events_select_org_member"
  on public.billing_events for select
  using (public.has_org_role(org_id, 'viewer'));

-- No client write policy -- billing_events is written exclusively by the webhook receiver
-- (service-role), the same "server-side subsystems only" pattern as audit_events/usage_events.
