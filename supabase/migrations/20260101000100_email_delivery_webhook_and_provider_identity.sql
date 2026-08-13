-- Infrastructure hardening (WORKLOG.md this date): closes two real, previously-disclosed gaps
-- found during production verification of the property-compliance release --
-- (1) email_messages.status was permanently stuck at 'queued' because no webhook ever updated it
--     after Resend accepted a send (dispatchEmail()'s own committed status was the last word);
-- (2) extraction_results had nowhere to record which DocumentIntelligenceProvider actually served
--     a given extraction, even though every provider already returns its own identity in
--     metadata.providerName -- it was simply never persisted.
-- Both fixes are purely additive: new nullable columns, one new table. No existing column is
-- altered or dropped, no existing row is touched.

-- === email delivery webhook lifecycle ===

alter table public.email_messages
  add column delivered_at timestamptz,
  add column bounced_at timestamptz,
  add column failed_at timestamptz,
  -- Timestamp the PROVIDER says the event occurred (not when we processed it) -- lets a stale,
  -- out-of-order webhook be recognized as stale even without relying solely on status-rank logic.
  add column provider_event_at timestamptz,
  -- Raw normalized event type string of the last webhook event applied/observed for this
  -- message (e.g. 'delivered', 'delivery_delayed') -- distinct from `status`, which only ever
  -- holds one of the closed email_status enum values; this is a free-text debugging/audit trail.
  add column last_provider_event text,
  add column failure_reason text;

-- Idempotency ledger for inbound Resend webhook deliveries, mirroring billing_events'
-- (provider_name, provider_event_id) unique-guard pattern exactly (20260101000054). Deliberately
-- MORE permissive than billing_events on nullability: org_id/email_message_id are nullable
-- because a genuinely-authentic Resend webhook can reference a provider_message_id this
-- application never sent (e.g. the same Resend account also serving a different environment) --
-- that must be recorded (it passed signature verification) without forcing a resolvable org.
create table public.email_webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  email_message_id uuid references public.email_messages(id) on delete cascade,
  provider_name text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}',
  processed_at timestamptz not null default now(),
  -- The actual idempotency guard: a webhook retried by the provider (same provider_name +
  -- provider_event_id) fails this insert with 23505, which the handler treats as "already
  -- processed" rather than an error -- never a second status transition/suppression write.
  unique (provider_name, provider_event_id)
);

create index email_webhook_events_org_idx on public.email_webhook_events (org_id, processed_at desc)
  where org_id is not null;
create index email_webhook_events_message_idx on public.email_webhook_events (email_message_id)
  where email_message_id is not null;

alter table public.email_webhook_events enable row level security;

-- No client insert/update/delete policy at all, matching email_messages' own established
-- convention exactly (20260101000040: "status transitions come only from the real provider
-- webhook... the only legitimate writers are the send function and the webhook handler, both
-- service-role") -- select-only for org members who can already see the message it concerns.
create policy "email_webhook_events_select_org_member"
  on public.email_webhook_events for select
  using (org_id is not null and public.has_org_role(org_id, 'viewer'));

-- === document intelligence provider identity ===

-- extraction_jobs.provider_name already exists (20260101000011) but has never been written by
-- either extract route -- that is a route-code fix (this pass), not a schema gap, so no migration
-- is needed for that column. extraction_results has no equivalent column at all until now.
alter table public.extraction_results
  add column provider_name text;

comment on column public.extraction_results.provider_name is
  'Which concrete DocumentIntelligenceProvider served this extraction (its own readonly
   providerName, e.g. aws-textract / google-document-ai / mock) -- set by the extract route from
   the same provider instance metadata.providerName already carried on the result in memory.
   Never a credential or processor secret.';
