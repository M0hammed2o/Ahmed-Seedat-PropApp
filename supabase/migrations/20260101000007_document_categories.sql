-- Reference table: default (system) categories are visible to everyone; customer-created
-- custom categories are owned and private. This is what lets V1 "focus on default categories"
-- while leaving room for customers to add their own later without a schema change.
create table public.document_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  label text not null,
  is_default boolean not null default false,
  owner_user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint document_categories_owner_required_for_custom
    check (is_default or owner_user_id is not null)
);

-- Default categories: slug unique globally. Custom categories: slug unique per owner.
create unique index document_categories_default_slug_idx
  on public.document_categories (slug) where is_default;
create unique index document_categories_owner_slug_idx
  on public.document_categories (owner_user_id, slug) where not is_default;

alter table public.document_categories enable row level security;

create policy "document_categories_select"
  on public.document_categories for select
  using (is_default or owner_user_id = auth.uid());

create policy "document_categories_insert_own_custom"
  on public.document_categories for insert
  with check (not is_default and owner_user_id = auth.uid());

create policy "document_categories_delete_own_custom"
  on public.document_categories for delete
  using (not is_default and owner_user_id = auth.uid());

insert into public.document_categories (slug, label, is_default) values
  ('water', 'Water', true),
  ('electricity', 'Electricity', true),
  ('rates_and_taxes', 'Rates and Taxes', true),
  ('levies', 'Levies', true),
  ('insurance', 'Insurance', true),
  ('bond', 'Bond', true),
  ('maintenance', 'Maintenance', true),
  ('rental_documents', 'Rental Documents', true),
  ('proof_of_payment', 'Proof of Payment', true),
  ('receipt', 'Receipt', true),
  ('compliance_documents', 'Compliance Documents', true),
  ('tax_documents', 'Tax Documents', true),
  ('other', 'Other', true);

create table public.property_expected_categories (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  category_id uuid not null references public.document_categories(id) on delete cascade,
  is_expected boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, category_id)
);

create index property_expected_categories_property_id_idx
  on public.property_expected_categories (property_id);

create trigger set_property_expected_categories_updated_at
  before update on public.property_expected_categories
  for each row execute function public.set_updated_at();

alter table public.property_expected_categories enable row level security;

create policy "property_expected_categories_all_own"
  on public.property_expected_categories for all
  using (exists (
    select 1 from public.properties p
    where p.id = property_expected_categories.property_id and p.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.properties p
    where p.id = property_expected_categories.property_id and p.owner_user_id = auth.uid()
  ));
