create table public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 80),
  address_line1 text not null check (char_length(address_line1) between 1 and 200),
  address_line2 text,
  suburb text,
  city text not null check (char_length(city) between 1 and 120),
  province text,
  postal_code text,
  country text not null default 'ZA' check (char_length(country) = 2),
  property_type public.property_type not null default 'house',
  municipal_account_number text,
  notes text,
  image_path text,
  status public.property_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Denormalised full_address kept in sync by trigger rather than computed ad hoc in every
-- client, so search/display is consistent everywhere it's read.
alter table public.properties add column full_address text generated always as (
  trim(both ', ' from
    address_line1 || ', ' ||
    coalesce(address_line2 || ', ', '') ||
    coalesce(suburb || ', ', '') ||
    city || ', ' ||
    coalesce(province || ', ', '') ||
    coalesce(postal_code, '')
  )
) stored;

create index properties_owner_user_id_idx on public.properties (owner_user_id);
create index properties_owner_status_idx on public.properties (owner_user_id, status);

create trigger set_properties_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

alter table public.properties enable row level security;

create policy "properties_select_own"
  on public.properties for select
  using (owner_user_id = auth.uid());

create policy "properties_insert_own"
  on public.properties for insert
  with check (owner_user_id = auth.uid());

create policy "properties_update_own"
  on public.properties for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "properties_delete_own"
  on public.properties for delete
  using (owner_user_id = auth.uid());
