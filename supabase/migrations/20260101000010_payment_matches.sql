-- Supports one-payment-to-one-bill, partial payment, one-payment-to-many-bills, overpayment,
-- and unmatched proofs (a payment simply has zero rows here until matched). Confirmation is
-- always a customer action (brief: never silently mark paid) — see ARCHITECTURE.md.
create table public.payment_matches (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  match_score numeric(5, 2) not null check (match_score between 0 and 100),
  status public.payment_match_status not null default 'proposed',
  matched_fields text[] not null default '{}',
  conflicting_fields text[] not null default '{}',
  confirmed_at timestamptz,
  confirmed_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, bill_id)
);

create index payment_matches_owner_idx on public.payment_matches (owner_user_id);
create index payment_matches_payment_idx on public.payment_matches (payment_id);
create index payment_matches_bill_idx on public.payment_matches (bill_id);
-- Prevent the same proof of payment from being *confirmed* against more than one bill by
-- accident (brief: "preventing the same proof from being used twice accidentally"). Multiple
-- bills covered by one payment is still possible — that's a deliberate multi-row *confirm*,
-- not a race; a partial index on 'confirmed' rows keeps that path open while blocking silent
-- double-confirmation from concurrent requests for what's meant to be a single-bill payment.
create unique index payment_matches_one_confirmed_bill_per_payment_idx
  on public.payment_matches (payment_id)
  where status = 'confirmed';

create trigger set_payment_matches_updated_at
  before update on public.payment_matches
  for each row execute function public.set_updated_at();

alter table public.payment_matches enable row level security;

create policy "payment_matches_select_own"
  on public.payment_matches for select
  using (owner_user_id = auth.uid());

create policy "payment_matches_insert_own"
  on public.payment_matches for insert
  with check (
    owner_user_id = auth.uid()
    and exists (select 1 from public.payments pay where pay.id = payment_id and pay.owner_user_id = auth.uid())
    and exists (select 1 from public.bills b where b.id = bill_id and b.owner_user_id = auth.uid())
  );

create policy "payment_matches_update_own"
  on public.payment_matches for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
