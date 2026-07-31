-- encrypted_secrets: opaque ciphertext pointer table (DATABASE.md §11). Schema only in this
-- migration -- the application-layer encrypt-before-insert pipeline (key management, SECURITY.md)
-- is not wired up yet, and nothing writes to this table until a real "capture tenant ID number" /
-- "capture owner banking details" flow needs it (TASKS.md M8+). Building the full encryption
-- pipeline now, before any caller exists, would be exactly the kind of speculative work this
-- codebase has consistently deferred elsewhere (mock-first providers, etc.) -- this migration
-- exists only so `tenants.id_number_ref` (next migration) and the already-existing
-- `owners.banking_ref` have a real, constrained FK target matching the documented shape.
create table public.encrypted_secrets (
  id uuid primary key default gen_random_uuid(),
  ciphertext bytea not null,
  created_at timestamptz not null default now()
);

alter table public.encrypted_secrets enable row level security;
-- No client policy at all -- same pattern as admin_users/support_access_sessions
-- (20260101000003/20260101000020): only the service-role client, after application-layer
-- encryption happens, ever touches this table. RLS-enabled + zero policies = deny-by-default to
-- anon/authenticated, which is the entire point for a table that exists solely to hold ciphertext.

-- Retrofit: owners.banking_ref (supabase/migrations/20260101000022) was added as a plain
-- unconstrained uuid because encrypted_secrets didn't exist yet at that point. Column has been
-- all-null in every environment since (no banking-capture flow exists yet either), so adding the
-- constraint now is safe -- not a real data migration.
alter table public.owners
  add constraint owners_banking_ref_fkey foreign key (banking_ref) references public.encrypted_secrets(id);
