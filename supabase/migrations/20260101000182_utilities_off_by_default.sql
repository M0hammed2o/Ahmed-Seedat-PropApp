-- Smart Utilities is OFF unless an organisation is explicitly switched on (pilot restriction, 2026-10-11).
--
-- Migration 179 added organizations.utilities_enabled with DEFAULT TRUE so existing organisations kept their
-- behaviour. No production organisation has used Smart Utilities yet (175–181 are unapplied there), so the
-- controlled pilot instead starts from "nobody": every organisation — existing and created later — is off, and the
-- pilot organisation is switched on by one explicit, audited statement run by the owner:
--   update public.organizations set utilities_enabled = true where id = '<pilot org id>';
--
-- What "off" means (enforced in the app, fail-closed): Smart Utilities API routes return 403, device ingestion is
-- refused, no poll sync, alerts, reminders, municipal pack generation or sending. Legacy monthly readings
-- (Android capture, Finances, migration 163) are NOT gated and keep working.
--
-- Rollback: alter column ... set default true (data rows unaffected); covered by
-- supabase/rollback/20260101000175_182_utilities_down.sql, which drops the column entirely.

alter table public.organizations alter column utilities_enabled set default false;
update public.organizations set utilities_enabled = false where utilities_enabled;

comment on column public.organizations.utilities_enabled is
  'Smart Utilities module switch (API routes, device ingestion, polling, alerts, municipal generation/sending). '
  'Default false: switched on per organisation by the owner. Legacy monthly readings are unaffected.';
