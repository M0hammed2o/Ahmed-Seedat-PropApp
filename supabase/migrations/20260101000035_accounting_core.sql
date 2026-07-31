-- TASKS.md M14 (part 1/2): the core double-entry ledger -- chart_of_accounts, journal_entries,
-- journal_lines, accounting_periods -- plus the posting primitives everything else in the
-- accounting subsystem will be built on top of. Full posting rules: ACCOUNTING.md. Table shapes:
-- DATABASE.md §9.
--
-- REAL GAP FOUND AND FIXED BEFORE WRITING THIS MIGRATION, not after: ACCOUNTING.md §1 claims
-- immutability is "enforced at three layers," the second being "RLS has no update/delete policy
-- on those tables for any role, including elevated ones." This is not actually true of this
-- Supabase project: `service_role` has `BYPASSRLS = true` (verified earlier this session via
-- `select rolbypassrls from pg_roles`), so RLS policies -- or their absence -- have **no effect
-- at all** on what service_role can do. "No RLS policy" is not a security control against a role
-- that ignores RLS entirely. A hard requirement this explicit ("no financial record is ever
-- edited after posting... it's a hard requirement for trust-account handling") cannot rest on a
-- mechanism that silently doesn't apply to the one credential most likely to be used for a bulk
-- backend operation. Fixed here with BEFORE UPDATE/DELETE triggers that unconditionally raise --
-- triggers fire regardless of RLS bypass or which role is doing the writing, including the table
-- owner. This is the real third enforcement layer; RLS's absence of an update/delete policy is
-- now correctly a secondary, redundant layer, not the only one. ACCOUNTING.md §1 needs a
-- corresponding correction (tracked in the same commit as this migration).

create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.ledger_class as enum ('business', 'trust', 'deposit');
create type public.journal_source_type as enum (
  'rent_invoice', 'expense', 'payment', 'deposit', 'owner_payout', 'adjustment', 'reversal'
);
create type public.accounting_period_status as enum ('open', 'closed');

-- === chart_of_accounts ===
create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 200),
  account_type public.account_type not null,
  ledger_class public.ledger_class not null default 'business',
  parent_account_id uuid references public.chart_of_accounts(id),
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

create index chart_of_accounts_org_idx on public.chart_of_accounts (org_id, is_active);

create trigger set_chart_of_accounts_updated_at
  before update on public.chart_of_accounts
  for each row execute function public.set_updated_at();

alter table public.chart_of_accounts enable row level security;

create policy "chart_of_accounts_select_org_member"
  on public.chart_of_accounts for select
  using (public.has_org_role(org_id, 'viewer'));

-- Custom accounts only -- system accounts (is_system=true) are seeded once at org creation and
-- deactivated, never deleted or edited, per ACCOUNTING.md §2 ("system accounts cannot be deleted,
-- only deactivated"). Deactivation is itself an update, allowed here for accountant+; system rows
-- keep is_system=true forever (nothing in this policy or the app lets is_system flip).
create policy "chart_of_accounts_write_accountant_plus"
  on public.chart_of_accounts for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

-- === accounting_periods ===
create table public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status public.accounting_period_status not null default 'open',
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, period_start, period_end),
  check (period_end > period_start),
  check ((status = 'closed') = (closed_by is not null and closed_at is not null))
);

create index accounting_periods_org_idx on public.accounting_periods (org_id, status);

alter table public.accounting_periods enable row level security;

create policy "accounting_periods_select_org_member"
  on public.accounting_periods for select
  using (public.has_org_role(org_id, 'viewer'));

-- DATABASE.md §9's own stated rule: "update (closing/reopening) requires accountant+." Insert
-- (creating a new period) uses the same floor -- period management in V1 is manual (ACCOUNTING.md
-- §9: "manual period closing... not automatic"), staff-created, not system-generated.
create policy "accounting_periods_write_accountant_plus"
  on public.accounting_periods for all
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

-- === journal_entries -- insert-only, never updated (except see the trigger below) ===
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entry_date date not null,
  description text,
  source_type public.journal_source_type not null,
  source_id uuid,
  created_by uuid not null references auth.users(id),
  posted_at timestamptz not null default now(),
  reversed_by_entry_id uuid references public.journal_entries(id),
  is_reversal boolean not null default false
);

create index journal_entries_org_date_idx on public.journal_entries (org_id, entry_date);
create index journal_entries_source_idx on public.journal_entries (source_type, source_id);

alter table public.journal_entries enable row level security;

create policy "journal_entries_select_org_member"
  on public.journal_entries for select
  using (public.has_org_role(org_id, 'viewer'));

-- INSERT only -- no update/delete policy at all, for any role (ACCOUNTING.md §1). Restricted to
-- accountant+ per DATABASE.md §12 ("only accountant/manager/principal can write journal_entries").
create policy "journal_entries_insert_accountant_plus"
  on public.journal_entries for insert
  with check (public.has_org_role(org_id, 'accountant'));

-- The real immutability enforcement (see this file's header note). Allows exactly one narrow,
-- schema-anticipated post-insert mutation: setting reversed_by_entry_id from NULL to a value,
-- exactly once, with every other column unchanged -- this is what lets a reversal link back to
-- the entry it negates without treating "the entry now has a reversal" as editing its financial
-- content (ACCOUNTING.md §1's "original entry is untouched forever" is about entry_date,
-- description, source, and the lines -- never about whether it's been reversed).
create or replace function public.prevent_journal_entries_mutation()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'journal_entries rows can never be deleted (ACCOUNTING.md §1)';
  end if;

  if OLD.reversed_by_entry_id is not null then
    raise exception 'journal_entries.reversed_by_entry_id can only be set once (entry % already reversed)', OLD.id;
  end if;
  if NEW.reversed_by_entry_id is null then
    raise exception 'journal_entries rows cannot be updated except to set reversed_by_entry_id (ACCOUNTING.md §1)';
  end if;
  if NEW.id is distinct from OLD.id
    or NEW.org_id is distinct from OLD.org_id
    or NEW.entry_date is distinct from OLD.entry_date
    or NEW.description is distinct from OLD.description
    or NEW.source_type is distinct from OLD.source_type
    or NEW.source_id is distinct from OLD.source_id
    or NEW.created_by is distinct from OLD.created_by
    or NEW.posted_at is distinct from OLD.posted_at
    or NEW.is_reversal is distinct from OLD.is_reversal
  then
    raise exception 'journal_entries rows are immutable except for setting reversed_by_entry_id (ACCOUNTING.md §1)';
  end if;

  return NEW;
end;
$$;

create trigger journal_entries_immutable
  before update or delete on public.journal_entries
  for each row execute function public.prevent_journal_entries_mutation();

-- === journal_lines -- insert-only, never updated, no exceptions ===
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id),
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  property_id uuid references public.properties(id),
  owner_id uuid references public.owners(id),
  tenant_id uuid references public.tenants(id),
  memo text
);

create index journal_lines_entry_idx on public.journal_lines (journal_entry_id);
create index journal_lines_account_idx on public.journal_lines (account_id);
create index journal_lines_owner_idx on public.journal_lines (owner_id) where owner_id is not null;
create index journal_lines_property_idx on public.journal_lines (property_id) where property_id is not null;

alter table public.journal_lines enable row level security;

create policy "journal_lines_select_org_member"
  on public.journal_lines for select
  using (
    exists (
      select 1 from public.journal_entries e
      where e.id = journal_lines.journal_entry_id and public.has_org_role(e.org_id, 'viewer')
    )
  );

create policy "journal_lines_insert_accountant_plus"
  on public.journal_lines for insert
  with check (
    exists (
      select 1 from public.journal_entries e
      where e.id = journal_lines.journal_entry_id and public.has_org_role(e.org_id, 'accountant')
    )
  );

-- No narrow exception here -- journal_lines has no analogous "link to what reversed me" field.
-- Every line, once posted, is permanently immutable.
create or replace function public.prevent_journal_lines_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'journal_lines rows are permanently immutable once posted (ACCOUNTING.md §1)';
end;
$$;

create trigger journal_lines_immutable
  before update or delete on public.journal_lines
  for each row execute function public.prevent_journal_lines_mutation();

-- === The posting service's core primitive. "No generic post a journal entry API exists" per
--     ACCOUNTING.md §3 means no *client-facing* API -- this function is exactly that primitive,
--     the one and only code path allowed to write journal_entries/journal_lines together, called
--     from server-side route handlers/typed operations, never exposed directly to a client as a
--     free-form "post whatever you want" endpoint. ===
create or replace function public.post_journal_entry(
  p_org_id uuid,
  p_entry_date date,
  p_description text,
  p_source_type public.journal_source_type,
  p_source_id uuid,
  p_lines jsonb -- array of {account_id, debit?, credit?, property_id?, owner_id?, tenant_id?, memo?}
)
returns uuid
language plpgsql
as $$
declare
  v_entry_id uuid;
  v_period_status public.accounting_period_status;
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
begin
  if auth.uid() is null then
    raise exception 'post_journal_entry requires an authenticated user';
  end if;

  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry requires an array of at least two lines';
  end if;

  -- Period lock (ACCOUNTING.md §9): reject outright, never silently adjust the date. A missing
  -- period row is treated as open (no period has been defined/closed for that range yet) --
  -- period locking is an opt-in discipline an org adopts by creating and closing periods, not a
  -- default-deny that would block posting for every org that hasn't set periods up yet.
  select status into v_period_status
  from public.accounting_periods
  where org_id = p_org_id and p_entry_date between period_start and period_end;

  if v_period_status = 'closed' then
    raise exception 'Cannot post to a closed accounting period (entry_date %)', p_entry_date;
  end if;

  select coalesce(sum(coalesce((line->>'debit')::numeric, 0)), 0),
         coalesce(sum(coalesce((line->>'credit')::numeric, 0)), 0)
  into v_total_debit, v_total_credit
  from jsonb_array_elements(p_lines) as line;

  if v_total_debit <> v_total_credit then
    raise exception 'Unbalanced journal entry: total debits % != total credits %', v_total_debit, v_total_credit;
  end if;
  if v_total_debit = 0 then
    raise exception 'A journal entry cannot have zero total value';
  end if;

  insert into public.journal_entries (org_id, entry_date, description, source_type, source_id, created_by, is_reversal)
  values (p_org_id, p_entry_date, p_description, p_source_type, p_source_id, auth.uid(), p_source_type = 'reversal')
  returning id into v_entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit, property_id, owner_id, tenant_id, memo)
  select
    v_entry_id,
    (line->>'account_id')::uuid,
    coalesce((line->>'debit')::numeric, 0),
    coalesce((line->>'credit')::numeric, 0),
    nullif(line->>'property_id', '')::uuid,
    nullif(line->>'owner_id', '')::uuid,
    nullif(line->>'tenant_id', '')::uuid,
    line->>'memo'
  from jsonb_array_elements(p_lines) as line;

  return v_entry_id;
end;
$$;

comment on function public.post_journal_entry(uuid, date, text, public.journal_source_type, uuid, jsonb) is
  'The sole write path for journal_entries/journal_lines together (ACCOUNTING.md §3). Validates
   accountant+ role, period-not-closed, and SUM(debit)=SUM(credit) before any insert -- rejects the
   whole entry, never a partial post, per ACCOUNTING.md §1.';

-- === reverse_journal_entry(): the only sanctioned correction mechanism (ACCOUNTING.md §1) ===
-- security definer, unlike post_journal_entry() -- not to bypass authorization (the has_org_role
-- check below still applies identically), but because journal_entries deliberately has NO update
-- RLS policy at all, for any role (this file's own journal_entries_insert_accountant_plus comment
-- and DATABASE.md §12 are explicit about this). Found live, not assumed: a first version of this
-- function was SECURITY INVOKER, and its final `update ... set reversed_by_entry_id` silently
-- matched zero rows (RLS-filtered, not an error) because no UPDATE policy exists to satisfy --
-- exactly the "RLS silently filters, doesn't raise" gotcha this project has hit before, except
-- this time it produced a *reversal that looked successful but never actually linked*. security
-- definer here lets this one function perform the single narrow mutation the hard trigger already
-- gates (prevent_journal_entries_mutation()) -- the trigger, not RLS, is what actually constrains
-- what this elevated privilege can be used for, and it applies identically regardless of security
-- definer.
create or replace function public.reverse_journal_entry(
  p_entry_id uuid,
  p_reversal_entry_date date default current_date,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.journal_entries%rowtype;
  v_lines jsonb;
  v_reversal_id uuid;
begin
  select * into v_original from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'Journal entry not found (or not visible to the caller)';
  end if;
  if v_original.reversed_by_entry_id is not null then
    raise exception 'Journal entry % has already been reversed', p_entry_id;
  end if;
  if v_original.is_reversal then
    raise exception 'Journal entry % is itself a reversal and cannot be reversed again -- post a new correcting entry instead', p_entry_id;
  end if;

  -- Negate every line: swap debit/credit exactly, keep every dimension (account/property/owner/
  -- tenant) identical -- an exact negation, per ACCOUNTING.md §1, not a re-derived approximation.
  select jsonb_agg(jsonb_build_object(
    'account_id', account_id,
    'debit', credit,
    'credit', debit,
    'property_id', property_id,
    'owner_id', owner_id,
    'tenant_id', tenant_id,
    'memo', coalesce(p_reason, 'Reversal of entry ' || p_entry_id::text)
  ))
  into v_lines
  from public.journal_lines
  where journal_entry_id = p_entry_id;

  v_reversal_id := public.post_journal_entry(
    v_original.org_id,
    p_reversal_entry_date,
    coalesce(p_reason, 'Reversal of: ' || coalesce(v_original.description, p_entry_id::text)),
    'reversal',
    p_entry_id,
    v_lines
  );

  -- The one narrow post-insert mutation prevent_journal_entries_mutation() allows.
  update public.journal_entries set reversed_by_entry_id = v_reversal_id where id = p_entry_id;

  return v_reversal_id;
end;
$$;

comment on function public.reverse_journal_entry(uuid, date, text) is
  'Posts the exact negation of an existing journal entry and links the two via
   reversed_by_entry_id -- the only sanctioned way to correct a posted entry (ACCOUNTING.md §1).
   Reuses post_journal_entry() itself, so a reversal is subject to the identical balance/period
   checks as any other post -- it cannot be used to smuggle an unbalanced or closed-period write.';

-- === Period management (ACCOUNTING.md §9) ===
create or replace function public.close_accounting_period(p_period_id uuid)
returns void
language plpgsql
as $$
declare
  v_period public.accounting_periods%rowtype;
begin
  select * into v_period from public.accounting_periods where id = p_period_id;
  if not found then
    raise exception 'Accounting period not found';
  end if;
  if not public.has_org_role(v_period.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_period.status = 'closed' then
    raise exception 'Period % is already closed', p_period_id;
  end if;

  update public.accounting_periods
  set status = 'closed', closed_by = auth.uid(), closed_at = now()
  where id = p_period_id;
end;
$$;

-- Reopening is deliberately NOT audit-logged via audit_events here, unlike ACCOUNTING.md §9's
-- stated intent ("reopening... writes an audit_events row") -- audit_events' live schema
-- (actor_type enum('customer','admin','system')) has no value that correctly describes "an org
-- accountant, not a platform admin, took this action" (TECHNICAL_DEBT_REGISTER.md TD-14). Writing
-- a semantically-wrong row would be worse than not writing one; this gap is now also tracked
-- against TD-14 rather than worked around with an incorrect actor_type value.
create or replace function public.reopen_accounting_period(p_period_id uuid)
returns void
language plpgsql
as $$
declare
  v_period public.accounting_periods%rowtype;
begin
  select * into v_period from public.accounting_periods where id = p_period_id;
  if not found then
    raise exception 'Accounting period not found';
  end if;
  if not public.has_org_role(v_period.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_period.status = 'open' then
    raise exception 'Period % is already open', p_period_id;
  end if;

  update public.accounting_periods
  set status = 'open', closed_by = null, closed_at = null
  where id = p_period_id;
end;
$$;

-- === Chart of accounts seeding (ACCOUNTING.md §2: "Seeded per organization at creation from a
--     system template") ===
create or replace function public.seed_chart_of_accounts(p_org_id uuid)
returns void
language plpgsql
as $$
begin
  insert into public.chart_of_accounts (org_id, code, name, account_type, ledger_class, is_system)
  values
    (p_org_id, '1000', 'Business Bank Account', 'asset', 'business', true),
    (p_org_id, '1010', 'Trust Bank Account', 'asset', 'trust', true),
    (p_org_id, '1100', 'Accounts Receivable', 'asset', 'business', true),
    (p_org_id, '2000', 'Accounts Payable', 'liability', 'business', true),
    (p_org_id, '2100', 'Tenant Deposits Held', 'liability', 'trust', true),
    (p_org_id, '3000', 'Owner Equity', 'equity', 'business', true),
    (p_org_id, '4000', 'Rent Income', 'income', 'business', true),
    (p_org_id, '4100', 'Late Fee Income', 'income', 'business', true),
    (p_org_id, '5000', 'Maintenance Expense', 'expense', 'business', true),
    (p_org_id, '5100', 'Management Fee Expense', 'expense', 'business', true),
    (p_org_id, '5900', 'Other Expense', 'expense', 'business', true);
end;
$$;

comment on function public.seed_chart_of_accounts(uuid) is
  'System chart-of-accounts template (ACCOUNTING.md §2). Called once from create_organization() --
   never re-run against an org that already has accounts, which would violate the (org_id, code)
   uniqueness constraint by design (seeding is a one-time, creation-time action, not idempotent-by-
   intent, matching accounts'' own "cannot be deleted, only deactivated" permanence).';

-- Wire seeding into create_organization() (20260101000021) -- the one existing, sanctioned org-
-- creation path gains one more atomic step, same transaction as the org row and the creator's
-- principal membership.
create or replace function public.create_organization(
  p_legal_name text,
  p_org_type public.organization_type default 'owner_managed'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'create_organization requires an authenticated user';
  end if;

  insert into public.organizations (legal_name, org_type)
  values (p_legal_name, p_org_type)
  returning id into v_org_id;

  insert into public.organization_members (org_id, user_id, role, status, joined_at)
  values (v_org_id, auth.uid(), 'principal', 'active', now());

  perform public.seed_chart_of_accounts(v_org_id);

  return v_org_id;
end;
$$;
