-- Smart Utilities, initial-release completion (docs/SMART_UTILITIES_PROGRESS.md, 2026-10-10).
-- Additive only: no column is dropped, no data rewritten. Builds on migration 175.
--
--   1. Provider engine: encrypted credentials + poll-sync state on meter_integrations; more providers.
--   2. Integration requests for meters Proplyst does not support yet.
--   3. Meter evidence verification on telemetry readings.
--   4. Municipal reporting: CC, account holder, custom message, editable templates, field toggles,
--      template approval (content hash), schedule switch; 'scheduled' status, scheduled_for and a
--      rendered-email snapshot per pack (audit trail of exactly what was approved/sent).
--   5. Monthly meter snapshots.
--   6. Billing: tariffs (fixed + block rates) and utility charges (draft → approved → invoiced).
--
-- Rollback (local/test only): drop tables utility_charges, utility_tariffs, meter_period_snapshots,
-- meter_integration_requests; drop the columns added below; restore the two changed check constraints
-- (meter_integrations_provider_check, municipal_submissions_status_check) and drop
-- municipal_schedule_requires_approval.

-- ============================================================
-- 1. Provider engine
-- ============================================================

alter table public.meter_integrations drop constraint meter_integrations_provider_check;
alter table public.meter_integrations add constraint meter_integrations_provider_check
  check (provider in ('milesight_lorawan', 'shelly_gen2', 'generic_json', 'simulator', 'chirpstack_v4', 'tts_v3', 'thingsboard'));

alter table public.meter_integrations
  -- AES-256-GCM envelope "v<key version>:<iv b64>:<tag b64>:<ciphertext b64>" written by
  -- lib/smartUtility/secrets.ts. Never granted to API clients (see grant below).
  add column credentials_ciphertext text check (credentials_ciphertext is null or char_length(credentials_ciphertext) <= 8000),
  -- Non-secret provider settings (e.g. ThingsBoard base URL). Validated per provider in code.
  add column provider_config jsonb not null default '{}'::jsonb,
  add column sync_mode text not null default 'push' check (sync_mode in ('push', 'poll')),
  add column sync_interval_minutes integer check (sync_interval_minutes is null or sync_interval_minutes in (15, 60, 1440)),
  add column last_sync_at timestamptz,
  add column last_sync_status text check (last_sync_status is null or last_sync_status in ('ok', 'error')),
  add column last_sync_error text check (last_sync_error is null or char_length(last_sync_error) <= 500),
  add column next_sync_at timestamptz,
  add column consecutive_failures integer not null default 0 check (consecutive_failures >= 0);

-- Expose the new NON-secret columns to clients; credentials_ciphertext stays hidden alongside the
-- token hashes (migration 175 revoked table-level select and granted a column list).
grant select (provider_config, sync_mode, sync_interval_minutes, last_sync_at, last_sync_status, last_sync_error, next_sync_at, consecutive_failures)
  on public.meter_integrations to authenticated;

create index meter_integrations_poll_due_idx
  on public.meter_integrations (next_sync_at) where sync_mode = 'poll' and status = 'active';

-- ============================================================
-- 2. Integration requests
-- ============================================================

create table public.meter_integration_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  utility_type public.utility_type not null,
  manufacturer text not null check (char_length(manufacturer) between 1 and 100),
  model text not null check (char_length(model) between 1 and 100),
  connection_method text check (connection_method is null or char_length(connection_method) <= 100),
  supplier text check (supplier is null or char_length(supplier) <= 200),
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'planned', 'declined', 'done')),
  created_at timestamptz not null default now()
);

create index meter_integration_requests_org_idx on public.meter_integration_requests (org_id, created_at desc);

alter table public.meter_integration_requests enable row level security;

create policy "meter_integration_requests_select"
  on public.meter_integration_requests for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "meter_integration_requests_insert"
  on public.meter_integration_requests for insert
  with check (
    public.has_org_role(org_id, 'viewer')
    and requested_by = auth.uid()
    and (property_id is null or public.can_read_property_utilities(org_id, property_id))
  );

-- ============================================================
-- 3. Evidence verification on readings
-- ============================================================

alter table public.meter_telemetry_readings
  -- not_required: device readings; unverified: a person-entered reading awaiting review;
  -- verified / rejected: reviewed by a utilities writer. AI/OCR is never a verifier.
  add column verification_status text not null default 'not_required'
    check (verification_status in ('not_required', 'unverified', 'verified', 'rejected')),
  add column verified_by uuid references auth.users(id) on delete set null,
  add column verified_at timestamptz,
  add column verification_note text check (verification_note is null or char_length(verification_note) <= 500);

update public.meter_telemetry_readings set verification_status = 'unverified' where source = 'manual';

-- ============================================================
-- 4. Municipal reporting
-- ============================================================

alter table public.municipal_submission_settings
  add column cc_emails text[] not null default '{}' check (cardinality(cc_emails) <= 5),
  add column account_holder_name text check (account_holder_name is null or char_length(account_holder_name) <= 200),
  add column custom_message text check (custom_message is null or char_length(custom_message) <= 2000),
  add column subject_template text check (subject_template is null or char_length(subject_template) <= 300),
  add column body_template text check (body_template is null or char_length(body_template) <= 5000),
  -- Which details appear in the pack: {"previousReading":true,"consumption":true,"readingDate":true,
  -- "serialNumber":true,"accountNumber":true,"propertyAddress":true,"accountHolder":true,"photos":true}
  add column include_fields jsonb not null default '{}'::jsonb,
  add column frequency text not null default 'monthly' check (frequency in ('monthly')),
  -- Approval of the exact template content (SHA-256 of the normalised template + fields + recipients).
  add column template_hash text check (template_hash is null or char_length(template_hash) = 64),
  add column template_approved_at timestamptz,
  add column template_approved_by uuid references auth.users(id) on delete set null,
  add column schedule_enabled boolean not null default false,
  add constraint municipal_schedule_requires_approval
    check (not schedule_enabled or (template_approved_at is not null and template_hash is not null));

alter table public.municipal_submissions drop constraint municipal_submissions_status_check;
alter table public.municipal_submissions add constraint municipal_submissions_status_check
  check (status in ('draft', 'pending_approval', 'approved', 'scheduled', 'sending', 'sent', 'partially_failed', 'failed', 'cancelled'));

alter table public.municipal_submissions
  add column scheduled_for timestamptz,
  -- {subject, bodyText, bodyHtml, to[], cc[], attachments:[{filename, contentType}], templateHash, includeFields}
  add column rendered_email jsonb,
  add column template_hash text check (template_hash is null or char_length(template_hash) = 64),
  add column reminder_sent_at timestamptz;

alter table public.municipal_submission_deliveries
  add column cc_emails text[] not null default '{}';

-- ============================================================
-- 5. Monthly meter snapshots
-- ============================================================

create table public.meter_period_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  meter_id uuid not null references public.utility_meters(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  opening_value numeric(18, 4),
  closing_value numeric(18, 4),
  consumption numeric(18, 4),
  quality text not null check (quality in ('complete', 'partial', 'insufficient')),
  reset_in_period boolean not null default false,
  created_at timestamptz not null default now(),
  unique (meter_id, period_start)
);

create index meter_period_snapshots_property_idx on public.meter_period_snapshots (property_id, period_start desc);

alter table public.meter_period_snapshots enable row level security;

create policy "meter_period_snapshots_select"
  on public.meter_period_snapshots for select
  using (public.can_read_property_utilities(org_id, property_id));

-- ============================================================
-- 6. Billing
-- ============================================================

create table public.utility_tariffs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  utility_type public.utility_type not null,
  name text not null check (char_length(name) between 1 and 100),
  -- Fixed charge per billing period (Rand), e.g. a basic/availability charge.
  fixed_charge numeric(12, 2) not null default 0 check (fixed_charge >= 0),
  -- Ascending blocks: [{"upTo": 6, "rate": 25.5}, {"upTo": null, "rate": 40}] in kL or kWh per period.
  blocks jsonb not null check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) between 1 and 10),
  vat_inclusive boolean not null default true,
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to >= effective_from),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index utility_tariffs_property_idx on public.utility_tariffs (property_id, utility_type, effective_from desc);

alter table public.utility_tariffs enable row level security;

create policy "utility_tariffs_select"
  on public.utility_tariffs for select
  using (public.can_read_property_utilities(org_id, property_id));

create policy "utility_tariffs_write"
  on public.utility_tariffs for all
  using (public.can_write_property_utilities(org_id, property_id))
  with check (public.can_write_property_utilities(org_id, property_id));

create trigger utility_tariffs_audit_trigger
  after insert or update or delete on public.utility_tariffs
  for each row execute function public.log_audit_event_trigger();

create table public.utility_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  meter_id uuid not null references public.utility_meters(id) on delete cascade,
  lease_id uuid references public.leases(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  utility_type public.utility_type not null,
  period_start date not null,
  period_end date not null check (period_end > period_start),
  opening_reading numeric(18, 4),
  closing_reading numeric(18, 4),
  -- display units (kL / kWh)
  consumption numeric(18, 4),
  consumption_quality text not null check (consumption_quality in ('complete', 'partial', 'insufficient')),
  tariff_id uuid references public.utility_tariffs(id) on delete set null,
  tariff_snapshot jsonb,
  fixed_amount numeric(12, 2) not null default 0,
  usage_amount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  -- draft: computed estimate for review · approved: landlord accepted the figure ·
  -- invoiced: added to a DRAFT invoice (never issued automatically) · void: discarded.
  status text not null default 'draft' check (status in ('draft', 'approved', 'invoiced', 'void')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  invoice_id uuid references public.invoices(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index utility_charges_meter_period_idx
  on public.utility_charges (meter_id, period_start) where status <> 'void';
create index utility_charges_property_idx on public.utility_charges (property_id, period_start desc);

alter table public.utility_charges enable row level security;

create policy "utility_charges_select"
  on public.utility_charges for select
  using (public.can_read_property_utilities(org_id, property_id));
-- Written only by server routes (service role) after can_write_property_utilities; status changes
-- are audited explicitly by the app.

create trigger set_utility_charges_updated_at
  before update on public.utility_charges
  for each row execute function public.set_updated_at();

create trigger utility_charges_audit_trigger
  after insert or update or delete on public.utility_charges
  for each row execute function public.log_audit_event_trigger();
