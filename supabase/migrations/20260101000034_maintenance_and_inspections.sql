-- TASKS.md M13: maintenance_tickets/maintenance_photos/vendors/vendor_bills and
-- inspections/inspection_items/inspection_photos (DATABASE.md §5).

create type public.maintenance_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.maintenance_status as enum ('to_do', 'in_progress', 'pending_approval', 'completed');
create type public.vendor_trade_category as enum (
  'plumbing', 'electrical', 'hvac', 'appliance_repair', 'painting', 'general_handyman',
  'landscaping', 'pest_control', 'locksmith', 'cleaning', 'roofing', 'other'
);
create type public.vendor_status as enum ('active', 'inactive');
create type public.vendor_bill_status as enum ('submitted', 'approved', 'paid', 'rejected');
create type public.inspection_type as enum ('move_in', 'move_out', 'routine');
create type public.inspection_status as enum ('scheduled', 'in_progress', 'awaiting_signature', 'completed');
create type public.inspection_condition_rating as enum ('good', 'fair', 'poor', 'damaged');

-- === vendors (created before maintenance_tickets, which references it) ===
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  trade_category public.vendor_trade_category not null default 'other',
  phone text,
  email citext,
  -- External/unregistered vendors (evidenced PROPVIEW_SCREENSHOT_AUDIT.md IMG_8028) -- a vendor
  -- record can exist purely for bill-tracking purposes without ever being a real platform account.
  is_external boolean not null default true,
  rating_avg numeric(3, 2) check (rating_avg is null or rating_avg between 0 and 5),
  status public.vendor_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vendors_org_status_idx on public.vendors (org_id, status);

create trigger set_vendors_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

alter table public.vendors enable row level security;

create policy "vendors_select_org_member"
  on public.vendors for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "vendors_write_agent_plus"
  on public.vendors for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- === maintenance_tickets ===
create table public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  lease_id uuid references public.leases(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  -- "submitted by a user or a tenant" (DATABASE.md §5) -- modeled as two nullable FKs with an
  -- exactly-one-set constraint rather than a single polymorphic column, matching how this schema
  -- has consistently avoided untyped polymorphic references elsewhere (DATABASE.md §6's
  -- correction, TASKS.md M11). No tenant portal exists in V1 (confirmed product decision), so
  -- submitted_by_tenant_id has no real caller yet -- included now because the column is cheap and
  -- the schema is correct either way, not because it's used today.
  submitted_by_user_id uuid references auth.users(id),
  submitted_by_tenant_id uuid references public.tenants(id),
  summary text not null check (char_length(summary) between 1 and 200),
  description text,
  priority public.maintenance_priority not null default 'medium',
  status public.maintenance_status not null default 'to_do',
  assigned_vendor_id uuid references public.vendors(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (
    (submitted_by_user_id is not null and submitted_by_tenant_id is null)
    or (submitted_by_user_id is null and submitted_by_tenant_id is not null)
  ),
  check (status = 'completed' or resolved_at is null)
);

create index maintenance_tickets_org_status_idx on public.maintenance_tickets (org_id, status);
create index maintenance_tickets_property_idx on public.maintenance_tickets (property_id);
create index maintenance_tickets_vendor_idx on public.maintenance_tickets (assigned_vendor_id) where assigned_vendor_id is not null;

create trigger set_maintenance_tickets_updated_at
  before update on public.maintenance_tickets
  for each row execute function public.set_updated_at();

alter table public.maintenance_tickets enable row level security;

create policy "maintenance_tickets_select_org_member"
  on public.maintenance_tickets for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "maintenance_tickets_write_agent_plus"
  on public.maintenance_tickets for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

create table public.maintenance_photos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.maintenance_tickets(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index maintenance_photos_ticket_idx on public.maintenance_photos (ticket_id);

alter table public.maintenance_photos enable row level security;

create policy "maintenance_photos_select_org_member"
  on public.maintenance_photos for select
  using (
    exists (
      select 1 from public.maintenance_tickets t
      where t.id = maintenance_photos.ticket_id and public.has_org_role(t.org_id, 'viewer')
    )
  );

create policy "maintenance_photos_write_agent_plus"
  on public.maintenance_photos for all
  using (
    exists (
      select 1 from public.maintenance_tickets t
      where t.id = maintenance_photos.ticket_id and public.has_org_role(t.org_id, 'agent')
    )
  )
  with check (
    exists (
      select 1 from public.maintenance_tickets t
      where t.id = maintenance_photos.ticket_id and public.has_org_role(t.org_id, 'agent')
    )
  );

-- === vendor_bills ===
create table public.vendor_bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  maintenance_ticket_id uuid references public.maintenance_tickets(id) on delete set null,
  amount numeric(12, 2) not null check (amount >= 0),
  status public.vendor_bill_status not null default 'submitted',
  submitted_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  -- No FK yet -- journal_entries doesn't exist until TASKS.md M14 (Accounting). Same pattern as
  -- owners.banking_ref (M2) before encrypted_secrets existed: column added now matching
  -- DATABASE.md §5's documented shape, FK constraint retrofitted once the target table is real.
  paid_journal_entry_id uuid,
  document_id uuid references public.documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved' or status = 'paid') = (approved_by is not null and approved_at is not null))
);

create index vendor_bills_org_status_idx on public.vendor_bills (org_id, status);
create index vendor_bills_vendor_idx on public.vendor_bills (vendor_id);

create trigger set_vendor_bills_updated_at
  before update on public.vendor_bills
  for each row execute function public.set_updated_at();

alter table public.vendor_bills enable row level security;

create policy "vendor_bills_select_org_member"
  on public.vendor_bills for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "vendor_bills_write_agent_plus"
  on public.vendor_bills for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- === inspections ===
create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  lease_id uuid references public.leases(id) on delete set null,
  inspection_type public.inspection_type not null default 'routine',
  scheduled_at timestamptz not null,
  status public.inspection_status not null default 'scheduled',
  landlord_signed_at timestamptz,
  tenant_signed_at timestamptz,
  tenant_refusal_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The evidenced completion rule (PROPVIEW_SCREENSHOT_AUDIT.md IMG_8026), enforced as a hard DB
  -- constraint (not just an API check) because TASKS.md M14's deposit-release gate depends on it
  -- being genuinely true, not just API-layer-asserted -- a direct service-role write must not be
  -- able to silently produce a "completed" inspection that skipped this rule either.
  check (
    status <> 'completed'
    or (landlord_signed_at is not null and (tenant_signed_at is not null or tenant_refusal_reason is not null))
  ),
  check (tenant_refusal_reason is null or tenant_signed_at is null)
);

create index inspections_org_status_idx on public.inspections (org_id, status);
create index inspections_property_idx on public.inspections (property_id);
create index inspections_lease_idx on public.inspections (lease_id) where lease_id is not null;

create trigger set_inspections_updated_at
  before update on public.inspections
  for each row execute function public.set_updated_at();

alter table public.inspections enable row level security;

create policy "inspections_select_org_member"
  on public.inspections for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "inspections_write_agent_plus"
  on public.inspections for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

create table public.inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  room text not null check (char_length(room) between 1 and 100),
  item_description text not null check (char_length(item_description) between 1 and 500),
  condition_rating public.inspection_condition_rating not null default 'good',
  notes text,
  created_at timestamptz not null default now()
);

create index inspection_items_inspection_idx on public.inspection_items (inspection_id);

alter table public.inspection_items enable row level security;

create policy "inspection_items_select_org_member"
  on public.inspection_items for select
  using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_items.inspection_id and public.has_org_role(i.org_id, 'viewer')
    )
  );

create policy "inspection_items_write_agent_plus"
  on public.inspection_items for all
  using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_items.inspection_id and public.has_org_role(i.org_id, 'agent')
    )
  )
  with check (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_items.inspection_id and public.has_org_role(i.org_id, 'agent')
    )
  );

create table public.inspection_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  inspection_item_id uuid references public.inspection_items(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index inspection_photos_inspection_idx on public.inspection_photos (inspection_id);
create index inspection_photos_item_idx on public.inspection_photos (inspection_item_id) where inspection_item_id is not null;

alter table public.inspection_photos enable row level security;

create policy "inspection_photos_select_org_member"
  on public.inspection_photos for select
  using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_photos.inspection_id and public.has_org_role(i.org_id, 'viewer')
    )
  );

create policy "inspection_photos_write_agent_plus"
  on public.inspection_photos for all
  using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_photos.inspection_id and public.has_org_role(i.org_id, 'agent')
    )
  )
  with check (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_photos.inspection_id and public.has_org_role(i.org_id, 'agent')
    )
  );
