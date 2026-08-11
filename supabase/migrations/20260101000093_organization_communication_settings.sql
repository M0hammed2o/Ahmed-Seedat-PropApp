-- Overnight platform pass (WORKLOG.md this date), Phases 5-7: organization-level communication
-- preferences (channel per category) and WhatsApp branding config. Extends the existing
-- notification_preferences (per-user, 20260101000039) model rather than duplicating it -- same
-- notification_category enum, same (email_enabled/whatsapp_enabled) shape, just keyed by org_id
-- instead of user_id, and read as the ORG-LEVEL default gate dispatchEmail()/dispatchWhatsApp()
-- check before the per-user preference (a user can only narrow further, never widen past what
-- their org has enabled for that category).
--
-- WhatsApp branding (Phase 6): organizations.trading_name already exists and doubles as the
-- "business/landlord display name" WHATSAPP.md §3 requires every template to open with -- no new
-- column needed for that specific field, confirmed by reading organizations' actual schema before
-- adding anything. Only genuinely new fields (no existing equivalent) are added.

create table public.organization_notification_settings (
  org_id uuid not null references public.organizations(id) on delete cascade,
  category public.notification_category not null,
  email_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (org_id, category)
);

comment on table public.organization_notification_settings is
  'Organization-level default channel policy per notification category (Phase 5: "Communication"
   settings section). dispatchEmail()/dispatchWhatsApp() check this BEFORE the per-user
   notification_preferences row -- an org can turn a channel off for everyone in one place; an
   individual user can still opt further out of what the org allows, never back in past it.';

alter table public.organization_notification_settings enable row level security;

create policy "organization_notification_settings_select_member"
  on public.organization_notification_settings for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "organization_notification_settings_write_manager_plus"
  on public.organization_notification_settings for all
  using (public.has_org_role(org_id, 'manager'))
  with check (public.has_org_role(org_id, 'manager'));

create trigger set_organization_notification_settings_updated_at
  before update on public.organization_notification_settings
  for each row execute function public.set_updated_at();

-- Phase 6 branding fields genuinely missing from organizations' existing columns (trading_name
-- already covers the display-name requirement).
alter table public.organizations
  add column support_contact_name text check (support_contact_name is null or char_length(support_contact_name) between 1 and 200),
  add column support_phone text,
  add column support_email citext,
  add column communication_footer text check (communication_footer is null or char_length(communication_footer) <= 500);

comment on column public.organizations.support_contact_name is
  'Phase 6: the named contact shown in tenant-facing email/WhatsApp templates (e.g. "Ahmed
   Seedat"), distinct from trading_name (the business name, e.g. "Seedat Properties") -- WhatsApp
   templates reference both separately ({{organization_name}} and {{support_name}}).';
