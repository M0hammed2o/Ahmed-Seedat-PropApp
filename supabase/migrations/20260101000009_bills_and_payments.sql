create table public.bills (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.documents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  supplier_name text,
  billing_year integer check (billing_year between 2000 and 2100),
  billing_month integer check (billing_month between 1 and 12),
  statement_date date,
  due_date date,
  amount_due numeric(12, 2) check (amount_due >= 0),
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  account_number text,
  invoice_number text,
  payment_reference text,
  notes text,
  status public.bill_status not null default 'processing',
  extraction_confidence numeric(4, 3) check (extraction_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bills_owner_status_idx on public.bills (owner_user_id, status);
create index bills_owner_property_period_idx on public.bills (owner_user_id, property_id, billing_year, billing_month);
create index bills_owner_due_date_idx on public.bills (owner_user_id, due_date);

create trigger set_bills_updated_at
  before update on public.bills
  for each row execute function public.set_updated_at();

alter table public.bills enable row level security;

create policy "bills_select_own"
  on public.bills for select
  using (owner_user_id = auth.uid());

create policy "bills_insert_own"
  on public.bills for insert
  with check (owner_user_id = auth.uid());

create policy "bills_update_own"
  on public.bills for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.documents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  recipient_name text,
  amount numeric(12, 2) check (amount >= 0),
  payment_reference text,
  payment_date date,
  extraction_confidence numeric(4, 3) check (extraction_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_owner_idx on public.payments (owner_user_id);
create index payments_owner_property_idx on public.payments (owner_user_id, property_id);

create trigger set_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;

create policy "payments_select_own"
  on public.payments for select
  using (owner_user_id = auth.uid());

create policy "payments_insert_own"
  on public.payments for insert
  with check (owner_user_id = auth.uid());

create policy "payments_update_own"
  on public.payments for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
