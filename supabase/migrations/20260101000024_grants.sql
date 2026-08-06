-- Discovered 2026-07-30 via the first-ever real `supabase test db` run against this project's
-- migration history: RLS policies restrict WHICH ROWS a role can see/change, but Postgres
-- separately requires the role to hold base table privileges (SELECT/INSERT/UPDATE/DELETE) at
-- all — a `GRANT`, not a policy. No migration since this project's very first commit ever
-- granted these to `anon`/`authenticated`/`service_role`, so every table, not just the new
-- multi-tenancy ones, has been missing this. It went undetected because this is the first time
-- any of these migrations has actually run against a real Postgres instance (WORKLOG.md's
-- repeated "RLS tests Blocked, no Docker" note — now resolved).
--
-- This is a forward migration fixing a gap in already-committed history, per DEPLOYMENT.md §3's
-- own forward-only philosophy — not an edit to any prior migration file. Safe and idempotent
-- (`grant`/`alter default privileges` are not additive-only in a way that breaks on re-run).
--
-- Granting table-level privilege here does NOT bypass RLS — RLS remains the row-level
-- enforcement layer (DATABASE.md §12); this migration only clears the prerequisite "is this role
-- allowed to attempt the operation at all" check that Postgres evaluates before RLS policies run.
-- Including `anon` matches Supabase's own standard convention and is safe in practice: every
-- policy in this schema checks `auth.uid()`/org-membership, which is null/absent for an
-- unauthenticated `anon` request, so RLS still denies everything to `anon` regardless of this
-- grant.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- So every table/sequence/function created by a *future* migration gets the same grants
-- automatically, without needing its own repeated grant statements.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
