-- TASKS.md M14 part 2 (schema): trust_ledgers, trust_ledger_entries, bank_accounts,
-- bank_transactions, invoices, expenses, owner_statements, tax_pack_exports (DATABASE.md §9).
-- All financial-write RLS gates on accountant+ (PERMISSIONS.md §2: agent has NO accounting-post
-- rights, only accountant+ does -- checked against PERMISSIONS.md's role table before writing
-- this migration, not assumed, since it directly decided how the deposit-posting function below
-- must be gated).

create type public.trust_ledger_entry_type as enum ('deposit_received', 'interest_accrued', 'deduction', 'refund');
create type public.bank_account_class as enum ('business', 'trust');
create type public.bank_transaction_match_status as enum ('unmatched', 'matched', 'ignored');
create type public.invoice_status as enum ('draft', 'issued', 'paid');
create type public.expense_status as enum ('recorded', 'pending', 'reimbursed', 'void');
create type public.owner_statement_status as enum ('draft', 'issued', 'paid');

-- === trust_ledgers / trust_ledger_entries ===
create table public.trust_ledgers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  lease_id uuid not null references public.leases(id),
  opening_balance numeric(12, 2) not null check (opening_balance >= 0),
  current_balance numeric(12, 2) not null check (current_balance >= 0),
  interest_rate_pct numeric(5, 2) not null default 0 check (interest_rate_pct >= 0),
  last_interest_accrual_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lease_id)
);

create index trust_ledgers_org_idx on public.trust_ledgers (org_id);
create index trust_ledgers_tenant_idx on public.trust_ledgers (tenant_id);

create trigger set_trust_ledgers_updated_at
  before update on public.trust_ledgers
  for each row execute function public.set_updated_at();

alter table public.trust_ledgers enable row level security;

create policy "trust_ledgers_select_org_member"
  on public.trust_ledgers for select
  using (public.has_org_role(org_id, 'viewer'));

-- current_balance is written by the posting functions below (post_lease_deposit(),
-- release_trust_deposit(), accrue_trust_interest()), which run under the caller's own accountant+
-- rights (DATABASE.md §9: "current_balance is updated in the same transaction as every
-- trust_ledger_entries insert... the posting service increments/decrements it as part of the same
-- DB transaction"). No direct client write path exists beyond those functions -- this policy
-- exists so the functions themselves (SECURITY INVOKER) can write, not so a client calls
-- `.update()` on this table directly with an arbitrary balance.
create policy "trust_ledgers_write_accountant_plus"
  on public.trust_ledgers for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

create table public.trust_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  trust_ledger_id uuid not null references public.trust_ledgers(id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries(id),
  entry_type public.trust_ledger_entry_type not null,
  amount numeric(12, 2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create index trust_ledger_entries_ledger_idx on public.trust_ledger_entries (trust_ledger_id);

alter table public.trust_ledger_entries enable row level security;

create policy "trust_ledger_entries_select_org_member"
  on public.trust_ledger_entries for select
  using (
    exists (
      select 1 from public.trust_ledgers tl
      where tl.id = trust_ledger_entries.trust_ledger_id and public.has_org_role(tl.org_id, 'viewer')
    )
  );

create policy "trust_ledger_entries_insert_accountant_plus"
  on public.trust_ledger_entries for insert
  with check (
    exists (
      select 1 from public.trust_ledgers tl
      where tl.id = trust_ledger_entries.trust_ledger_id and public.has_org_role(tl.org_id, 'accountant')
    )
  );

-- trust_ledger_entries is an append-only financial record (mirrors journal_entries/journal_lines'
-- own reasoning exactly -- it's the line-item detail behind trust_ledgers.current_balance, and
-- that balance's trustworthiness depends on this table never being edited after the fact). Same
-- real-immutability fix as 20260101000035/36: RLS's absence of an update/delete policy alone does
-- not restrict service_role (BYPASSRLS=true), so a hard trigger is the actual enforcement.
create or replace function public.prevent_trust_ledger_entries_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'trust_ledger_entries rows are permanently immutable once posted (ACCOUNTING.md §1)';
end;
$$;

create trigger trust_ledger_entries_immutable
  before update or delete on public.trust_ledger_entries
  for each row execute function public.prevent_trust_ledger_entries_mutation();

-- === bank_accounts / bank_transactions ===
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_class public.bank_account_class not null default 'business',
  bank_name text not null check (char_length(bank_name) between 1 and 200),
  account_number_ref uuid references public.encrypted_secrets(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bank_accounts_org_idx on public.bank_accounts (org_id, is_active);

create trigger set_bank_accounts_updated_at
  before update on public.bank_accounts
  for each row execute function public.set_updated_at();

alter table public.bank_accounts enable row level security;

create policy "bank_accounts_select_org_member"
  on public.bank_accounts for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "bank_accounts_write_accountant_plus"
  on public.bank_accounts for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  transaction_date date not null,
  amount numeric(12, 2) not null,
  description text,
  reference text,
  matched_journal_entry_id uuid references public.journal_entries(id),
  -- Not in DATABASE.md §9's original column list -- added while implementing
  -- confirm_bank_transaction_match() (migration 20260101000038): a partial rent payment can be
  -- covered by more than one bank transaction (ACCOUNTING.md §10), and without a stored link from
  -- a transaction back to which schedule it was matched against, there is no way to compute the
  -- *cumulative* amount paid toward a schedule across multiple matched transactions -- found as a
  -- real bug (a second covering payment was compared against the full schedule amount instead of
  -- against the remaining balance) by testing the two-payment case, not assumed correct from a
  -- single-payment test.
  matched_rent_schedule_id uuid references public.rent_schedules(id),
  match_status public.bank_transaction_match_status not null default 'unmatched',
  created_at timestamptz not null default now(),
  check ((match_status = 'matched') = (matched_journal_entry_id is not null))
);

create index bank_transactions_account_idx on public.bank_transactions (bank_account_id, match_status);

alter table public.bank_transactions enable row level security;

create policy "bank_transactions_select_org_member"
  on public.bank_transactions for select
  using (
    exists (
      select 1 from public.bank_accounts ba
      where ba.id = bank_transactions.bank_account_id and public.has_org_role(ba.org_id, 'viewer')
    )
  );

create policy "bank_transactions_write_accountant_plus"
  on public.bank_transactions for all
  using (
    exists (
      select 1 from public.bank_accounts ba
      where ba.id = bank_transactions.bank_account_id and public.has_org_role(ba.org_id, 'accountant')
    )
  )
  with check (
    exists (
      select 1 from public.bank_accounts ba
      where ba.id = bank_transactions.bank_account_id and public.has_org_role(ba.org_id, 'accountant')
    )
  );

-- === invoices ===
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lease_id uuid not null references public.leases(id),
  tenant_id uuid not null references public.tenants(id),
  period date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  status public.invoice_status not null default 'draft',
  issued_at timestamptz,
  pdf_document_id uuid references public.documents(id),
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'draft') or (issued_at is not null))
);

create index invoices_org_idx on public.invoices (org_id, status);
create index invoices_lease_idx on public.invoices (lease_id);

create trigger set_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

create policy "invoices_select_org_member"
  on public.invoices for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "invoices_write_accountant_plus"
  on public.invoices for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

-- === expenses ===
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id),
  vendor_id uuid references public.vendors(id),
  category text not null check (char_length(category) between 1 and 100),
  amount numeric(12, 2) not null check (amount >= 0),
  status public.expense_status not null default 'pending',
  document_id uuid references public.documents(id),
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'recorded') = (journal_entry_id is not null))
);

create index expenses_org_status_idx on public.expenses (org_id, status);
create index expenses_property_idx on public.expenses (property_id);

create trigger set_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

alter table public.expenses enable row level security;

create policy "expenses_select_org_member"
  on public.expenses for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "expenses_write_accountant_plus"
  on public.expenses for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

-- === owner_statements ===
create table public.owner_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id),
  period_start date not null,
  period_end date not null,
  rent_collected numeric(12, 2) not null default 0,
  expenses_total numeric(12, 2) not null default 0,
  management_fee numeric(12, 2) not null default 0,
  net_payable numeric(12, 2) not null default 0,
  status public.owner_statement_status not null default 'draft',
  payout_matched_transaction_id uuid references public.bank_transactions(id),
  pdf_document_id uuid references public.documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, period_start, period_end),
  check (period_end > period_start),
  check ((status = 'paid') = (payout_matched_transaction_id is not null))
);

create index owner_statements_org_idx on public.owner_statements (org_id, status);
create index owner_statements_owner_idx on public.owner_statements (owner_id);

create trigger set_owner_statements_updated_at
  before update on public.owner_statements
  for each row execute function public.set_updated_at();

alter table public.owner_statements enable row level security;

-- Org staff (viewer+) can see every owner's statements; an owner with portal access can see their
-- own -- mirrors owners_select_org_or_self (M2) exactly.
create policy "owner_statements_select_org_or_self"
  on public.owner_statements for select
  using (
    public.has_org_role(org_id, 'viewer')
    or exists (select 1 from public.owners o where o.id = owner_statements.owner_id and o.user_id = auth.uid())
  );

create policy "owner_statements_write_accountant_plus"
  on public.owner_statements for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

-- === tax_pack_exports ===
create table public.tax_pack_exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tax_year integer not null check (tax_year between 2020 and 2100),
  generated_at timestamptz not null default now(),
  pdf_document_id uuid references public.documents(id)
);

create index tax_pack_exports_org_idx on public.tax_pack_exports (org_id, tax_year);

alter table public.tax_pack_exports enable row level security;

create policy "tax_pack_exports_select_org_member"
  on public.tax_pack_exports for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "tax_pack_exports_insert_accountant_plus"
  on public.tax_pack_exports for insert
  with check (public.has_org_role(org_id, 'accountant'));
