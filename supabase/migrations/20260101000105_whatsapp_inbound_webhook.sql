-- V1 communications productionisation (WORKLOG.md this date). Closes TECHNICAL_DEBT_REGISTER.md
-- TD-38's inbound half: POST /api/v1/webhooks/whatsapp now exists (whatsappDispatch.ts's
-- processWhatsAppWebhookEvent) and needs the same two structural pieces
-- 20260101000100 already added for email's equivalent gap:
--   (1) delivery-tracking timestamp columns on whatsapp_messages, so a real status callback
--       (queued -> sent -> delivered -> read -> failed, WHATSAPP.md §6) has somewhere to record
--       WHEN each transition happened, not just the current status;
--   (2) an idempotency ledger (whatsapp_webhook_events) mirroring email_webhook_events'
--       (provider_name, provider_event_id) unique-guard pattern exactly, so a redelivered webhook
--       is a no-op rather than a duplicate status transition or duplicate audit trail.
-- Both additive only: new nullable columns, one new table. No existing column altered or dropped.

alter table public.whatsapp_messages
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column failed_at timestamptz,
  -- Timestamp the PROVIDER says the event occurred (not when we processed it) -- same purpose as
  -- email_messages.provider_event_at (20260101000100).
  add column provider_event_at timestamptz,
  add column last_provider_event text,
  add column failure_reason text;

-- Idempotency ledger for inbound Meta webhook deliveries (both message and status-callback
-- events). Deliberately permissive on nullability like email_webhook_events: org_id/
-- whatsapp_message_id are nullable because (a) a status callback for a provider_message_id this
-- app never sent should still be recorded as "seen" without forcing a resolvable row, and (b) an
-- inbound message from an UNAUTHENTICATED sender (WHATSAPP.md §1.2, zero verified_phone_numbers
-- matches -- the only reachable outcome today, since the OTP-verification flow that would ever
-- populate that table remains undesigned) has no org to attribute a whatsapp_messages row to at
-- all (that table's own org_id is NOT NULL, correctly -- it's an org-scoped, RLS-visible table;
-- an unauthenticated inbound message isn't org data yet). This table is the durable record of
-- "a signature-verified webhook call happened," independent of whether it ever became a
-- business-relevant whatsapp_messages row.
create table public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  whatsapp_message_id uuid references public.whatsapp_messages(id) on delete cascade,
  provider_name text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}',
  processed_at timestamptz not null default now(),
  unique (provider_name, provider_event_id)
);

create index whatsapp_webhook_events_org_idx on public.whatsapp_webhook_events (org_id, processed_at desc)
  where org_id is not null;
create index whatsapp_webhook_events_message_idx on public.whatsapp_webhook_events (whatsapp_message_id)
  where whatsapp_message_id is not null;

alter table public.whatsapp_webhook_events enable row level security;

-- Matches email_webhook_events' own posture exactly: no client insert/update/delete policy at
-- all (WHATSAPP.md §2: "nothing outside the dispatcher can originate a WhatsApp send," and
-- inbound rows come only from the service-role webhook handler) -- select-only for org members
-- who can already see the org this event concerns. An event with no resolved org_id (the
-- UNAUTHENTICATED case) is simply invisible to every client role, same as it being unscoped data
-- with no owner to show it to.
create policy "whatsapp_webhook_events_select_org_member"
  on public.whatsapp_webhook_events for select
  using (org_id is not null and public.has_org_role(org_id, 'viewer'));
