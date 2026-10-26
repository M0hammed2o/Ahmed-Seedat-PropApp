-- Cemetery Management module (docs/CEMETERY_MANAGEMENT.md).
--
-- An OPTIONAL, organisation-level module: cemetery -> section/block -> grave site, rights holders (purchasers), grave
-- site sales / grants of burial rights, payments with receipts, and burial records.
--
-- Design rules:
--   * Nothing here touches rental accounting. A grave-site sale is NOT a lease and a purchaser is NOT a tenant: sales
--     and payments live in their own tables (cemetery_sales / cemetery_payments) and never write invoices,
--     rent_schedules, invoice_payments or journals, so no rental report, owner statement or trial balance changes.
--   * Off for everyone. organizations.cemetery_enabled defaults to false and every existing organisation stays off.
--     Switched on per organisation by one explicit statement, the same model as utilities_enabled (migration 182):
--       update public.organizations set cemetery_enabled = true where id = '<org id>';
--   * RLS is the enforcement, and it requires the module switch. Read: accountant, manager, principal of an org
--     with cemetery_enabled. Write: manager, principal (payments: accountant too). Agents, viewers, owners, tenants
--     and platform support sessions see nothing: purchaser and burial records are personal information.
--   * Sale status and burial status are separate columns. A site can be sold and unused, and only the database
--     functions below (or writes that keep the same invariants, enforced by triggers) can move them.
--   * Double sale is impossible: one ACTIVE sale per site (partial unique index) plus a row lock on the site.
--   * Overpayment is impossible: a payment trigger locks the sale row and refuses amounts above the balance.
--   * Tenant isolation is structural: every child row carries org_id and references its parent through a composite
--     (id, org_id) foreign key, so a row can never point at another organisation's cemetery, site or purchaser.
--
-- Additive only: new types, tables, functions, policies and one new organizations column (default false). No
-- existing row, policy or function is changed. Rollback: supabase/rollback/20260101000184_cemetery_down.sql.

-- ---------------------------------------------------------------------------------------------------------------
-- Module switch
-- ---------------------------------------------------------------------------------------------------------------

alter table public.organizations add column if not exists cemetery_enabled boolean not null default false;

comment on column public.organizations.cemetery_enabled is
  'Cemetery Management module switch (navigation, pages, API routes and RLS). Default false: switched on per '
  'organisation by the owner. Existing property-management features are unaffected either way.';

-- ---------------------------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------------------------

-- How the organisation transfers a grave: most South African cemeteries grant a right of interment (burial rights)
-- rather than selling the land. Drives terminology in the app; the data model is the same.
create type public.cemetery_tenure_model as enum ('burial_rights', 'land_sale');
create type public.grave_sale_status as enum ('available', 'reserved', 'sold', 'unavailable');
create type public.grave_burial_status as enum ('unused', 'occupied');
create type public.cemetery_sale_status as enum ('active', 'cancelled');

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

create table public.cemeteries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  address_line1 text,
  city text,
  province text,
  tenure_model public.cemetery_tenure_model not null default 'burial_rights',
  -- Optional limited-term rights (some municipal cemeteries grant e.g. 50-year rights). Null = in perpetuity.
  rights_term_years integer check (rights_term_years is null or rights_term_years between 1 and 999),
  -- Demonstration cemetery: every sale and payment recorded under it is flagged is_demo (no money moves).
  is_demo boolean not null default false,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, name)
);

create table public.cemetery_sections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  cemetery_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text,
  sort_order integer not null default 0,
  -- Schematic layout only (not a survey): how many sites are drawn per row in the grid.
  sites_per_row integer not null default 10 check (sites_per_row between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cemetery_id, org_id) references public.cemeteries(id, org_id) on delete restrict,
  unique (id, org_id),
  unique (id, cemetery_id),
  unique (cemetery_id, code)
);

create table public.cemetery_purchasers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) between 1 and 200),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  address text check (address is null or length(address) <= 500),
  next_of_kin_name text check (next_of_kin_name is null or length(next_of_kin_name) <= 200),
  next_of_kin_phone text check (next_of_kin_phone is null or length(next_of_kin_phone) <= 40),
  next_of_kin_relationship text check (next_of_kin_relationship is null or length(next_of_kin_relationship) <= 80),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);

create table public.cemetery_sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  cemetery_id uuid not null,
  section_id uuid not null,
  site_number integer not null check (site_number between 1 and 99999),
  reference text not null check (length(reference) between 1 and 40),
  -- Schematic position (row/column in the section grid) and optional plot details. Not a survey or cadastral map.
  row_label text,
  plot_position integer,
  length_m numeric(6, 2) check (length_m is null or length_m > 0),
  width_m numeric(6, 2) check (width_m is null or width_m > 0),
  site_type text not null default 'single' check (site_type in ('single', 'double', 'child', 'cremation')),
  -- Burial rules: how many interments the site allows (e.g. 2 for a double-depth grave).
  max_interments integer not null default 1 check (max_interments between 1 and 10),
  sale_status public.grave_sale_status not null default 'available',
  burial_status public.grave_burial_status not null default 'unused',
  list_price numeric(12, 2) check (list_price is null or list_price >= 0),
  reserved_for_purchaser_id uuid,
  reserved_until date,
  reservation_notes text,
  unavailable_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cemetery_id, org_id) references public.cemeteries(id, org_id) on delete restrict,
  foreign key (section_id, org_id) references public.cemetery_sections(id, org_id) on delete restrict,
  foreign key (section_id, cemetery_id) references public.cemetery_sections(id, cemetery_id) on delete restrict,
  foreign key (reserved_for_purchaser_id, org_id) references public.cemetery_purchasers(id, org_id) on delete restrict,
  unique (id, org_id),
  unique (cemetery_id, reference),
  unique (section_id, site_number),
  check ((sale_status = 'reserved') = (reserved_for_purchaser_id is not null)),
  check (sale_status = 'unavailable' or unavailable_reason is null)
);

create sequence public.cemetery_sale_number_seq;
create sequence public.cemetery_receipt_number_seq;

create table public.cemetery_sales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  cemetery_id uuid not null,
  site_id uuid not null,
  purchaser_id uuid not null,
  sale_number text not null default ('GS-' || lpad(nextval('public.cemetery_sale_number_seq')::text, 6, '0')) unique,
  -- Snapshot of the cemetery's tenure model at the time of sale (terminology on the sale record).
  tenure_model public.cemetery_tenure_model not null,
  sale_date date not null default current_date,
  price numeric(12, 2) not null check (price > 0),
  status public.cemetery_sale_status not null default 'active',
  is_demo boolean not null default false,
  notes text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cemetery_id, org_id) references public.cemeteries(id, org_id) on delete restrict,
  foreign key (site_id, org_id) references public.cemetery_sites(id, org_id) on delete restrict,
  foreign key (purchaser_id, org_id) references public.cemetery_purchasers(id, org_id) on delete restrict,
  unique (id, org_id),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

-- THE double-sale guard: at most one active sale per grave site, whatever path writes it.
create unique index cemetery_sales_one_active_per_site on public.cemetery_sales (site_id) where status = 'active';
create index cemetery_sales_purchaser_idx on public.cemetery_sales (purchaser_id);
create index cemetery_sales_org_idx on public.cemetery_sales (org_id, sale_date desc);

create table public.cemetery_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sale_id uuid not null,
  receipt_number text not null default ('GR-' || lpad(nextval('public.cemetery_receipt_number_seq')::text, 6, '0')) unique,
  amount numeric(12, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  method public.payment_method not null,
  reference text check (reference is null or length(reference) <= 120),
  is_deposit boolean not null default false,
  -- Demonstration transaction: recorded for a demo cemetery, no money was received.
  is_demo boolean not null default false,
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (sale_id, org_id) references public.cemetery_sales(id, org_id) on delete restrict
);

create index cemetery_payments_sale_idx on public.cemetery_payments (sale_id);
create index cemetery_payments_org_idx on public.cemetery_payments (org_id, paid_on desc);

create table public.cemetery_burials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  sale_id uuid,
  deceased_full_name text not null check (length(btrim(deceased_full_name)) between 1 and 200),
  date_of_birth date,
  date_of_death date,
  burial_date date not null,
  interment_number integer not null default 1 check (interment_number between 1 and 10),
  burial_order_number text check (burial_order_number is null or length(burial_order_number) <= 60),
  funeral_undertaker text check (funeral_undertaker is null or length(funeral_undertaker) <= 200),
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (site_id, org_id) references public.cemetery_sites(id, org_id) on delete restrict,
  foreign key (sale_id, org_id) references public.cemetery_sales(id, org_id) on delete restrict,
  unique (site_id, interment_number),
  check (date_of_death is null or burial_date >= date_of_death),
  check (date_of_birth is null or date_of_death is null or date_of_death >= date_of_birth)
);

-- Supporting-document register for a site or sale (metadata: title, type, reference). File storage for cemetery
-- documents is not wired in this release; generated sale records and receipts are produced by the app itself.
create table public.cemetery_site_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  sale_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  document_type text not null default 'other'
    check (document_type in ('agreement', 'title_deed', 'burial_order', 'death_certificate', 'id_document', 'correspondence', 'other')),
  reference text check (reference is null or length(reference) <= 120),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (site_id, org_id) references public.cemetery_sites(id, org_id) on delete restrict,
  foreign key (sale_id, org_id) references public.cemetery_sales(id, org_id) on delete restrict
);

-- Site history: one row per status-changing event (reserved, released, sold, cancelled, withdrawn, returned to sale,
-- burial), each with its EFFECTIVE date. Written only by the triggers below (never directly by users), and kept in
-- chronological order per site: an event dated before the site's latest event, or in the future, is refused -- so a
-- site's history cannot be recorded out of order by any path (app, API, seeder or service role).
create table public.cemetery_site_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  event_type text not null
    check (event_type in ('reserved', 'reservation_released', 'sold', 'sale_cancelled', 'withdrawn', 'returned_to_sale', 'burial')),
  event_date date not null,
  sale_id uuid,
  purchaser_id uuid,
  notes text,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  foreign key (site_id, org_id) references public.cemetery_sites(id, org_id) on delete restrict,
  foreign key (sale_id, org_id) references public.cemetery_sales(id, org_id) on delete restrict,
  foreign key (purchaser_id, org_id) references public.cemetery_purchasers(id, org_id) on delete restrict
);

create index cemetery_site_events_site_idx on public.cemetery_site_events (site_id, event_date, created_at);
create index cemetery_site_events_org_idx on public.cemetery_site_events (org_id, event_date);

create index cemetery_sites_section_idx on public.cemetery_sites (section_id, site_number);
create index cemetery_sites_org_status_idx on public.cemetery_sites (org_id, sale_status);
create index cemetery_burials_site_idx on public.cemetery_burials (site_id);
create index cemetery_site_documents_site_idx on public.cemetery_site_documents (site_id);

-- Payment totals per sale (security_invoker: the caller's RLS applies to the underlying rows). A cancelled sale owes
-- nothing; what was paid on it stays recorded (retained under the cemetery's cancellation terms).
create view public.cemetery_sale_balances
with (security_invoker = true) as
select s.id as sale_id,
       s.org_id,
       s.status,
       s.price,
       coalesce(sum(p.amount), 0)::numeric(12, 2) as amount_paid,
       (case when s.status = 'active' then s.price - coalesce(sum(p.amount), 0) else 0 end)::numeric(12, 2) as balance_due
  from public.cemetery_sales s
  left join public.cemetery_payments p on p.sale_id = s.id
 group by s.id, s.org_id, s.status, s.price;

-- ---------------------------------------------------------------------------------------------------------------
-- Integrity triggers (apply to every writer, including the service role)
-- ---------------------------------------------------------------------------------------------------------------

-- The business date in South Africa: nothing may be recorded as having happened after it.
create or replace function public.cemetery_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Africa/Johannesburg')::date;
$$;

create trigger set_cemeteries_updated_at before update on public.cemeteries
  for each row execute function public.set_updated_at();
create trigger set_cemetery_sections_updated_at before update on public.cemetery_sections
  for each row execute function public.set_updated_at();
create trigger set_cemetery_purchasers_updated_at before update on public.cemetery_purchasers
  for each row execute function public.set_updated_at();
create trigger set_cemetery_sites_updated_at before update on public.cemetery_sites
  for each row execute function public.set_updated_at();
create trigger set_cemetery_sales_updated_at before update on public.cemetery_sales
  for each row execute function public.set_updated_at();
create trigger set_cemetery_burials_updated_at before update on public.cemetery_burials
  for each row execute function public.set_updated_at();

-- A site's sale/burial status must agree with its sales and burials. Status can only move with the record that
-- justifies it, so a direct UPDATE cannot mark a site sold without a sale, or free a site that has one.
create or replace function public.cemetery_sites_check_status()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_active_sale boolean;
  v_burials integer;
begin
  if new.sale_status is distinct from old.sale_status then
    select exists (select 1 from public.cemetery_sales s where s.site_id = new.id and s.status = 'active') into v_active_sale;
    if new.sale_status = 'sold' and not v_active_sale then
      raise exception 'cemetery_site_requires_sale: a site can only be marked sold by recording a sale' using errcode = 'P0001';
    end if;
    if old.sale_status = 'sold' and v_active_sale then
      raise exception 'cemetery_site_has_active_sale: cancel the sale before changing this site''s status' using errcode = 'P0001';
    end if;
  end if;
  if new.burial_status is distinct from old.burial_status then
    select count(*) from public.cemetery_burials b where b.site_id = new.id into v_burials;
    if (new.burial_status = 'occupied') <> (v_burials > 0) then
      raise exception 'cemetery_burial_status_mismatch: burial status follows the burial register' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger cemetery_sites_check_status before update on public.cemetery_sites
  for each row execute function public.cemetery_sites_check_status();

-- A new sale must be for an open site of the same cemetery: available, or reserved for this purchaser. The site
-- row is locked so two concurrent sales serialise; the partial unique index is the final word.
create or replace function public.cemetery_sales_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_site public.cemetery_sites%rowtype;
  v_cemetery public.cemeteries%rowtype;
begin
  select * into v_site from public.cemetery_sites where id = new.site_id for update;
  if not found then
    raise exception 'cemetery_site_not_found' using errcode = 'P0002';
  end if;
  if v_site.cemetery_id <> new.cemetery_id then
    raise exception 'cemetery_site_wrong_cemetery' using errcode = 'P0001';
  end if;
  if new.sale_date > public.cemetery_today() then
    raise exception 'cemetery_future_date: a sale cannot be dated in the future' using errcode = 'P0001';
  end if;
  if new.status = 'active' then
    if v_site.sale_status = 'sold' then
      raise exception 'cemetery_site_already_sold: grave site % is already sold', v_site.reference using errcode = 'P0001';
    elsif v_site.sale_status = 'unavailable' then
      raise exception 'cemetery_site_unavailable: grave site % is not available for sale', v_site.reference using errcode = 'P0001';
    elsif v_site.sale_status = 'reserved' and v_site.reserved_for_purchaser_id <> new.purchaser_id then
      raise exception 'cemetery_site_reserved_for_other: grave site % is reserved for another purchaser', v_site.reference using errcode = 'P0001';
    end if;
  end if;
  select * into v_cemetery from public.cemeteries where id = new.cemetery_id;
  new.tenure_model := v_cemetery.tenure_model;
  new.is_demo := new.is_demo or v_cemetery.is_demo;
  return new;
end;
$$;

create trigger cemetery_sales_before_insert before insert on public.cemetery_sales
  for each row execute function public.cemetery_sales_before_insert();

-- Sale price, site, purchaser and numbering are fixed once recorded; only notes and cancellation may change.
create or replace function public.cemetery_sales_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.site_id <> old.site_id or new.purchaser_id <> old.purchaser_id or new.cemetery_id <> old.cemetery_id
     or new.price <> old.price or new.sale_number <> old.sale_number or new.org_id <> old.org_id
     or new.is_demo <> old.is_demo or new.tenure_model <> old.tenure_model then
    raise exception 'cemetery_sale_immutable: a recorded sale cannot be re-pointed or re-priced' using errcode = 'P0001';
  end if;
  if old.status = 'cancelled' and new.status = 'active' then
    raise exception 'cemetery_sale_cancelled: a cancelled sale cannot be reactivated' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger cemetery_sales_before_update before update on public.cemetery_sales
  for each row execute function public.cemetery_sales_before_update();

-- Payments: only against an active sale, never above the balance due. Locks the sale so concurrent payments
-- serialise. Payments are append-only (no UPDATE/DELETE policy; a second trigger refuses edits by any writer).
-- SECURITY DEFINER because the row lock needs UPDATE rights on the sale, which an accountant (allowed to receipt
-- payments) does not have. It therefore checks the caller itself, before reading anything: a signed-in caller must
-- be accountant+ in the payment's organisation and the sale must belong to that organisation, so the function never
-- reveals another organisation's sale or balance. (auth.uid() is null only for the service role / migrations.)
create or replace function public.cemetery_payments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.cemetery_sales%rowtype;
  v_paid numeric;
begin
  if auth.uid() is not null and new.org_id not in (select public.cemetery_org_ids('accountant')) then
    raise exception 'cemetery_sale_not_found' using errcode = 'P0002';
  end if;
  select * into v_sale from public.cemetery_sales where id = new.sale_id and org_id = new.org_id for update;
  if not found then
    raise exception 'cemetery_sale_not_found' using errcode = 'P0002';
  end if;
  if v_sale.status <> 'active' then
    raise exception 'cemetery_sale_not_active: payments can only be recorded against an active sale' using errcode = 'P0001';
  end if;
  if new.paid_on > public.cemetery_today() then
    raise exception 'cemetery_future_date: a payment cannot be dated in the future' using errcode = 'P0001';
  end if;
  if new.paid_on < v_sale.sale_date then
    raise exception 'cemetery_payment_before_sale: the payment date is before the sale date (%)', v_sale.sale_date using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.cemetery_payments where sale_id = new.sale_id;
  if new.amount > v_sale.price - v_paid then
    raise exception 'cemetery_payment_exceeds_balance: balance due is %', to_char(v_sale.price - v_paid, 'FM999999990.00')
      using errcode = 'P0001';
  end if;
  new.is_demo := new.is_demo or v_sale.is_demo;
  return new;
end;
$$;

create trigger cemetery_payments_before_insert before insert on public.cemetery_payments
  for each row execute function public.cemetery_payments_before_insert();

create or replace function public.cemetery_payments_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'cemetery_payment_immutable: recorded payments cannot be edited or deleted' using errcode = 'P0001';
end;
$$;

create trigger cemetery_payments_immutable before update or delete on public.cemetery_payments
  for each row execute function public.cemetery_payments_immutable();

create or replace function public.cemetery_burials_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.burial_date > public.cemetery_today() then
    raise exception 'cemetery_future_date: a burial cannot be recorded with a future date' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger cemetery_burials_before_insert before insert on public.cemetery_burials
  for each row execute function public.cemetery_burials_before_insert();

-- ---------------------------------------------------------------------------------------------------------------
-- Site history (cemetery_site_events)
-- ---------------------------------------------------------------------------------------------------------------

-- Effective date of the current workflow step. The workflow functions set it for their own transaction when the
-- caller gives a date (for example a reservation made last month); otherwise it is today.
create or replace function public.cemetery_event_date()
returns date
language sql
stable
as $$
  select coalesce(nullif(current_setting('proplyst.cemetery_event_date', true), '')::date, public.cemetery_today());
$$;

create or replace function public.cemetery_site_events_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_latest date;
begin
  if new.event_date > public.cemetery_today() then
    raise exception 'cemetery_future_date: % cannot be dated in the future', replace(new.event_type, '_', ' ') using errcode = 'P0001';
  end if;
  select max(event_date) into v_latest from public.cemetery_site_events where site_id = new.site_id;
  if v_latest is not null and new.event_date < v_latest then
    raise exception 'cemetery_out_of_order: this site already has history dated % — % cannot be dated %',
      v_latest, replace(new.event_type, '_', ' '), new.event_date using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger cemetery_site_events_before_insert before insert on public.cemetery_site_events
  for each row execute function public.cemetery_site_events_before_insert();

create or replace function public.cemetery_site_events_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'cemetery_history_immutable: site history cannot be edited or deleted' using errcode = 'P0001';
end;
$$;

create trigger cemetery_site_events_immutable before update or delete on public.cemetery_site_events
  for each row execute function public.cemetery_site_events_immutable();

-- Logged by triggers (SECURITY DEFINER: users have no INSERT privilege on the history, so it cannot be forged).
create or replace function public.cemetery_sites_log_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  if new.sale_status is not distinct from old.sale_status then
    return new;
  end if;
  -- 'sold' and 'sale_cancelled' are logged by the sale itself (with the sale's own dates).
  v_type := case
    when new.sale_status = 'reserved' then 'reserved'
    when old.sale_status = 'reserved' and new.sale_status = 'available' then 'reservation_released'
    when new.sale_status = 'unavailable' then 'withdrawn'
    when old.sale_status = 'unavailable' and new.sale_status = 'available' then 'returned_to_sale'
  end;
  if v_type is not null then
    insert into public.cemetery_site_events (org_id, site_id, event_type, event_date, purchaser_id, notes, actor_user_id)
    values (
      new.org_id, new.id, v_type, public.cemetery_event_date(),
      case v_type when 'reserved' then new.reserved_for_purchaser_id when 'reservation_released' then old.reserved_for_purchaser_id end,
      case v_type when 'reserved' then new.reservation_notes when 'withdrawn' then new.unavailable_reason end,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

create trigger cemetery_sites_log_event after update on public.cemetery_sites
  for each row execute function public.cemetery_sites_log_event();

create or replace function public.cemetery_sales_log_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' and new.status = 'active' then
    insert into public.cemetery_site_events (org_id, site_id, event_type, event_date, sale_id, purchaser_id, actor_user_id)
    values (new.org_id, new.site_id, 'sold', new.sale_date, new.id, new.purchaser_id, auth.uid());
  elsif TG_OP = 'UPDATE' and old.status = 'active' and new.status = 'cancelled' then
    insert into public.cemetery_site_events (org_id, site_id, event_type, event_date, sale_id, purchaser_id, notes, actor_user_id)
    values (new.org_id, new.site_id, 'sale_cancelled', (new.cancelled_at at time zone 'Africa/Johannesburg')::date,
            new.id, new.purchaser_id, new.cancel_reason, auth.uid());
  end if;
  return new;
end;
$$;

create trigger cemetery_sales_log_event after insert or update on public.cemetery_sales
  for each row execute function public.cemetery_sales_log_event();

create or replace function public.cemetery_burials_log_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cemetery_site_events (org_id, site_id, event_type, event_date, sale_id, actor_user_id)
  values (new.org_id, new.site_id, 'burial', new.burial_date, new.sale_id, auth.uid());
  return new;
end;
$$;

create trigger cemetery_burials_log_event after insert on public.cemetery_burials
  for each row execute function public.cemetery_burials_log_event();

-- Audit trail in audit_events, WITHOUT personal information. The generic log_audit_event_trigger() copies the whole
-- row into before/after, and audit_events is readable by every member of the organisation (viewer+) -- which would
-- hand purchaser and burial details to agents and viewers that the cemetery policies deliberately exclude. This
-- variant keeps the same audit shape but stores only the columns named in the trigger arguments (identifiers,
-- references, statuses, amounts). Sites: updates only (bulk creation is noise).
create or replace function public.cemetery_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_before jsonb;
  v_after jsonb;
begin
  if TG_OP <> 'INSERT' then
    select jsonb_object_agg(key, value) into v_before from jsonb_each(to_jsonb(old)) where key = any (TG_ARGV);
  end if;
  if TG_OP <> 'DELETE' then
    select jsonb_object_agg(key, value) into v_after from jsonb_each(to_jsonb(new)) where key = any (TG_ARGV);
  end if;
  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after)
  values (
    (v_row ->> 'org_id')::uuid,
    auth.uid(),
    (case when auth.uid() is null then 'system' else 'user' end)::public.audit_actor_type,
    TG_TABLE_NAME || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    (v_row ->> 'id')::uuid,
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;

create trigger cemeteries_audit_trigger after insert or update or delete on public.cemeteries
  for each row execute function public.cemetery_audit_trigger('id', 'name', 'tenure_model', 'is_demo');
create trigger cemetery_sites_audit_trigger after update or delete on public.cemetery_sites
  for each row execute function public.cemetery_audit_trigger('id', 'reference', 'sale_status', 'burial_status', 'list_price', 'max_interments');
create trigger cemetery_purchasers_audit_trigger after insert or update or delete on public.cemetery_purchasers
  for each row execute function public.cemetery_audit_trigger('id');
create trigger cemetery_sales_audit_trigger after insert or update or delete on public.cemetery_sales
  for each row execute function public.cemetery_audit_trigger('id', 'sale_number', 'site_id', 'purchaser_id', 'price', 'status', 'is_demo');
create trigger cemetery_payments_audit_trigger after insert on public.cemetery_payments
  for each row execute function public.cemetery_audit_trigger('id', 'receipt_number', 'sale_id', 'amount', 'paid_on', 'method', 'is_demo');
create trigger cemetery_burials_audit_trigger after insert or update or delete on public.cemetery_burials
  for each row execute function public.cemetery_audit_trigger('id', 'site_id', 'sale_id', 'interment_number', 'burial_date');

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------------------------

-- Organisations where the caller holds at least p_min_role AND the module is switched on. Set-based (evaluated once
-- per statement, not per row) and only over the caller's own memberships. has_org_role() keeps its existing
-- semantics (active membership, org not archived, suspended/cancelled orgs read-only, plan suspension).
create or replace function public.cemetery_org_ids(p_min_role public.organization_member_role)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.id
    from public.organizations o
   where o.cemetery_enabled
     and o.id in (select om.org_id from public.organization_members om where om.user_id = auth.uid() and om.status = 'active')
     and public.has_org_role(o.id, p_min_role);
$$;

revoke all on function public.cemetery_org_ids(public.organization_member_role) from public, anon;
grant execute on function public.cemetery_org_ids(public.organization_member_role) to authenticated, service_role;

alter table public.cemeteries enable row level security;
alter table public.cemetery_sections enable row level security;
alter table public.cemetery_purchasers enable row level security;
alter table public.cemetery_sites enable row level security;
alter table public.cemetery_sales enable row level security;
alter table public.cemetery_payments enable row level security;
alter table public.cemetery_burials enable row level security;
alter table public.cemetery_site_documents enable row level security;
alter table public.cemetery_site_events enable row level security;

-- Read: accountant+ (accountant, manager, principal). Write: manager+. No DELETE policies anywhere: records are
-- corrected or cancelled, never removed. Site history is read-only for everyone (written by triggers).
do $$
declare
  t text;
begin
  foreach t in array array['cemeteries', 'cemetery_sections', 'cemetery_purchasers', 'cemetery_sites',
                           'cemetery_sales', 'cemetery_burials', 'cemetery_site_documents', 'cemetery_payments',
                           'cemetery_site_events'] loop
    execute format('create policy %I on public.%I for select to authenticated using (org_id in (select public.cemetery_org_ids(''accountant'')))',
                   t || '_select_accountant_plus', t);
  end loop;
  foreach t in array array['cemeteries', 'cemetery_sections', 'cemetery_purchasers', 'cemetery_sites',
                           'cemetery_sales', 'cemetery_burials', 'cemetery_site_documents'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (org_id in (select public.cemetery_org_ids(''manager'')))',
                   t || '_insert_manager_plus', t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id in (select public.cemetery_org_ids(''manager''))) with check (org_id in (select public.cemetery_org_ids(''manager'')))',
                   t || '_update_manager_plus', t);
  end loop;
end $$;

-- Payments may also be recorded by an accountant (same split as rental payments: canPostAccountingRecords).
create policy cemetery_payments_insert_accountant_plus on public.cemetery_payments
  for insert to authenticated with check (org_id in (select public.cemetery_org_ids('accountant')));

-- Explicit privileges (the schema's default privileges grant ALL to authenticated): no DELETE anywhere, and
-- payments are insert-only.
revoke all on public.cemeteries, public.cemetery_sections, public.cemetery_purchasers, public.cemetery_sites,
  public.cemetery_sales, public.cemetery_payments, public.cemetery_burials, public.cemetery_site_documents,
  public.cemetery_site_events, public.cemetery_sale_balances from authenticated;
grant select, insert, update on public.cemeteries, public.cemetery_sections, public.cemetery_purchasers,
  public.cemetery_sites, public.cemetery_sales, public.cemetery_burials, public.cemetery_site_documents to authenticated;
grant select, insert on public.cemetery_payments to authenticated;
grant select on public.cemetery_site_events, public.cemetery_sale_balances to authenticated;
grant all on public.cemeteries, public.cemetery_sections, public.cemetery_purchasers, public.cemetery_sites,
  public.cemetery_sales, public.cemetery_payments, public.cemetery_burials, public.cemetery_site_documents,
  public.cemetery_site_events, public.cemetery_sale_balances to service_role;
revoke all on public.cemeteries, public.cemetery_sections, public.cemetery_purchasers, public.cemetery_sites,
  public.cemetery_sales, public.cemetery_payments, public.cemetery_burials, public.cemetery_site_documents,
  public.cemetery_site_events, public.cemetery_sale_balances from anon;
grant usage on sequence public.cemetery_sale_number_seq, public.cemetery_receipt_number_seq to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Workflow functions (SECURITY INVOKER: they run under the caller's RLS, so they can never reach another
-- organisation or exceed the caller's role. Each is one transaction.)
-- ---------------------------------------------------------------------------------------------------------------

-- Creates the sites 1..p_count of a section that do not exist yet (idempotent: re-running creates nothing new).
create or replace function public.cemetery_generate_sites(
  p_section_id uuid,
  p_count integer,
  p_list_price numeric default null,
  p_length_m numeric default null,
  p_width_m numeric default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_section public.cemetery_sections%rowtype;
  v_created integer;
begin
  if p_count is null or p_count < 1 or p_count > 2000 then
    raise exception 'cemetery_invalid_site_count' using errcode = '22023';
  end if;
  select * into v_section from public.cemetery_sections where id = p_section_id;
  if not found then
    raise exception 'cemetery_section_not_found' using errcode = 'P0002';
  end if;
  insert into public.cemetery_sites (org_id, cemetery_id, section_id, site_number, reference, row_label, plot_position,
                                     length_m, width_m, list_price)
  select v_section.org_id, v_section.cemetery_id, v_section.id, n,
         v_section.code || '-' || lpad(n::text, 3, '0'),
         'Row ' || ((n - 1) / v_section.sites_per_row + 1),
         ((n - 1) % v_section.sites_per_row) + 1,
         p_length_m, p_width_m, p_list_price
    from generate_series(1, p_count) n
  on conflict (section_id, site_number) do nothing;
  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

-- p_reserved_on: the date the reservation was made (default today); it is recorded in the site history.
create or replace function public.cemetery_reserve_site(
  p_site_id uuid,
  p_purchaser_id uuid,
  p_reserved_until date default null,
  p_notes text default null,
  p_reserved_on date default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_site public.cemetery_sites%rowtype;
  v_on date := coalesce(p_reserved_on, public.cemetery_today());
begin
  select * into v_site from public.cemetery_sites where id = p_site_id for update;
  if not found then
    raise exception 'cemetery_site_not_found' using errcode = 'P0002';
  end if;
  if v_site.sale_status <> 'available' then
    raise exception 'cemetery_site_not_available: grave site % is %', v_site.reference, v_site.sale_status using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cemetery_purchasers where id = p_purchaser_id and org_id = v_site.org_id) then
    raise exception 'cemetery_purchaser_not_found' using errcode = 'P0002';
  end if;
  if p_reserved_until is not null and p_reserved_until < v_on then
    raise exception 'cemetery_out_of_order: the reservation cannot end before it starts' using errcode = 'P0001';
  end if;
  perform set_config('proplyst.cemetery_event_date', v_on::text, true);
  update public.cemetery_sites
     set sale_status = 'reserved', reserved_for_purchaser_id = p_purchaser_id, reserved_until = p_reserved_until,
         reservation_notes = p_notes
   where id = p_site_id;
  perform set_config('proplyst.cemetery_event_date', '', true);
end;
$$;

-- p_released_on: when the reservation lapsed or was released (default today).
create or replace function public.cemetery_release_reservation(p_site_id uuid, p_released_on date default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_site public.cemetery_sites%rowtype;
begin
  select * into v_site from public.cemetery_sites where id = p_site_id for update;
  if not found then
    raise exception 'cemetery_site_not_found' using errcode = 'P0002';
  end if;
  if v_site.sale_status <> 'reserved' then
    raise exception 'cemetery_site_not_reserved: grave site % is not reserved', v_site.reference using errcode = 'P0001';
  end if;
  perform set_config('proplyst.cemetery_event_date', coalesce(p_released_on, public.cemetery_today())::text, true);
  update public.cemetery_sites
     set sale_status = 'available', reserved_for_purchaser_id = null, reserved_until = null, reservation_notes = null
   where id = p_site_id;
  perform set_config('proplyst.cemetery_event_date', '', true);
end;
$$;

create or replace function public.cemetery_set_site_unavailable(
  p_site_id uuid,
  p_unavailable boolean,
  p_reason text default null,
  p_effective_on date default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_site public.cemetery_sites%rowtype;
begin
  select * into v_site from public.cemetery_sites where id = p_site_id for update;
  if not found then
    raise exception 'cemetery_site_not_found' using errcode = 'P0002';
  end if;
  perform set_config('proplyst.cemetery_event_date', coalesce(p_effective_on, public.cemetery_today())::text, true);
  if p_unavailable then
    if v_site.sale_status <> 'available' then
      raise exception 'cemetery_site_not_available: only an available site can be withdrawn (site % is %)', v_site.reference, v_site.sale_status
        using errcode = 'P0001';
    end if;
    if p_reason is null or length(btrim(p_reason)) = 0 then
      raise exception 'cemetery_reason_required: give a reason for withdrawing the site' using errcode = '22023';
    end if;
    update public.cemetery_sites set sale_status = 'unavailable', unavailable_reason = btrim(p_reason) where id = p_site_id;
  else
    if v_site.sale_status <> 'unavailable' then
      raise exception 'cemetery_site_not_unavailable: grave site % is not withdrawn', v_site.reference using errcode = 'P0001';
    end if;
    update public.cemetery_sites set sale_status = 'available', unavailable_reason = null where id = p_site_id;
  end if;
  perform set_config('proplyst.cemetery_event_date', '', true);
end;
$$;

-- Cancel an active sale / grant of rights (manager+): the site returns to Available. Payments already received stay
-- recorded (retained under the cemetery's cancellation terms; refunds are handled outside Proplyst). Refused when a
-- burial has been recorded under the sale, and dated no earlier than the sale or its last payment.
create or replace function public.cemetery_cancel_sale(p_sale_id uuid, p_reason text, p_cancelled_on date default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale public.cemetery_sales%rowtype;
  v_on date := coalesce(p_cancelled_on, public.cemetery_today());
  v_last_payment date;
begin
  select * into v_sale from public.cemetery_sales where id = p_sale_id for update;
  if not found then
    raise exception 'cemetery_sale_not_found' using errcode = 'P0002';
  end if;
  if v_sale.status <> 'active' then
    raise exception 'cemetery_sale_not_active: this sale is already cancelled' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'cemetery_reason_required: give a reason for the cancellation' using errcode = '22023';
  end if;
  if exists (select 1 from public.cemetery_burials b where b.sale_id = v_sale.id) then
    raise exception 'cemetery_sale_has_burial: a burial is recorded under this sale; it cannot be cancelled' using errcode = 'P0001';
  end if;
  if v_on > public.cemetery_today() then
    raise exception 'cemetery_future_date: a cancellation cannot be dated in the future' using errcode = 'P0001';
  end if;
  select max(paid_on) into v_last_payment from public.cemetery_payments where sale_id = v_sale.id;
  if v_on < v_sale.sale_date or (v_last_payment is not null and v_on < v_last_payment) then
    raise exception 'cemetery_out_of_order: the cancellation cannot be dated before the sale or its last payment' using errcode = 'P0001';
  end if;
  update public.cemetery_sales
     set status = 'cancelled',
         cancelled_at = (v_on + time '12:00') at time zone 'Africa/Johannesburg',
         cancel_reason = btrim(p_reason)
   where id = v_sale.id;
  update public.cemetery_sites set sale_status = 'available' where id = v_sale.site_id;
end;
$$;

-- The sale workflow in one transaction: sale record, optional deposit (receipted), site marked sold, reservation
-- cleared. Returns the identifiers the app needs for the sale record and receipt.
create or replace function public.cemetery_record_sale(
  p_site_id uuid,
  p_purchaser_id uuid,
  p_price numeric,
  p_sale_date date default null,
  p_deposit numeric default 0,
  p_method public.payment_method default 'eft',
  p_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_site public.cemetery_sites%rowtype;
  v_sale public.cemetery_sales%rowtype;
  v_payment public.cemetery_payments%rowtype;
begin
  if p_price is null or p_price <= 0 then
    raise exception 'cemetery_invalid_price: the selling price must be greater than zero' using errcode = '22023';
  end if;
  if coalesce(p_deposit, 0) < 0 or coalesce(p_deposit, 0) > p_price then
    raise exception 'cemetery_invalid_deposit: the deposit must be between zero and the selling price' using errcode = '22023';
  end if;
  select * into v_site from public.cemetery_sites where id = p_site_id for update;
  if not found then
    raise exception 'cemetery_site_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.cemetery_purchasers where id = p_purchaser_id and org_id = v_site.org_id) then
    raise exception 'cemetery_purchaser_not_found' using errcode = 'P0002';
  end if;

  insert into public.cemetery_sales (org_id, cemetery_id, site_id, purchaser_id, tenure_model, sale_date, price, notes, created_by)
  values (v_site.org_id, v_site.cemetery_id, v_site.id, p_purchaser_id, 'burial_rights', coalesce(p_sale_date, public.cemetery_today()),
          p_price, p_notes, auth.uid())
  returning * into v_sale;

  update public.cemetery_sites
     set sale_status = 'sold', reserved_for_purchaser_id = null, reserved_until = null, reservation_notes = null
   where id = v_site.id;

  if coalesce(p_deposit, 0) > 0 then
    insert into public.cemetery_payments (org_id, sale_id, amount, paid_on, method, reference, is_deposit, recorded_by)
    values (v_sale.org_id, v_sale.id, p_deposit, coalesce(p_sale_date, public.cemetery_today()), p_method, p_reference, true, auth.uid())
    returning * into v_payment;
  end if;

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'sale_number', v_sale.sale_number,
    'payment_id', v_payment.id,
    'receipt_number', v_payment.receipt_number,
    'is_demo', v_sale.is_demo
  );
end;
$$;

create or replace function public.cemetery_record_payment(
  p_sale_id uuid,
  p_amount numeric,
  p_paid_on date default null,
  p_method public.payment_method default 'eft',
  p_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale public.cemetery_sales%rowtype;
  v_payment public.cemetery_payments%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'cemetery_invalid_amount: the payment amount must be greater than zero' using errcode = '22023';
  end if;
  select * into v_sale from public.cemetery_sales where id = p_sale_id;
  if not found then
    raise exception 'cemetery_sale_not_found' using errcode = 'P0002';
  end if;
  insert into public.cemetery_payments (org_id, sale_id, amount, paid_on, method, reference, notes, recorded_by)
  values (v_sale.org_id, v_sale.id, p_amount, coalesce(p_paid_on, public.cemetery_today()), p_method, p_reference, p_notes, auth.uid())
  returning * into v_payment;
  return jsonb_build_object('payment_id', v_payment.id, 'receipt_number', v_payment.receipt_number, 'is_demo', v_payment.is_demo);
end;
$$;

-- Burial (interment) record. Requires burial rights to have been granted (an active sale) and a free interment
-- slot under the site's max_interments rule; marks the site occupied.
create or replace function public.cemetery_record_burial(
  p_site_id uuid,
  p_deceased_full_name text,
  p_burial_date date,
  p_date_of_death date default null,
  p_date_of_birth date default null,
  p_burial_order_number text default null,
  p_funeral_undertaker text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_site public.cemetery_sites%rowtype;
  v_sale_id uuid;
  v_count integer;
  v_burial public.cemetery_burials%rowtype;
begin
  select * into v_site from public.cemetery_sites where id = p_site_id for update;
  if not found then
    raise exception 'cemetery_site_not_found' using errcode = 'P0002';
  end if;
  select id into v_sale_id from public.cemetery_sales where site_id = p_site_id and status = 'active';
  if v_sale_id is null then
    raise exception 'cemetery_site_not_sold: record the sale or grant of rights for % before a burial', v_site.reference
      using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.cemetery_burials where site_id = p_site_id;
  if v_count >= v_site.max_interments then
    raise exception 'cemetery_site_full: grave site % allows % interment(s)', v_site.reference, v_site.max_interments
      using errcode = 'P0001';
  end if;
  insert into public.cemetery_burials (org_id, site_id, sale_id, deceased_full_name, date_of_birth, date_of_death, burial_date,
                                       interment_number, burial_order_number, funeral_undertaker, notes, recorded_by)
  values (v_site.org_id, v_site.id, v_sale_id, btrim(p_deceased_full_name), p_date_of_birth, p_date_of_death, p_burial_date,
          v_count + 1, p_burial_order_number, p_funeral_undertaker, p_notes, auth.uid())
  returning * into v_burial;
  if v_site.burial_status <> 'occupied' then
    update public.cemetery_sites set burial_status = 'occupied' where id = v_site.id;
  end if;
  return jsonb_build_object('burial_id', v_burial.id, 'interment_number', v_burial.interment_number);
end;
$$;

revoke all on function public.cemetery_generate_sites(uuid, integer, numeric, numeric, numeric) from public, anon;
revoke all on function public.cemetery_reserve_site(uuid, uuid, date, text, date) from public, anon;
revoke all on function public.cemetery_release_reservation(uuid, date) from public, anon;
revoke all on function public.cemetery_set_site_unavailable(uuid, boolean, text, date) from public, anon;
revoke all on function public.cemetery_cancel_sale(uuid, text, date) from public, anon;
revoke all on function public.cemetery_record_sale(uuid, uuid, numeric, date, numeric, public.payment_method, text, text) from public, anon;
revoke all on function public.cemetery_record_payment(uuid, numeric, date, public.payment_method, text, text) from public, anon;
revoke all on function public.cemetery_record_burial(uuid, text, date, date, date, text, text, text) from public, anon;
grant execute on function public.cemetery_generate_sites(uuid, integer, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.cemetery_reserve_site(uuid, uuid, date, text, date) to authenticated, service_role;
grant execute on function public.cemetery_release_reservation(uuid, date) to authenticated, service_role;
grant execute on function public.cemetery_set_site_unavailable(uuid, boolean, text, date) to authenticated, service_role;
grant execute on function public.cemetery_cancel_sale(uuid, text, date) to authenticated, service_role;
grant execute on function public.cemetery_record_sale(uuid, uuid, numeric, date, numeric, public.payment_method, text, text) to authenticated, service_role;
grant execute on function public.cemetery_record_payment(uuid, numeric, date, public.payment_method, text, text) to authenticated, service_role;
grant execute on function public.cemetery_record_burial(uuid, text, date, date, date, text, text, text) to authenticated, service_role;
