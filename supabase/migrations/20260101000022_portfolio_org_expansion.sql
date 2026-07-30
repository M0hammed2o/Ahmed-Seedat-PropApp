-- Milestone 2 (TASKS.md): portfolio tables for the org-scoped model. Deliberately an "expand"
-- step, not a big-bang cutover: adds a nullable org_id to the existing PropVault-era
-- `properties` table alongside its current owner_user_id, rather than dropping owner_user_id
-- and rewriting its RLS in the same migration.
--
-- Why expand/contract here specifically, even though there is no real production data to
-- protect yet (this product hasn't launched — see WORKLOG.md/DECISIONS.md): the *risk* being
-- managed is not data loss, it's blast radius. owner_user_id is read by ~30 files across
-- apps/mobile (property screens, repository, demo store), apps/admin (customer pages), and
-- packages/utils's matching tests (grep results, 2026-07-30). Flipping properties.owner_user_id
-- to org_id and every one of those call sites in a single migration would be exactly the "large
-- unstable branch" the master prompt's Phase 6 explicitly warns against. This migration adds the
-- new column and the new child tables that need it (units, property_owners) without removing or
-- repointing anything that currently works — the contract step (drop owner_user_id, rewrite
-- properties' RLS to org-scoped, update all downstream app code) is its own follow-up unit of
-- work, tracked in TASKS.md Milestone 2, not silently left undone.

alter table public.properties add column org_id uuid references public.organizations(id);
create index properties_org_idx on public.properties (org_id) where org_id is not null;

-- units: new, org-scoped from day one (no legacy owner_user_id equivalent existed for this
-- concept in PropVault at all — see EXISTING_CODEBASE_AUDIT.md §2).
create type public.unit_status as enum ('vacant', 'occupied', 'maintenance');

create table public.units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_label text not null check (char_length(unit_label) between 1 and 60),
  bedrooms integer check (bedrooms is null or bedrooms >= 0),
  bathrooms numeric(3, 1) check (bathrooms is null or bathrooms >= 0),
  size_sqm numeric(8, 2) check (size_sqm is null or size_sqm > 0),
  market_rent numeric(10, 2) check (market_rent is null or market_rent >= 0),
  status public.unit_status not null default 'vacant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- org_id is denormalised onto units (not just reachable via property_id) specifically so its
-- RLS policy is a direct org-membership check, not a subquery through properties — see
-- DATABASE.md §3 "denormalized for RLS simplicity".
create index units_property_idx on public.units (property_id);
create index units_org_status_idx on public.units (org_id, status);

create trigger set_units_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

alter table public.units enable row level security;

create policy "units_select_org_member"
  on public.units for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "units_write_agent_plus"
  on public.units for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- owners: payee/legal-entity records, deliberately decoupled from auth.users (DATABASE.md §0.2,
-- §3) — an owner can exist purely as a bookkeeping record with no login at all.
create type public.owner_type as enum ('individual', 'company', 'trust');

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  owner_type public.owner_type not null default 'individual',
  name text not null check (char_length(name) between 1 and 200),
  email citext,
  phone text,
  banking_ref uuid,
  mandate_start date,
  mandate_end date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index owners_org_idx on public.owners (org_id, status);
create index owners_user_idx on public.owners (user_id) where user_id is not null;

create trigger set_owners_updated_at
  before update on public.owners
  for each row execute function public.set_updated_at();

alter table public.owners enable row level security;

-- Org staff (viewer+) can see all owner records in their org. An owner with portal access
-- (user_id set) can additionally see their own record even outside any org-membership context
-- — the "or" here is deliberate: two independent, non-overlapping reasons a select can succeed.
create policy "owners_select_org_or_self"
  on public.owners for select
  using (public.has_org_role(org_id, 'viewer') or user_id = auth.uid());

create policy "owners_write_agent_plus"
  on public.owners for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- property_owners: fractional/multi-owner support (DATABASE.md §3 — Owner Statements need
-- "each owner's share", evidenced PROPVIEW_SCREENSHOT_AUDIT.md IMG_8043). SUM(ownership_pct)
-- per property is validated at the application layer, not a DB constraint — a property can
-- legitimately be mid-transfer with an incomplete ownership set.
create table public.property_owners (
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  ownership_pct numeric(5, 2) not null check (ownership_pct > 0 and ownership_pct <= 100),
  created_at timestamptz not null default now(),
  primary key (property_id, owner_id)
);

create index property_owners_owner_idx on public.property_owners (owner_id);

alter table public.property_owners enable row level security;

-- Scoped through owners.org_id since property_owners itself carries no org_id column (it's a
-- pure join table with no independent existence outside its two parents).
create policy "property_owners_select_org_member"
  on public.property_owners for select
  using (
    exists (
      select 1 from public.owners o
      where o.id = property_owners.owner_id and public.has_org_role(o.org_id, 'viewer')
    )
  );

create policy "property_owners_write_agent_plus"
  on public.property_owners for all
  using (
    exists (
      select 1 from public.owners o
      where o.id = property_owners.owner_id and public.has_org_role(o.org_id, 'agent')
    )
  )
  with check (
    exists (
      select 1 from public.owners o
      where o.id = property_owners.owner_id and public.has_org_role(o.org_id, 'agent')
    )
  );
