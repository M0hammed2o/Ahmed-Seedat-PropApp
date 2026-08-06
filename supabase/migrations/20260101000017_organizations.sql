-- The client account. Replaces PropVault's "the logged-in user IS the account" model —
-- every business table from this migration set onward hangs off org_id, not owner_user_id.
-- See DATABASE.md §0-1 and RETAIN_REFACTOR_REBUILD_MATRIX.md for why this is a full rebuild,
-- not an additive column, versus the PropVault-era schema.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (char_length(legal_name) between 1 and 200),
  trading_name text check (trading_name is null or char_length(trading_name) between 1 and 200),
  org_type public.organization_type not null default 'owner_managed',
  cipc_reg_no text,
  vat_no text,
  sars_tax_no text,
  popia_information_officer text,
  invoice_prefix text not null default 'INV' check (char_length(invoice_prefix) between 1 and 10),
  deposit_interest_pct numeric(5, 2) not null default 0 check (deposit_interest_pct >= 0),
  ffc_number text,
  ffc_issued date,
  ffc_expires date,
  status public.organization_status not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organizations_status_idx on public.organizations (status);

create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;

-- No policy created in this migration, deliberately: BOTH the intended select policy (below)
-- and the update policy need public.organization_members, which does not exist until the next
-- migration (20260101000018). Creating a policy whose USING clause references a table that
-- doesn't exist yet fails migration ordering outright (caught by an actual `supabase start` run
-- against a clean database, 2026-07-30 — see WORKLOG.md/KNOWN_BUGS.md; this is not a
-- theoretical concern, it is a migration that will not apply). Every policy on `organizations`
-- is instead created in 20260101000018 (select) and 20260101000021 (update, which additionally
-- needs has_org_role()) — both migrations that run after organization_members exists.
--
-- No client insert policy anywhere: an org is created exclusively via the org-signup RPC
-- (create_organization(), 20260101000021), which creates the organizations row and the
-- creator's principal membership row atomically in one transaction — never a bare client INSERT
-- that could create an org with zero members.
