-- TASKS.md M10: leases, lease_tenants, rent_schedules (DATABASE.md §4).

create type public.rent_frequency as enum ('monthly');
create type public.lease_status as enum ('draft', 'active', 'expired', 'terminated');
create type public.lease_source as enum ('manual', 'pdf_parsed', 'application_approved');
create type public.rent_schedule_status as enum ('pending', 'invoiced', 'paid', 'overdue', 'partial');

create table public.leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  start_date date not null,
  end_date date,
  rent_amount numeric(10, 2) not null check (rent_amount >= 0),
  rent_frequency public.rent_frequency not null default 'monthly',
  deposit_amount numeric(10, 2) not null default 0 check (deposit_amount >= 0),
  status public.lease_status not null default 'draft',
  source public.lease_source not null default 'manual',
  source_document_id uuid references public.documents(id),
  source_application_id uuid references public.applications(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date > start_date)
);

create index leases_org_status_idx on public.leases (org_id, status);
create index leases_unit_idx on public.leases (unit_id);

create trigger set_leases_updated_at
  before update on public.leases
  for each row execute function public.set_updated_at();

alter table public.leases enable row level security;

create policy "leases_select_org_member"
  on public.leases for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "leases_write_agent_plus"
  on public.leases for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- lease_tenants: pure join table (a lease can have co-tenants; is_primary marks the one
-- responsible party for correspondence -- evidenced pattern mirrors property_owners's
-- fractional-ownership join shape). No org_id of its own, scoped through leases.org_id in policies
-- (same reasoning as property_owners being scoped through owners.org_id).
create table public.lease_tenants (
  lease_id uuid not null references public.leases(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (lease_id, tenant_id)
);

create index lease_tenants_tenant_idx on public.lease_tenants (tenant_id);

alter table public.lease_tenants enable row level security;

create policy "lease_tenants_select_org_member"
  on public.lease_tenants for select
  using (
    exists (
      select 1 from public.leases l
      where l.id = lease_tenants.lease_id and public.has_org_role(l.org_id, 'viewer')
    )
  );

create policy "lease_tenants_write_agent_plus"
  on public.lease_tenants for all
  using (
    exists (
      select 1 from public.leases l
      where l.id = lease_tenants.lease_id and public.has_org_role(l.org_id, 'agent')
    )
  )
  with check (
    exists (
      select 1 from public.leases l
      where l.id = lease_tenants.lease_id and public.has_org_role(l.org_id, 'agent')
    )
  );

-- rent_schedules: what the "Rent Due" dashboard reads from (DATABASE.md §4). org_id is
-- denormalised onto this table too (not just reachable via lease_id), matching the
-- units/owners/tenants pattern -- a direct org-membership RLS check, not a subquery through
-- leases, and the exact composite index the Rent Due query needs.
create table public.rent_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lease_id uuid not null references public.leases(id) on delete cascade,
  due_date date not null,
  amount numeric(10, 2) not null check (amount >= 0),
  status public.rent_schedule_status not null default 'pending',
  generated_at timestamptz not null default now()
);

create index rent_schedules_org_status_due_idx on public.rent_schedules (org_id, status, due_date);
create index rent_schedules_lease_idx on public.rent_schedules (lease_id);

alter table public.rent_schedules enable row level security;

create policy "rent_schedules_select_org_member"
  on public.rent_schedules for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "rent_schedules_write_agent_plus"
  on public.rent_schedules for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));
