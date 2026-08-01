-- Real bug found while wiring POST /api/v1/admin/plans (TASKS.md M19): migration
-- 20260101000019 declared BOTH a column-level `code text not null unique` AND a table-level
-- `unique (code, version)` on the same table. The column-level UNIQUE makes it impossible to
-- ever insert a second row sharing a `code` regardless of `version` -- silently breaking the
-- entire plan-versioning design SUPER_ADMIN.md §5 / DATABASE.md §1 describe ("a price change
-- creates a new version; existing subscriptions keep the version they signed up under"). Never
-- caught before because nothing had ever tried to insert a second version of an existing plan's
-- code until this milestone's POST /api/v1/admin/plans actually attempted it.
--
-- Postgres auto-named the column-level constraint `plans_code_key` (the default
-- `<table>_<column>_key` naming for an inline `unique` column modifier) -- confirmed live via
-- `select conname from pg_constraint where conrelid = 'public.plans'::regclass` against a freshly
-- reset database both before writing this fix (to find the exact name) and after applying it (to
-- confirm only `plans_code_version_key`, the intended composite constraint, remains).
alter table public.plans drop constraint plans_code_key;

-- The composite `unique (code, version)` from the original migration is untouched and remains
-- the real constraint: no two rows can share both the same code and the same version, but
-- multiple versions of the same code are now possible, as designed.
